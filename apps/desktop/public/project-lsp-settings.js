// project-lsp-settings.js — the Language servers section of a project's
// Settings tab (projects-view.js renderSettings calls renderProjectLanguageServers).
// Which of the editor's language servers the project uses (lsp/project-servers.js):
// the ones found in its folders first, each with whether it is installed on
// this computer (and how to install it), and a note when it runs the
// project's own code or is heavy. A switch saves at once; "Detect again"
// looks at the folders again and turns on the servers of new languages.

/** A detection's counts as text: ".ts 120, .tsx 30". */
function lspFoundText(found) {
  if (!found) return '';
  return Object.entries(found.extensions || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([ext, n]) => `${ext} ${n}`)
    .join(', ');
}

/** One server's row. */
function lspServerRowHtml(row, esc) {
  const notes = [];
  if (row.runsProjectCode) notes.push('<span class="ws-lsp-note" title="It runs the project\'s own code when it starts (build scripts, project tools)">runs project code</span>');
  if (row.weight === 'heavy') notes.push('<span class="ws-lsp-note" title="It can take a lot of memory and time on a big project">heavy</span>');
  const where = row.installed
    ? `<span class="mono ws-lsp-cmd" title="${esc(row.path || '')}">${esc(row.command)}</span>`
    : `<span class="ws-lsp-missing">Not installed</span><button type="button" class="ws-ghost ws-ghost--sm ws-lsp-copy" data-install="${esc(row.install)}" title="${esc(row.install)}">Copy install command</button>`;
  const help = row.found ? `Found here: ${esc(lspFoundText(row.found))}` : esc(row.languages.join(', '));
  return `<div class="ws-row ws-lsp-row" data-server="${esc(row.id)}">
    <div class="ws-row-k"><b>${esc(row.label)}</b><span>${help}${notes.length ? ` · ${notes.join(' · ')}` : ''}</span></div>
    <div class="ws-row-v">${where}<label class="ws-check ws-check--switch" title="${row.enabled ? 'On' : 'Off'} for this project"><input type="checkbox" class="ws-switch-input ws-lsp-toggle" data-server="${esc(row.id)}" ${row.enabled ? 'checked' : ''}><span class="ws-switch"></span></label></div>
  </div>`;
}

/** The section's body: the servers found in the project, then the others folded away. */
function lspServersHtml(rows, esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')) {
  const found = rows.filter(r => r.found || r.enabled);
  const others = rows.filter(r => !(r.found || r.enabled));
  const head = found.length
    ? found.map(r => lspServerRowHtml(r, esc)).join('')
    : '<div class="ws-item ws-item--empty">No language found in the project\'s folders yet.</div>';
  const rest = others.length
    ? `<details class="ws-lsp-others"><summary>Other languages (${others.length})</summary>${others.map(r => lspServerRowHtml(r, esc)).join('')}</details>`
    : '';
  return head + rest;
}

/** Fill `el` with the project's servers and wire the switches, the copy buttons and `detectBtn`. */
async function renderProjectLanguageServers(project, el, detectBtn) {
  if (!el || !window.api.lspProjectServers) return;
  const draw = (rows) => {
    if (!Array.isArray(rows)) {
      el.innerHTML = `<div class="ws-item ws-item--empty">${escapeHtml(rows?.error || 'Could not read the language servers.')}</div>`;
      return;
    }
    el.innerHTML = lspServersHtml(rows, escapeHtml);
    el.querySelectorAll('.ws-lsp-toggle').forEach((input) => {
      input.addEventListener('change', async () => {
        const result = await window.api.setProjectLspServer(project.id, input.dataset.server, input.checked);
        if (result?.error) { alert(result.error); input.checked = !input.checked; }
      });
    });
    el.querySelectorAll('.ws-lsp-copy').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.api.writeClipboard(btn.dataset.install);
        btn.textContent = 'Copied';
        setTimeout(() => { if (btn.isConnected) btn.textContent = 'Copy install command'; }, 1500);
      });
    });
  };
  el.innerHTML = '<div class="ws-item ws-item--empty">Looking at the project\'s folders…</div>';
  const on = window.api.getLanguageServers ? await window.api.getLanguageServers().catch(() => true) : true;
  draw(await window.api.lspProjectServers(project.id).catch(err => ({ error: err.message })));
  if (!on) {
    // Switched off for the whole app: say so above the list, which still shows the choices.
    const note = document.createElement('div');
    note.className = 'ws-item ws-lsp-off';
    note.innerHTML = '<span>Language servers are switched off for the whole app: none starts in any project.</span><button type="button" class="ws-ghost ws-ghost--sm ws-ghost--accent">Switch On</button>';
    note.querySelector('button').onclick = async () => {
      await window.api.setLanguageServers(true);
      renderProjectLanguageServers(project, el, detectBtn);
    };
    el.prepend(note);
  }
  if (detectBtn) {
    detectBtn.onclick = async () => {
      detectBtn.disabled = true;
      el.innerHTML = '<div class="ws-item ws-item--empty">Looking at the project\'s folders…</div>';
      draw(await window.api.lspDetect(project.id).catch(err => ({ error: err.message })));
      detectBtn.disabled = false;
    };
  }
}

if (typeof module !== 'undefined') module.exports = { lspServersHtml, lspFoundText };
