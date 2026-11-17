// RAM task manager: how much memory each running session and task uses.
//
// Opened from the sidebar's More menu, in the main area, or in a small window
// of its own (task-manager.html). On top, the memory installed, the memory in
// use on the whole computer and what Switchboard uses with all its sessions.
// Each row is one session (or task) and counts its whole process tree; rows
// are sorted by RAM, heaviest first, and expand to the processes inside. Stop
// ends a session the way the sidebar does, then ends whatever of its tree
// outlived that; Force kill SIGKILLs the whole tree at once.
//
// In the main window it uses globals from app.js and friends at call time:
// sessionMap, pendingSessions, openSessions, activePtyIds, activeSessionId,
// gridViewActive, openSession, showSession, showTaskLog, setActiveSession,
// refreshSidebar. Its own window sets window.taskManagerHost instead (see
// task-manager-window.js). Both need cleanDisplayName, shortProjectPath,
// escapeHtml, escapeAttr and ICONS.

(function () {
  const viewer = document.getElementById('process-viewer');
  const body = document.getElementById('process-viewer-body');
  const statusEl = document.getElementById('process-viewer-status');
  const refreshBtn = document.getElementById('process-viewer-refresh');
  const closeBtn = document.getElementById('process-viewer-close');

  // What the Task Manager needs from the window it is in.
  const host = window.taskManagerHost || {
    standalone: false,
    sessionFor: (id) => sessionMap.get(id) || pendingSessions.get(id)?.session || null,
    openOwner: (owner) => openOwnerHere(owner),
    // A session asked to stop: the sidebar forgets it at once, as its own Stop does.
    stopRequested: (owner) => {
      if (owner.kind !== 'session') return;
      activePtyIds.delete(owner.id);
      // Like the sidebar's Stop; the viewer stays on top until it is closed.
      if (!gridViewActive && activeSessionId === owner.id) setActiveSession(null);
    },
    stopped: (owner) => { if (owner.kind === 'session') refreshSidebar(); },
    forceStopped: (owner) => {
      if (owner.kind !== 'session') return;
      activePtyIds.delete(owner.id);
      refreshSidebar();
    },
  };

  const GB = 1024 ** 3;
  const MB = 1024 ** 2;
  const MAX_PROCESS_ROWS = 60;

  let data = null;
  let error = null;
  let timer = null;
  let inFlight = false;
  const expanded = new Set();
  // Owners asked to stop, and processes asked to end, from this window: their
  // buttons turn into "Force kill" if they are still there afterwards.
  const stopAsked = new Set();
  const stopInFlight = new Set();
  const killAsked = new Set();

  const isOpen = () => host.standalone || viewer.style.display !== 'none';
  const intervalMs = () => (data?.platform === 'win32' ? 6000 : 3000);

  function ownerKey(owner) {
    return owner.kind === 'task' ? `task:${owner.projectPath}|${owner.label}` : `session:${owner.id}`;
  }

  function ownerRef(owner) {
    return owner.kind === 'task'
      ? { kind: 'task', projectPath: owner.projectPath, label: owner.label }
      : { kind: 'session', id: owner.id };
  }

  function findOwner(key) {
    return data?.owners.find(owner => ownerKey(owner) === key) || null;
  }

  function sessionFor(id) {
    return host.sessionFor(id);
  }

  function ownerTitle(owner) {
    if (owner.kind === 'task') return owner.label;
    const session = sessionFor(owner.id);
    const name = session ? cleanDisplayName(session.name || session.aiTitle || session.summary) : '';
    if (name) return name;
    if (owner.type === 'terminal') return 'Terminal';
    return `${kindLabel(owner)} session`;
  }

  function kindLabel(owner) {
    if (owner.kind === 'task') return 'Task';
    if (owner.type === 'terminal') return 'Terminal';
    const runtime = owner.runtime || 'claude';
    return runtime.charAt(0).toUpperCase() + runtime.slice(1);
  }

  const TASK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
  const CHEVRON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';

  function ownerIcon(owner) {
    if (owner.kind === 'task') return TASK_ICON;
    if (owner.type === 'terminal') return ICONS.terminal(14);
    if (owner.runtime === 'codex') return ICONS.codex(14, 'codex-icon');
    if (!owner.runtime || owner.runtime === 'claude') return ICONS.claude(14);
    return ICONS.terminal(14);
  }

  const formatBytes = (bytes) => UsageChart.formatBytes(bytes);

  /**
   * Disk sizes as the system shows them: the Finder counts 1000 bytes to the
   * kilobyte, Windows and Linux 1024.
   */
  const formatDisk = (bytes) => UsageChart.formatDisk(bytes, data?.platform);

  /** A disk's bar: how full it is, amber under 20% free, red under 10%. */
  function diskBar(disk) {
    const { used, level: tone } = UsageChart.diskLevel(disk);
    return `<div class="pm-meter"><span class="pm-level-${tone}" style="width:${(used * 100).toFixed(2)}%"></span></div>`;
  }

  // --- Rings (usage-chart.js) ---

  // Colours that follow each session from one refresh to the next, and the
  // slice under the pointer or the keyboard ('mem:<key>' or 'disk:<key>').
  let ringColors = null;
  let diskColors = null;
  let activeSlice = null;
  // Project sizes for the disk ring (disk-usage.js), and its legend rows opened.
  let projectDisk = null;
  const openLegend = new Set();

  /**
   * A ring and its legend. Pointing at a slice or a legend row lights both
   * and shows that slice in the middle; otherwise the middle shows `center`.
   */
  function ringHtml(ring, slices, { label, center, format, total, details }) {
    const active = activeSlice?.startsWith(`${ring}:`) ? activeSlice.slice(ring.length + 1) : null;
    const byKey = new Map(slices.map(slice => [slice.key, slice]));
    const state = (key) => (active === key ? ' is-active' : active ? ' is-dim' : '');
    const owner = (slice) => (slice.owner ? ` data-owner="${escapeAttr(ownerKey(slice.owner))}"` : '');
    const share = (bytes) => UsageChart.formatPercent(bytes, total);
    const shown = (slice) => slice.display ?? slice.bytes;
    const paths = UsageChart.donutPaths(slices, { size: 120, thickness: 14 }).map(({ key, d }) => {
      const slice = byKey.get(key);
      return `<path class="pm-slice${state(key)}" d="${d}" fill="${slice.color}" data-slice="${ring}:${escapeAttr(key)}"${owner(slice)}></path>`;
    }).join('');
    const pointed = active ? byKey.get(active) : null;
    const middle = pointed
      ? `<span class="pm-ring-big">${escapeHtml(format(shown(pointed)))}</span><span class="pm-ring-small">${escapeHtml(pointed.label)} · ${escapeHtml(share(shown(pointed)))}</span>`
      : `<span class="pm-ring-big">${escapeHtml(center.big)}</span><span class="pm-ring-small">${escapeHtml(center.small)}</span>`;
    const legend = slices.map((slice) => {
      const sub = details ? details(slice) : null;
      const id = `${ring}:${slice.key}`;
      const open = !!sub && openLegend.has(id);
      const shared = slice.display != null && slice.display > slice.bytes;
      const expand = sub ? ` data-expand="${escapeAttr(id)}" aria-expanded="${open}" title="${open ? 'Hide' : 'Show'} its folders"` : '';
      return `
            <li class="pm-legend-row${state(slice.key)}${slice.owner || sub ? ' pm-legend-owner' : ''}" tabindex="0" data-slice="${escapeAttr(id)}"${owner(slice)}${slice.owner ? ' title="Show it in the list"' : ''}${expand}>
              <span class="pm-dot" style="background:${slice.color}"></span>
              <span class="pm-legend-name">${sub ? `<span class="pm-legend-chevron${open ? ' open' : ''}">${CHEVRON}</span>` : ''}${escapeHtml(slice.label)}${shared ? '<span class="pm-legend-tag" title="Part of it is also in another project, where the ring counts it">shared</span>' : ''}</span>
              <span class="pm-legend-value">${escapeHtml(format(shown(slice)))}</span>
              <span class="pm-legend-share">${escapeHtml(share(shown(slice)))}</span>
            </li>${open ? sub : ''}`;
    }).join('');
    return `
          <div class="pm-ring-wrap">
            <div class="pm-ring" role="img" aria-label="${escapeAttr(label)}">
              <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true">${paths}</svg>
              <div class="pm-ring-center">${middle}</div>
            </div>
            <ul class="pm-legend">${legend}</ul>
          </div>`;
  }

  function agoText(at) {
    const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return `${hours} h ago`;
  }

  /** Under the disk ring: how fresh the project sizes are, and Measure again. */
  function projectsMeasureHtml() {
    if (!projectDisk) return '';
    if (projectDisk.measuring) {
      return projectDisk.projects ? 'Measuring the projects again…' : 'Measuring the projects (their folder and attached folders)…';
    }
    if (!projectDisk.measuredAt) return '';
    return `Projects measured ${escapeHtml(agoText(projectDisk.measuredAt))} · <button type="button" class="pm-link" data-disk-action="measure">Measure again</button>`;
  }

  /** A project's folders under its legend row; the projects behind "N other projects". */
  function diskDetails(slice) {
    const row = (name, bytes, note, title) => `
            <li class="pm-legend-sub"${title ? ` title="${escapeAttr(title)}"` : ''}>
              <span></span>
              <span class="pm-legend-name">${escapeHtml(name)}${note ? `<span class="pm-legend-note">${escapeHtml(note)}</span>` : ''}</span>
              <span class="pm-legend-value">${bytes == null ? '—' : escapeHtml(formatDisk(bytes))}</span>
              <span></span>
            </li>`;
    if (slice.project) {
      return slice.project.folders.map((folder) => {
        const notes = [];
        if (folder.isRoot) notes.push('project folder');
        if (folder.inside) notes.push(`inside ${folder.inside}`);
        if (folder.alsoIn?.length) notes.push(`also in ${folder.alsoIn.join(', ')}`);
        return row(folder.name, folder.bytes, notes.join(' · '), folder.path);
      }).join('');
    }
    if (slice.projects) return slice.projects.map(project => row(project.name, project.bytes, '', '')).join('');
    return null;
  }

  /** The disk of home and the projects as a ring; any other disk below it as a bar. */
  function disksHtml() {
    const disks = data.disks || [];
    if (!disks.length) return '';
    const [main, ...others] = disks;
    const ring = UsageChart.diskSlices(main, { projects: projectDisk?.projects, previous: diskColors });
    diskColors = ring.colors;
    const used = Math.max(0, (main.totalBytes || 0) - (main.freeBytes || 0));
    const otherRows = others.map(disk => `
          <div class="pm-disk" title="${escapeAttr(disk.mount)}">
            <div class="pm-disk-top"><span class="pm-disk-name">${escapeHtml(disk.name)}</span><span class="pm-disk-free">${formatDisk(disk.freeBytes)} free of ${formatDisk(disk.totalBytes)}</span></div>
            ${diskBar(disk)}
          </div>`).join('');
    const low = ring.level === 'high' ? ' · <span class="pm-low pm-low-high">Almost full</span>'
      : ring.level === 'mid' ? ' · <span class="pm-low">Low on space</span>' : '';
    const label = `${main.name}: ${formatDisk(used)} used of ${formatDisk(main.totalBytes)}, ${formatDisk(main.freeBytes)} free`;
    return `
        <div class="pm-card pm-card-disks">
          <div class="pm-card-label">Disk${disks.length > 1 ? ` · ${disks.length} disks` : ''}</div>
          <div class="pm-card-value">${formatDisk(used)} <span class="pm-card-unit">/ ${formatDisk(main.totalBytes)}</span></div>
          <div class="pm-card-key">used / size</div>
          ${ringHtml('disk', ring.slices, {
            label,
            total: main.totalBytes,
            format: formatDisk,
            center: { big: UsageChart.formatPercent(used, main.totalBytes) || '—', small: 'used' },
            details: diskDetails,
          })}
          <div class="pm-card-hint" title="${escapeAttr(main.mount)}">${formatDisk(main.freeBytes)} free on ${escapeHtml(main.name)}${low}</div>
          <div class="pm-card-hint">${projectsMeasureHtml()}</div>
          ${otherRows}
        </div>`;
  }

  function formatCpu(cpu) {
    if (cpu === null || cpu === undefined) return '—';
    return (cpu >= 10 ? Math.round(cpu) : cpu.toFixed(1)) + '%';
  }

  function formatPercent(bytes) {
    if (!data?.totalMemBytes) return '';
    const share = (bytes / data.totalMemBytes) * 100;
    return (share >= 10 ? Math.round(share) : share.toFixed(1)) + '%';
  }

  function formatShare(bytes) {
    const percent = formatPercent(bytes);
    return percent ? `${percent} of RAM` : '';
  }

  function formatUptime(startedAt) {
    if (!startedAt) return '—';
    const minutes = Math.max(0, Math.floor((Date.now() - startedAt) / 60000));
    if (minutes < 1) return '<1m';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  }

  function level(bytes) {
    if (bytes >= 2 * GB) return 'high';
    if (bytes >= GB) return 'mid';
    return 'low';
  }

  // --- Rendering ---

  /**
   * One card for the memory, one for the disk. The memory card shows what
   * Switchboard uses with its sessions, what is in use on the whole computer
   * and what is installed, and a ring that splits the installed memory into
   * the app, each of the largest sessions and tasks, other apps and free.
   */
  function summaryHtml(owners) {
    const totals = UsageChart.memoryTotals(data);
    const { slices, colors } = UsageChart.memorySlices(data, { labelFor: ownerTitle, previous: ringColors });
    ringColors = colors;
    const running = [`${totals.sessions} session${totals.sessions === 1 ? '' : 's'}`];
    if (totals.tasks) running.push(`${totals.tasks} task${totals.tasks === 1 ? '' : 's'}`);
    const hint = [
      `app ${formatBytes(totals.appBytes)}`,
      `${running.join(', ')} ${formatBytes(totals.ownersBytes)}`,
      `${totals.processes} process${totals.processes === 1 ? '' : 'es'}`,
    ];
    if (totals.free !== null) hint.push(`${formatBytes(totals.free)} free`);
    const used = totals.used === null ? '' : ` <span class="pm-v-used">/ ${formatBytes(totals.used)}</span>`;
    const label = totals.used === null
      ? `Switchboard and its sessions use ${formatBytes(totals.ours)} of ${formatBytes(totals.installed)} installed`
      : `Switchboard and its sessions use ${formatBytes(totals.ours)}; ${formatBytes(totals.used)} of ${formatBytes(totals.installed)} is in use on this computer`;
    const center = totals.used === null
      ? { big: UsageChart.formatPercent(totals.ours, totals.installed) || '—', small: 'Switchboard' }
      : { big: UsageChart.formatPercent(totals.used, totals.installed) || '—', small: 'in use' };
    return `
      <div class="pm-summary">
        <div class="pm-card pm-card-mem">
          <div class="pm-card-label">Memory</div>
          <div class="pm-card-value"><span class="pm-v-ours">${formatBytes(totals.ours)}</span>${used} <span class="pm-card-unit">/ ${formatBytes(totals.installed)}</span></div>
          <div class="pm-card-key">Switchboard and its sessions${totals.used === null ? '' : ' / in use'} / installed</div>
          ${ringHtml('mem', slices, { label, total: totals.installed, format: formatBytes, center })}
          <div class="pm-card-hint">${escapeHtml(hint.join(' · '))}</div>
        </div>
        ${disksHtml()}
      </div>`;
  }

  /** What the numbers are, for the line under the table. */
  function measureNote() {
    if (data.memoryMeasure === 'footprint') {
      return 'Memory is each process\'s footprint, as Activity Monitor shows it (memory the system compressed included), summed over a session\'s whole process tree: the CLI, its MCP servers and anything it started. In use is Activity Monitor\'s Memory Used: app memory, wired and compressed; files kept in cache are left out. The app counts its window, helpers and terminal host (herdr-core).';
    }
    if (data.memoryMeasure === 'working-set') {
      return 'Memory is the working set of each session\'s whole process tree: the CLI, its MCP servers and anything it started. Memory shared between processes can be counted more than once. In use is everything but the available memory.';
    }
    return 'Memory is the resident memory (RSS) of each session\'s whole process tree: the CLI, its MCP servers and anything it started. Memory shared between processes can be counted more than once. In use is everything but the available memory.';
  }

  function processesHtml(owner, key) {
    // A shell busy starting up can briefly hold hundreds; keep the list readable.
    const shown = owner.processes.slice(0, MAX_PROCESS_ROWS);
    const hidden = owner.processes.slice(MAX_PROCESS_ROWS);
    const rows = shown.map(proc => {
      const killKey = `${key}#${proc.pid}`;
      const forcing = killAsked.has(killKey);
      const action = proc.depth === 0
        ? '<span class="pm-proc-root" title="The session\'s own process: use Stop">root</span>'
        : `<button class="pm-btn pm-btn-small ${forcing ? 'pm-btn-danger' : 'pm-btn-ghost'}" data-action="kill" data-key="${escapeAttr(key)}" data-pid="${proc.pid}" title="${forcing ? 'Still running: send SIGKILL' : 'End this process (SIGTERM)'}">${forcing ? 'Force kill' : 'Kill'}</button>`;
      return `
        <div class="pm-proc">
          <span class="pm-proc-name" style="padding-left:${Math.min(proc.depth, 8) * 14}px">${proc.depth ? '<span class="pm-proc-branch">└</span>' : ''}${escapeHtml(proc.label || proc.name || '?')}</span>
          <span class="pm-proc-cmd" title="${escapeAttr(proc.command || '')}">${escapeHtml(proc.command || '')}</span>
          <span class="pm-mono">${proc.pid}</span>
          <span class="pm-num">${formatCpu(proc.cpu)}</span>
          <span class="pm-num">${formatBytes(proc.rssBytes)}</span>
          <span class="pm-proc-action">${action}</span>
        </div>`;
    }).join('');
    const more = hidden.length
      ? `<div class="pm-proc-empty">…and ${hidden.length} more process${hidden.length === 1 ? '' : 'es'}, ${formatBytes(hidden.reduce((sum, proc) => sum + proc.rssBytes, 0))} in all.</div>`
      : '';
    return `
      <div class="pm-procs">
        <div class="pm-proc pm-proc-head"><span>Process</span><span>Command</span><span>PID</span><span class="pm-num">CPU</span><span class="pm-num">RAM</span><span></span></div>
        ${rows || '<div class="pm-proc-empty">No process found for this PID.</div>'}
        ${more}
      </div>`;
  }

  function ownerHtml(owner, maxBytes) {
    const key = ownerKey(owner);
    const open = expanded.has(key);
    const pending = stopInFlight.has(key);
    const stopping = pending || owner.stopRequested || stopAsked.has(key);
    const width = maxBytes ? Math.max(1.5, (owner.rssBytes / maxBytes) * 100) : 0;
    const badges = [];
    if (stopping) badges.push('<span class="pm-badge pm-badge-stop">stopping…</span>');
    else if (owner.busy) badges.push('<span class="pm-badge pm-badge-busy">working</span>');
    if (!owner.found) badges.push('<span class="pm-badge">not measured</span>');
    const sub = [kindLabel(owner)];
    if (owner.projectPath) sub.push(shortProjectPath(owner.projectPath));
    if (owner.pid) sub.push(`PID ${owner.pid}`);
    const stopButton = pending
      ? '<button class="pm-btn pm-btn-stop" disabled title="Ending every process in it">Stopping…</button>'
      : stopping
      ? `<button class="pm-btn pm-btn-danger" data-action="force" data-key="${escapeAttr(key)}" title="Still running: SIGKILL every process in it">Force kill</button>`
      : `<button class="pm-btn pm-btn-stop" data-action="stop" data-key="${escapeAttr(key)}" title="Stop this ${owner.kind === 'task' ? 'task' : 'session'}">Stop</button>`;
    return `
      <div class="pm-owner${open ? ' pm-open' : ''}" data-key="${escapeAttr(key)}">
        <div class="pm-row">
          <button class="pm-expand" data-action="toggle" data-key="${escapeAttr(key)}" title="${open ? 'Hide' : 'Show'} processes" aria-expanded="${open}">${CHEVRON}</button>
          <div class="pm-name" data-action="toggle" data-key="${escapeAttr(key)}">
            <span class="pm-icon">${ownerIcon(owner)}</span>
            <div class="pm-name-text">
              <div class="pm-title"><span class="pm-title-text" title="${escapeAttr(ownerTitle(owner))}">${escapeHtml(ownerTitle(owner))}</span>${badges.join('')}</div>
              <div class="pm-sub">${escapeHtml(sub.join(' · '))}</div>
            </div>
          </div>
          <span class="pm-num" title="Processes in this tree">${owner.processCount}</span>
          <span class="pm-num">${formatCpu(owner.cpu)}</span>
          <div class="pm-ram" title="${escapeAttr(formatShare(owner.rssBytes))}">
            <div class="pm-ram-top"><span class="pm-ram-value">${formatBytes(owner.rssBytes)}</span><span class="pm-ram-share">${escapeHtml(formatShare(owner.rssBytes))}</span></div>
            <div class="pm-bar"><span class="pm-level-${level(owner.rssBytes)}" style="width:${width.toFixed(2)}%"></span></div>
          </div>
          <span class="pm-uptime">${formatUptime(owner.startedAt)}</span>
          <div class="pm-actions">
            <button class="pm-btn pm-btn-ghost" data-action="open" data-key="${escapeAttr(key)}" title="Show this ${owner.kind === 'task' ? 'task\'s output' : 'session'}">Open</button>
            ${stopButton}
          </div>
        </div>
        ${open ? processesHtml(owner, key) : ''}
      </div>`;
  }

  function render() {
    if (error && !data) {
      body.innerHTML = `<div class="pm-wrap"><div class="pm-empty">Could not read the process list: ${escapeHtml(error)}</div></div>`;
      return;
    }
    if (!data) {
      body.innerHTML = '<div class="pm-wrap"><div class="pm-empty">Measuring…</div></div>';
      return;
    }
    const owners = data.owners;
    // Forget what was asked of owners and processes that are gone.
    const live = new Set(owners.map(ownerKey));
    for (const key of [...stopAsked]) if (!live.has(key)) stopAsked.delete(key);
    for (const key of [...expanded]) if (!live.has(key)) expanded.delete(key);
    const livePids = new Set(owners.flatMap(owner => owner.processes.map(proc => `${ownerKey(owner)}#${proc.pid}`)));
    for (const key of [...killAsked]) if (!livePids.has(key)) killAsked.delete(key);

    const maxBytes = owners.reduce((max, owner) => Math.max(max, owner.rssBytes), 0);
    const rows = owners.length
      ? owners.map(owner => ownerHtml(owner, maxBytes)).join('')
      : '<div class="pm-empty">No session or task is running.</div>';
    const notes = [measureNote()];
    if (data.platform === 'win32') notes.push('CPU is not measured on Windows, and a WSL session only shows its Windows-side process.');
    const html = `
      <div class="pm-wrap">
        ${summaryHtml(owners)}
        <div class="pm-table">
          <div class="pm-row pm-head">
            <span></span><span>Name</span><span class="pm-num">Procs</span><span class="pm-num">CPU</span><span class="pm-sorted">RAM ↓</span><span>Uptime</span><span></span>
          </div>
          ${rows}
        </div>
        <p class="pm-footnote">${notes.map(escapeHtml).join('<br>')}</p>
      </div>`;
    if (typeof morphdom === 'function' && body.firstElementChild) {
      morphdom(body, `<div>${html}</div>`, { childrenOnly: true });
    } else {
      body.innerHTML = html;
    }
  }

  function setStatus() {
    if (error) {
      statusEl.textContent = 'Refresh failed';
      statusEl.className = 'pm-status pm-status-error';
      return;
    }
    const time = data ? new Date(data.sampledAt).toLocaleTimeString() : '';
    statusEl.textContent = data ? `Live · every ${intervalMs() / 1000}s · ${time}` : '';
    statusEl.className = 'pm-status';
  }

  // --- Refresh loop: only while the viewer is on screen ---

  async function refresh() {
    if (inFlight) return;
    inFlight = true;
    refreshBtn.classList.add('spinning');
    try {
      const [usage, disk] = await Promise.all([
        window.api.getProcessUsage(),
        window.api.getProjectDiskUsage ? window.api.getProjectDiskUsage().catch(() => null) : null,
      ]);
      data = usage;
      if (disk?.ok) projectDisk = disk;
      error = null;
    } catch (err) {
      error = err?.message || String(err);
    } finally {
      inFlight = false;
      refreshBtn.classList.remove('spinning');
    }
    if (!isOpen()) return;
    render();
    setStatus();
  }

  function schedule(delay = intervalMs()) {
    clearTimeout(timer);
    timer = setTimeout(tick, delay);
  }

  async function tick() {
    timer = null;
    if (!isOpen()) return;
    if (!document.hidden) await refresh();
    if (isOpen()) schedule();
  }

  /** Soon after an action, to show its effect without waiting a full interval. */
  function refreshSoon() {
    schedule(700);
  }

  // --- Actions ---

  async function stopOwner(owner) {
    const key = ownerKey(owner);
    const what = owner.kind === 'task' ? 'task' : 'session';
    const count = `${owner.processCount} process${owner.processCount === 1 ? '' : 'es'}`;
    if (!confirm(`Stop the ${what} “${ownerTitle(owner)}”?\n\nIt uses ${formatBytes(owner.rssBytes)} across ${count}. All of them are ended, including any started in the background.`)) return;
    stopAsked.add(key);
    stopInFlight.add(key);
    render();
    // Resolves once the stragglers are dealt with, a few seconds at most.
    const stopping = window.api.stopOwner(ownerRef(owner)).finally(() => stopInFlight.delete(key));
    host.stopRequested(owner);
    refreshSoon();
    const result = await stopping;
    if (!result?.ok && result?.error) alert(result.error);
    host.stopped(owner);
    if (isOpen()) refresh();
  }

  async function forceStopOwner(owner) {
    if (!confirm(`Force kill “${ownerTitle(owner)}”?\n\nEvery process in it gets SIGKILL right away: anything unsaved in them is lost.`)) return;
    const result = await window.api.forceStopOwner(ownerRef(owner));
    if (!result?.ok && result?.error) alert(result.error);
    host.forceStopped(owner);
    refreshSoon();
  }

  async function killProcess(owner, pid) {
    const proc = owner.processes.find(p => p.pid === pid);
    if (!proc) return;
    const killKey = `${ownerKey(owner)}#${pid}`;
    const force = killAsked.has(killKey);
    const name = proc.label || proc.name;
    const prompt = force
      ? `“${name}” (PID ${pid}) is still running. Send SIGKILL?`
      : `End “${name}” (PID ${pid}), ${formatBytes(proc.rssBytes)}?\n\nThe session keeps running; only this process ends.`;
    if (!confirm(prompt)) return;
    const result = await window.api.killOwnedProcess(ownerRef(owner), pid, force);
    if (!result?.ok) {
      if (result?.error) alert(result.error);
      return;
    }
    killAsked.add(killKey);
    refreshSoon();
  }

  /** Open in this window: the task's output, or the session. */
  function openOwnerHere(owner) {
    if (owner.kind === 'task') {
      showTaskLog(owner.projectPath, owner.label);
      return;
    }
    const session = sessionFor(owner.id);
    if (session) openSession(session);
    else if (openSessions.has(owner.id)) showSession(owner.id);
  }

  function openOwner(owner) {
    host.openOwner(ownerRef(owner));
  }

  body.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || !body.contains(target)) return;
    const owner = findOwner(target.dataset.key);
    if (!owner) return;
    switch (target.dataset.action) {
      case 'toggle': {
        const key = ownerKey(owner);
        if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
        render();
        break;
      }
      case 'open': openOwner(owner); break;
      case 'stop': stopOwner(owner); break;
      case 'force': forceStopOwner(owner); break;
      case 'kill': killProcess(owner, Number(target.dataset.pid)); break;
    }
  });

  // The rings: pointing at a slice or a legend row lights both.
  function pointAt(slice) {
    if (slice === activeSlice) return;
    activeSlice = slice;
    render();
  }
  const sliceAt = (node) => node?.closest?.('[data-slice]') || null;
  body.addEventListener('mouseover', (event) => {
    const el = sliceAt(event.target);
    if (el) pointAt(el.dataset.slice);
  });
  body.addEventListener('mouseout', (event) => {
    if (!sliceAt(event.target)) return;
    const next = sliceAt(event.relatedTarget);
    pointAt(next ? next.dataset.slice : null);
  });
  body.addEventListener('focusin', (event) => {
    const el = sliceAt(event.target);
    if (el) pointAt(el.dataset.slice);
  });
  body.addEventListener('focusout', (event) => {
    if (sliceAt(event.target) && !sliceAt(event.relatedTarget)) pointAt(null);
  });

  /** From a session's slice to its row in the list. */
  function showOwnerRow(key) {
    const row = [...body.querySelectorAll('.pm-owner')].find(el => el.dataset.key === key);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.remove('pm-flash');
    void row.offsetWidth;
    row.classList.add('pm-flash');
    setTimeout(() => row.classList.remove('pm-flash'), 1600);
  }
  function toggleLegend(id) {
    if (openLegend.has(id)) openLegend.delete(id); else openLegend.add(id);
    render();
  }
  async function measureDisks() {
    const disk = await window.api.getProjectDiskUsage?.(true).catch(() => null);
    if (disk?.ok) projectDisk = disk;
    render();
  }
  body.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-disk-action="measure"]')) { measureDisks(); return; }
    const expand = event.target.closest?.('[data-expand]');
    if (expand && body.contains(expand)) { toggleLegend(expand.dataset.expand); return; }
    const el = event.target.closest?.('[data-owner]');
    if (el && body.contains(el)) showOwnerRow(el.dataset.owner);
  });
  body.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const expand = event.target.closest?.('[data-expand]');
    if (expand) { event.preventDefault(); toggleLegend(expand.dataset.expand); return; }
    const el = event.target.closest?.('[data-owner]');
    if (!el) return;
    event.preventDefault();
    showOwnerRow(el.dataset.owner);
  });

  refreshBtn.addEventListener('click', () => { refresh(); schedule(); });
  closeBtn?.addEventListener('click', () => closeProcessViewer());

  // In its own window it is always on screen.
  if (host.standalone) {
    render();
    refresh();
    schedule();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); schedule(); } });
    return;
  }

  // Open from the Task Manager's own window: the session or task shows here.
  window.api.onTaskManagerOpenOwner?.((owner) => openOwnerHere(owner));

  // --- Open / close ---

  function openProcessViewer() {
    if (typeof hideProjectChrome === 'function') hideProjectChrome();
    for (const id of ['placeholder', 'terminal-area', 'plan-viewer', 'stats-viewer', 'memory-viewer', 'jsonl-viewer', 'settings-viewer']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
    viewer.style.display = 'flex';
    render();
    refresh();
    schedule();
  }

  /** Back to whatever the viewer covered: the active session, the grid, or the placeholder. */
  function closeProcessViewer() {
    clearTimeout(timer);
    timer = null;
    viewer.style.display = 'none';
    const terminalArea = document.getElementById('terminal-area');
    const terminalHeader = document.getElementById('terminal-header');
    if (activeSessionId && openSessions.has(activeSessionId)) {
      terminalArea.style.display = '';
      terminalHeader.style.display = '';
    } else if (gridViewActive) {
      terminalArea.style.display = '';
    } else {
      document.getElementById('placeholder').style.display = '';
    }
  }

  window.openProcessViewer = openProcessViewer;
  window.closeProcessViewer = closeProcessViewer;
})();
