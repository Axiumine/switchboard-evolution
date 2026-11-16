// Remote access for the mobile companion app. In the sidebar header, the
// phone button opens the dialog, which has the switch that turns it on and
// off, the paired devices, each with an X to remove it, and Add a device for
// pairing another. The button is lit while access is on and counts the
// devices connected; a dot on the expand button shows it is on while the
// sidebar is collapsed. A switch in the header itself (#remote-access-switch)
// is optional. The server itself runs in main (remote-server.js) and only
// while the switch is on.

(() => {
  const switchBtn = document.getElementById('remote-access-switch');
  const devicesBtn = document.getElementById('remote-access-devices-btn');
  const expandBtn = document.getElementById('sidebar-expand-btn');
  if (!devicesBtn) return;

  const dot = document.createElement('span');
  dot.className = 'remote-access-dot';
  expandBtn.appendChild(dot);

  let status = { enabled: false, running: false, port: null, error: null, clients: [], paired: 0 };
  let busy = false;
  let dialog = null;

  const isOn = () => status.enabled && status.running;
  const failed = () => status.enabled && !status.running && !!status.error;
  const devicesText = (n) => `${n} device${n === 1 ? '' : 's'}`;
  // Devices, not connections: a device may hold more than one.
  const connectedCount = () => new Set(status.clients.map(c => c.id)).size;

  function describe() {
    if (isOn()) {
      const n = connectedCount();
      return `On, port ${status.port}${n ? `, ${devicesText(n)} connected` : ''}`;
    }
    if (failed()) {
      // main.js retries a busy port until it frees up.
      return /already in use/.test(status.error || '')
        ? `waiting: ${status.error}, trying again every few seconds`
        : `Could not start: ${status.error}`;
    }
    return 'Off';
  }

  function render() {
    const n = connectedCount();
    const paired = status.paired || 0;
    if (switchBtn) {
      switchBtn.classList.toggle('on', isOn());
      switchBtn.classList.toggle('error', failed());
      switchBtn.setAttribute('aria-checked', String(status.enabled));
      switchBtn.title = `Mobile app access: ${describe()}`;
    }
    devicesBtn.classList.toggle('on', isOn());
    devicesBtn.classList.toggle('error', failed());
    // Connected over paired, while access is on and a device is paired.
    const count = devicesBtn.querySelector('.remote-access-count');
    count.textContent = isOn() && paired ? `${n}/${paired}` : '';
    count.classList.toggle('none-connected', n === 0);
    // Without the switch beside it, the button says whether access is on.
    devicesBtn.title = isOn() && paired ? `Mobile app: ${n} of ${paired} devices connected` : `Mobile app access: ${describe()}`;
    dot.classList.toggle('on', isOn());
    dot.classList.toggle('connected', isOn() && n > 0);
    dialog?.refresh();
  }

  async function setEnabled(enabled) {
    if (busy) return;
    busy = true;
    try {
      status = await window.api.setRemoteAccessEnabled(enabled);
    } finally {
      busy = false;
    }
    render();
  }

  switchBtn?.addEventListener('click', async () => {
    await setEnabled(!status.enabled);
    // Nothing paired yet: turning it on is the moment to pair.
    if (isOn() && !dialog && !(await window.api.listRemoteDevices()).length) openDialog({ pair: true });
  });
  devicesBtn.addEventListener('click', () => openDialog());

  window.api.onRemoteAccessStatus((next) => { status = next; render(); });
  window.api.remoteAccessStatus().then((next) => { status = next; render(); });

  // --- The dialog ---
  //
  // Like the other dialogs, a click on the backdrop does nothing; Escape and
  // Close are the ways out. Closing it withdraws an unused pairing code.

  function openDialog({ pair = false } = {}) {
    if (dialog) {
      if (pair) dialog.pair();
      return;
    }
    const overlay = document.createElement('div');
    overlay.className = 'add-project-overlay';
    const box = document.createElement('div');
    box.className = 'add-project-dialog remote-access-dialog';
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    let devices = [];
    let pairing = null; // { qrSvg, expiresAt, addresses, port, knownIds }
    let message = '';

    const secondsLeft = () => Math.max(0, Math.ceil((pairing.expiresAt - Date.now()) / 1000));
    const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const ticker = setInterval(() => {
      if (!pairing) return;
      const left = secondsLeft();
      if (left === 0) { pairing = null; message = 'The pairing code expired.'; paint(); return; }
      const el = box.querySelector('.remote-pair-expiry');
      if (el) el.textContent = clock(left);
    }, 1000);

    async function startPairing() {
      // A device can only pair while access is on: adding one turns it on.
      if (!status.enabled) await setEnabled(true);
      if (!isOn()) { message = describe(); paint(); return; }
      const result = await window.api.startRemotePairing();
      if (result.error) {
        pairing = null;
        message = result.error;
      } else {
        pairing = { ...result, knownIds: new Set(devices.map(d => d.id)) };
        message = '';
      }
      paint();
    }

    function deviceRow(device) {
      const connected = status.clients.some(c => c.id === device.id);
      const seen = device.lastSeenAt ? `last seen ${formatDate(new Date(device.lastSeenAt))}` : 'never connected';
      return `<div class="remote-device" data-id="${escapeHtml(device.id)}">
        <div class="remote-device-text">
          <div class="remote-device-name">${escapeHtml(device.name)}${connected ? '<span class="remote-device-live">connected</span>' : ''}</div>
          <div class="remote-device-meta">paired ${escapeHtml(formatDate(new Date(device.pairedAt)))}, ${escapeHtml(connected ? 'now' : seen)}</div>
        </div>
        <button type="button" class="remote-revoke-btn" title="Remove ${escapeHtml(device.name)}" aria-label="Remove ${escapeHtml(device.name)}"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 3l6 6M9 3l-6 6"/></svg></button>
      </div>`;
    }

    function pairingSection() {
      if (!pairing) return '';
      return `<div class="remote-qr">${pairing.qrSvg}</div>
        <div class="add-project-hint">Scan it with the Switchboard app on your phone or tablet. The code works once and expires in <span class="remote-pair-expiry">${clock(secondsLeft())}</span>.</div>
        <div class="add-project-hint">This computer: ${pairing.addresses.map(escapeHtml).join(', ')}, port ${pairing.port}</div>
        ${Object.keys(pairing.routes || {}).length ? `<div class="add-project-hint">From the Internet: ${Object.values(pairing.routes).map(url => escapeHtml(url.replace(/^wss:\/\//, ''))).join(', ')}</div>` : ''}`;
    }

    // --- Access from the Internet (Cloudflare, ngrok) ---
    //
    // Each can be set up on its own. A form opens under its row; what is typed
    // there survives the repaints that status changes bring.

    const TUNNELS = {
      cloudflare: {
        label: 'Cloudflare',
        setup: [
          { key: 'apiToken', label: 'API token', secret: true, hint: 'It needs Cloudflare Tunnel › Edit and DNS › Edit. It is used now and not kept.' },
          { key: 'domain', label: 'Domain', placeholder: 'example.com' },
          { key: 'name', label: 'Name', placeholder: 'switchboard', hint: 'The address becomes name.domain.' },
        ],
        remove: [
          { key: 'apiToken', label: 'API token', secret: true, hint: 'To delete the tunnel and its DNS record on Cloudflare too. Leave it empty to only stop using it here.' },
        ],
      },
      ngrok: {
        label: 'ngrok',
        setup: [
          { key: 'authtoken', label: 'Authtoken', secret: true, hint: 'From dashboard.ngrok.com, Your Authtoken. It is kept in the keychain.' },
          { key: 'domain', label: 'Domain (optional)', placeholder: 'empty: your free ngrok domain' },
        ],
        remove: [],
      },
    };
    let tunnelForm = null; // { provider, action: 'setup' | 'remove', values }
    let tunnelMessage = '';
    let tunnelBusy = false;

    function tunnelState(provider) {
      const t = status.tunnels?.[provider] || {};
      if (!t.configured) return { text: 'Not set up', cls: '' };
      if (t.error) return { text: t.error, cls: 'error' };
      if (t.url) return { text: t.url.replace(/^wss:\/\//, ''), cls: 'on' };
      if (t.running) return { text: 'Connecting…', cls: '' };
      return { text: status.enabled ? 'Not running' : 'Runs while access is on', cls: '' };
    }

    function tunnelFormHtml(provider) {
      const { action, values } = tunnelForm;
      const fields = TUNNELS[provider][action];
      return `<div class="remote-tunnel-form">
        ${fields.map(f => `<label class="remote-field"><span>${escapeHtml(f.label)}</span>
          <input data-key="${f.key}" type="${f.secret ? 'password' : 'text'}" placeholder="${escapeHtml(f.placeholder || '')}" autocomplete="off" spellcheck="false" value="${escapeHtml(values[f.key] || '')}"></label>
          ${f.hint ? `<div class="add-project-hint">${escapeHtml(f.hint)}</div>` : ''}`).join('')}
        ${tunnelMessage ? `<div class="remote-message remote-tunnel-error">${escapeHtml(tunnelMessage)}</div>` : ''}
        <div class="remote-tunnel-actions">
          <button type="button" class="add-project-browse-btn remote-tunnel-cancel">Cancel</button>
          <button type="button" class="add-project-browse-btn remote-tunnel-submit" ${tunnelBusy ? 'disabled' : ''}>${tunnelBusy ? 'Working…' : action === 'remove' ? 'Remove' : 'Set up'}</button>
        </div>
      </div>`;
    }

    function tunnelRow(provider) {
      const t = status.tunnels?.[provider] || {};
      const state = tunnelState(provider);
      const open = tunnelForm?.provider === provider;
      return `<div class="remote-tunnel" data-provider="${provider}">
        <div class="remote-device-text">
          <div class="remote-device-name">${TUNNELS[provider].label}</div>
          <div class="remote-device-meta remote-tunnel-state ${state.cls}">${escapeHtml(state.text)}</div>
        </div>
        ${open ? '' : `<div class="remote-tunnel-buttons">
          <button type="button" class="add-project-browse-btn remote-tunnel-open" data-action="setup">${t.configured ? 'Change…' : 'Set up…'}</button>
          ${t.configured ? '<button type="button" class="add-project-browse-btn remote-tunnel-open" data-action="remove">Remove…</button>' : ''}
        </div>`}
      </div>
      ${open ? tunnelFormHtml(provider) : ''}`;
    }

    /** Keep what is typed in the open form across a repaint. */
    function keepTunnelValues() {
      if (!tunnelForm) return;
      for (const input of box.querySelectorAll('.remote-tunnel-form input')) tunnelForm.values[input.dataset.key] = input.value;
    }

    async function submitTunnel() {
      keepTunnelValues();
      const { provider, action, values } = tunnelForm;
      tunnelBusy = true;
      tunnelMessage = '';
      paint();
      const result = action === 'remove'
        ? await window.api.removeRemoteTunnel(provider, values)
        : await window.api.setupRemoteTunnel(provider, values);
      tunnelBusy = false;
      if (result.error) {
        tunnelMessage = result.error;
      } else {
        tunnelForm = null;
        status = { ...status, tunnels: result.status };
      }
      paint();
    }

    function paint() {
      keepTunnelValues();
      const focused = document.activeElement?.closest?.('.remote-tunnel-form') ? document.activeElement.dataset.key : null;
      box.innerHTML = `
        <div class="remote-dialog-head">
          <h3>Mobile app access</h3>
          <button type="button" role="switch" aria-checked="${status.enabled}" aria-label="Mobile app access" class="remote-dialog-switch ${isOn() ? 'on' : ''} ${failed() ? 'error' : ''}"><span class="remote-switch-track"><span class="remote-switch-knob"></span></span></button>
        </div>
        <div class="remote-state ${isOn() ? 'on' : ''}">${escapeHtml(describe())}</div>
        <div class="add-project-hint">While it is on, a paired phone or tablet on the same network (or the same Tailscale network, or from the Internet below) can see and drive Switchboard. Everything it sends is encrypted end to end.</div>
        <div class="remote-section-head">
          <div class="remote-section-title">Paired devices</div>
          ${pairing ? '' : '<button type="button" class="add-project-browse-btn remote-pair-btn">Add a device</button>'}
        </div>
        ${pairingSection()}
        ${message ? `<div class="remote-message">${escapeHtml(message)}</div>` : ''}
        ${devices.length ? devices.map(deviceRow).join('') : '<div class="add-project-hint">No devices paired yet.</div>'}
        <div class="remote-section-title">Access from the Internet</div>
        <div class="add-project-hint">Away from this network, a phone reaches this computer through Cloudflare or ngrok, and can pair through them too. Only paired phones with this computer's access key get in, and what they send stays encrypted end to end.</div>
        ${Object.keys(TUNNELS).map(tunnelRow).join('')}
        <div class="remote-section-title">Port</div>
        <div class="folder-input-row">
          <input type="number" class="remote-port-input" min="1024" max="65535" value="${status.port || ''}">
          <button type="button" class="add-project-browse-btn remote-port-btn">Save</button>
        </div>
        <div class="add-project-actions">
          <button type="button" class="add-project-cancel-btn">Close</button>
        </div>`;
      box.querySelector('.remote-dialog-switch').onclick = () => { message = ''; setEnabled(!status.enabled); };
      box.querySelector('.remote-pair-btn')?.addEventListener('click', startPairing);
      box.querySelector('.add-project-actions .add-project-cancel-btn').onclick = close;
      box.querySelector('.remote-port-btn').onclick = async () => {
        const result = await window.api.setRemoteAccessPort(Number(box.querySelector('.remote-port-input').value));
        if (result.error) message = result.error;
        else { status = result; message = `Port set to ${result.port}.`; pairing = null; }
        render();
      };
      for (const button of box.querySelectorAll('.remote-tunnel-open')) {
        button.onclick = () => {
          const provider = button.closest('.remote-tunnel').dataset.provider;
          const action = button.dataset.action;
          const t = status.tunnels?.[provider] || {};
          if (provider === 'ngrok' && action === 'remove') {
            if (!confirm('Stop using ngrok on this computer?\n\nPhones that connect through it fall back to the other ways.')) return;
            tunnelForm = { provider, action, values: {} };
            submitTunnel();
            return;
          }
          // Changing Cloudflare starts from the name and domain in use.
          const [name, ...domain] = (action === 'setup' && t.hostname ? t.hostname : '').split('.');
          tunnelForm = { provider, action, values: provider === 'cloudflare' && name ? { name, domain: domain.join('.') } : {} };
          tunnelMessage = '';
          paint();
          box.querySelector('.remote-tunnel-form input')?.focus();
        };
      }
      box.querySelector('.remote-tunnel-cancel')?.addEventListener('click', () => { tunnelForm = null; tunnelMessage = ''; paint(); });
      box.querySelector('.remote-tunnel-submit')?.addEventListener('click', submitTunnel);
      for (const input of box.querySelectorAll('.remote-tunnel-form input')) {
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitTunnel(); });
      }
      if (focused) box.querySelector(`.remote-tunnel-form input[data-key="${focused}"]`)?.focus();
      for (const row of box.querySelectorAll('.remote-device')) {
        row.querySelector('.remote-revoke-btn').onclick = async () => {
          const device = devices.find(d => d.id === row.dataset.id);
          if (!device || !confirm(`Remove ${device.name}?\n\nIt is disconnected now and must be paired again to connect.`)) return;
          devices = await window.api.revokeRemoteDevice(device.id);
          message = '';
          paint();
        };
      }
    }

    async function refresh() {
      devices = await window.api.listRemoteDevices();
      if (pairing) {
        const added = devices.find(d => !pairing.knownIds.has(d.id));
        if (added) { pairing = null; message = `Paired with ${added.name}.`; }
        else if (!isOn()) pairing = null;
      }
      paint();
    }

    function close() {
      clearInterval(ticker);
      document.removeEventListener('keydown', onKey);
      window.api.cancelRemotePairing();
      overlay.remove();
      dialog = null;
    }
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    dialog = { refresh, pair: () => (isOn() ? startPairing() : paint()) };
    window.api.listRemoteDevices().then((list) => {
      devices = list;
      if (pair && isOn()) startPairing();
      else paint();
    });
  }
})();
