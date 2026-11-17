// usage-chart.js — memory and disk use as the Task Manager draws them: the
// numbers, the slices of the two rings (memory: the app, each session or task,
// other apps, free; disk: used and free), the SVG geometry of a ring and the
// short line in the status bar.
//
// Shared with the phone app (scripts/sync-shared.mjs there): no DOM, no Node.
(function (root) {
  const MB = 1024 ** 2;
  const GB = 1024 ** 3;

  // Validated with the dataviz skill's validator on the dark surface #141419
  // (lightness band, chroma, adjacent CVD ΔE >= 8.4, normal-vision ΔE >= 19.3,
  // contrast >= 3:1): the app keeps the accent, sessions take the categorical
  // hues in this fixed order. The two greys are the neutral "Other" folds.
  const COLORS = Object.freeze({
    app: '#7880f5',
    owners: Object.freeze(['#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c']),
    otherOwners: '#9a9ab0',
    otherApps: '#4e4e62',
    free: 'rgba(255,255,255,0.07)',
    diskLow: '#7880f5',
    diskMid: '#f0a050',
    diskHigh: '#e05070',
  });

  function formatBytes(bytes) {
    if (!bytes) return '0 MB';
    if (bytes >= GB) return (bytes / GB).toFixed(bytes >= 10 * GB ? 1 : 2) + ' GB';
    if (bytes >= MB) return Math.round(bytes / MB) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  /** Disk sizes as the computer shows them: a Mac counts 1000 bytes to the kilobyte, Windows and Linux 1024. */
  function formatDisk(bytes, platform) {
    const base = platform === 'darwin' ? 1000 : 1024;
    const gb = base ** 3;
    const tb = base ** 4;
    if (bytes >= tb) return (bytes / tb).toFixed(bytes >= 10 * tb ? 1 : 2) + ' TB';
    if (bytes >= gb) return (bytes / gb).toFixed(bytes >= 100 * gb ? 0 : 1) + ' GB';
    if (bytes >= base ** 2) return Math.round(bytes / base ** 2) + ' MB';
    return bytes > 0 ? Math.max(1, Math.round(bytes / base)) + ' KB' : '0 KB';
  }

  /** "12%" of a total, '' when the total is unknown. */
  function formatPercent(part, total) {
    if (!total) return '';
    const share = (part / total) * 100;
    if (share > 0 && share < 0.1) return '<0.1%';
    return (share >= 10 ? Math.round(share) : share.toFixed(1)) + '%';
  }

  function ownerKey(owner) {
    return owner.kind === 'task' ? `task:${owner.id}` : `session:${owner.id}`;
  }

  /**
   * The memory figures behind the card. `used` is null from a desktop too old
   * to measure it; it never falls below what Switchboard uses nor goes past
   * what is installed.
   */
  function memoryTotals(data) {
    const owners = data?.owners || [];
    const installed = data?.totalMemBytes || 0;
    const ownersBytes = owners.reduce((sum, owner) => sum + (owner.rssBytes || 0), 0);
    const ownersProcesses = owners.reduce((sum, owner) => sum + (owner.processCount || 0), 0);
    const appBytes = data?.app?.rssBytes || 0;
    const ours = data?.switchboard?.rssBytes ?? appBytes + ownersBytes;
    const processes = data?.switchboard?.processCount ?? ownersProcesses + (data?.app?.processCount || 0);
    const used = typeof data?.usedMemBytes === 'number'
      ? Math.max(ours, Math.min(installed || Infinity, data.usedMemBytes))
      : null;
    const sessions = owners.filter(owner => owner.kind === 'session').length;
    return {
      installed,
      used,
      free: used === null ? null : Math.max(0, installed - used),
      ours,
      appBytes,
      ownersBytes,
      processes,
      sessions,
      tasks: owners.length - sessions,
    };
  }

  /**
   * Colours follow the session, not its rank: a session keeps its colour while
   * it stays among the largest ones, and a new one takes the first free colour.
   * `previous` is the map this returned last time ({ key: index }); without it
   * colours go by key, so the same set of sessions always gets the same ones.
   */
  function assignColors(previous, keys, count) {
    const next = {};
    const taken = new Set();
    keys = [...keys].sort();
    for (const key of keys) {
      const slot = previous?.[key];
      if (Number.isInteger(slot) && slot >= 0 && slot < count && !taken.has(slot)) {
        next[key] = slot;
        taken.add(slot);
      }
    }
    for (const key of keys) {
      if (key in next) continue;
      let slot = 0;
      while (taken.has(slot)) slot++;
      next[key] = slot;
      taken.add(slot);
    }
    return next;
  }

  /**
   * The memory ring, in drawing order: the app (Switchboard's window, helpers
   * and terminal host), the largest sessions and tasks one by one, the rest of
   * them together, every other app, and the free memory. The slices add up to
   * the memory installed. Resolves { slices, colors, total }, where `colors` is
   * the map to pass back as `previous` next time.
   */
  function memorySlices(data, { maxOwners = 5, labelFor, previous } = {}) {
    const totals = memoryTotals(data);
    const owners = [...(data?.owners || [])]
      .filter(owner => owner.rssBytes > 0)
      .sort((a, b) => b.rssBytes - a.rssBytes);
    const count = Math.min(maxOwners, COLORS.owners.length);
    const shown = owners.slice(0, count);
    const rest = owners.slice(count);
    const colors = assignColors(previous, shown.map(ownerKey), count);
    const label = (owner) => (labelFor ? labelFor(owner) : '') || (owner.kind === 'task' ? 'Task' : 'Session');

    const slices = [];
    const appBytes = Math.max(0, totals.ours - totals.ownersBytes);
    slices.push({ key: 'app', kind: 'app', label: 'Switchboard', bytes: appBytes, color: COLORS.app });
    for (const owner of shown) {
      const key = ownerKey(owner);
      slices.push({ key, kind: owner.kind === 'task' ? 'task' : 'session', label: label(owner), bytes: owner.rssBytes, color: COLORS.owners[colors[key]], owner });
    }
    if (rest.length) {
      const bytes = rest.reduce((sum, owner) => sum + owner.rssBytes, 0);
      slices.push({ key: 'other-owners', kind: 'other-owners', label: `${rest.length} other${rest.length === 1 ? '' : 's'}`, bytes, color: COLORS.otherOwners, count: rest.length });
    }
    if (totals.used !== null) {
      slices.push({ key: 'other-apps', kind: 'other-apps', label: 'Other apps', bytes: Math.max(0, totals.used - totals.ours), color: COLORS.otherApps });
    }
    const usedSoFar = slices.reduce((sum, slice) => sum + slice.bytes, 0);
    slices.push({ key: 'free', kind: 'free', label: 'Free', bytes: Math.max(0, totals.installed - usedSoFar), color: COLORS.free });
    return { slices, colors, total: Math.max(totals.installed, usedSoFar) };
  }

  /**
   * How close the memory in use is to what is installed: 'mid' (amber) from
   * 90%, 'high' (red) from 95%. 'low' when a desktop too old to measure it.
   */
  function ramLevel(totals) {
    if (!totals?.installed || totals.used == null) return 'low';
    const share = totals.used / totals.installed;
    return share >= 0.95 ? 'high' : share >= 0.9 ? 'mid' : 'low';
  }

  /** How full a disk is, 0 to 1, and its level: amber under 20% free, red under 10%. */
  function diskLevel(disk) {
    if (!disk?.totalBytes) return { used: 0, level: 'low' };
    const free = disk.freeBytes / disk.totalBytes;
    return { used: Math.min(1, Math.max(0, 1 - free)), level: free < 0.1 ? 'high' : free < 0.2 ? 'mid' : 'low' };
  }

  /**
   * The disk ring. Without project sizes: used, coloured by how full the disk
   * is, then free. With them (disk-usage.js): the largest projects one by one
   * (each counted once over all projects, so the slices add up), the rest of
   * them together, every other file, then free. A project slice draws its
   * share of the ring (`bytes`) but shows its own size (`display`), which is
   * larger when a folder is shared with a project drawn before it.
   */
  function diskSlices(disk, { projects, maxProjects = 5, previous } = {}) {
    const total = disk?.totalBytes || 0;
    const free = Math.min(total, Math.max(0, disk?.freeBytes || 0));
    const used = total - free;
    const { level } = diskLevel(disk);
    const color = level === 'high' ? COLORS.diskHigh : level === 'mid' ? COLORS.diskMid : COLORS.diskLow;
    const freeSlice = { key: 'free', kind: 'free', label: 'Free', bytes: free, color: COLORS.free };
    const measured = (projects || []).filter(project => project.ringBytes > 0 || project.bytes > 0);
    if (!measured.length) {
      return { level, total, colors: previous || {}, slices: [{ key: 'used', kind: 'used', label: 'Used', bytes: used, color }, freeSlice] };
    }
    const count = Math.min(maxProjects, COLORS.owners.length);
    const ordered = [...measured].sort((a, b) => b.ringBytes - a.ringBytes || b.bytes - a.bytes);
    const shown = ordered.slice(0, count);
    const rest = ordered.slice(count);
    const keyOf = (project) => `project:${project.id}`;
    const colors = assignColors(previous, shown.map(keyOf), count);
    const slices = shown.map(project => ({
      key: keyOf(project),
      kind: 'project',
      label: project.name,
      bytes: project.ringBytes,
      display: project.bytes,
      color: COLORS.owners[colors[keyOf(project)]],
      project,
    }));
    if (rest.length) {
      slices.push({
        key: 'other-projects',
        kind: 'other-projects',
        label: `${rest.length} other project${rest.length === 1 ? '' : 's'}`,
        bytes: rest.reduce((sum, project) => sum + project.ringBytes, 0),
        color: COLORS.otherOwners,
        projects: rest,
      });
    }
    // Projects never take more than what is used (a folder on another disk is measured too).
    let projectBytes = slices.reduce((sum, slice) => sum + slice.bytes, 0);
    if (projectBytes > used && projectBytes > 0) {
      const scale = used / projectBytes;
      for (const slice of slices) slice.bytes = Math.round(slice.bytes * scale);
      projectBytes = used;
    }
    slices.push({ key: 'other-files', kind: 'other-files', label: 'Other files', bytes: Math.max(0, used - projectBytes), color: COLORS.otherApps });
    slices.push(freeSlice);
    return { level, total, colors, slices };
  }

  const round = (n) => Math.round(n * 100) / 100;

  function point(cx, cy, r, angle) {
    return [round(cx + r * Math.sin(angle)), round(cy - r * Math.cos(angle))];
  }

  function sector(cx, cy, outer, inner, start, end) {
    const large = end - start > Math.PI ? 1 : 0;
    const [x0, y0] = point(cx, cy, outer, start);
    const [x1, y1] = point(cx, cy, outer, end);
    const [x2, y2] = point(cx, cy, inner, end);
    const [x3, y3] = point(cx, cy, inner, start);
    return `M${x0} ${y0}A${outer} ${outer} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${inner} ${inner} 0 ${large} 0 ${x3} ${y3}Z`;
  }

  /**
   * SVG paths for a ring of slices, clockwise from the top, with a small gap
   * between slices. Slices of 0 get no path; a small one still gets a sliver
   * (`minAngle`, taken from the large ones) so that it can be seen and pointed
   * at; a slice that is the whole ring is drawn as two halves (one arc cannot
   * close a circle). Resolves [{ key, d }].
   */
  function donutPaths(slices, { size = 120, thickness = 14, gap = 2, minAngle = 0.05 } = {}) {
    const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.bytes || 0), 0);
    if (!total) return [];
    const outer = size / 2;
    const inner = Math.max(0, outer - thickness);
    const c = size / 2;
    const visible = slices.filter(slice => slice.bytes > 0);
    const pad = visible.length > 1 ? gap / outer / 2 : 0;
    let sweeps = visible.map(slice => (slice.bytes / total) * Math.PI * 2);
    const least = minAngle + 2 * pad;
    const extra = sweeps.reduce((sum, w) => sum + (w < least ? least - w : 0), 0);
    const large = sweeps.reduce((sum, w) => sum + (w < least ? 0 : w), 0);
    if (extra > 0 && large > extra) sweeps = sweeps.map(w => (w < least ? least : w - extra * (w / large)));
    const paths = [];
    let angle = 0;
    for (const [i, slice] of visible.entries()) {
      const sweep = sweeps[i];
      const start = angle + pad;
      const end = angle + sweep - pad;
      angle += sweep;
      if (end - start <= 0.002) continue;
      if (end - start >= Math.PI * 2 - 0.0001) {
        const mid = start + Math.PI;
        paths.push({ key: slice.key, d: sector(c, c, outer, inner, start, mid) + sector(c, c, outer, inner, mid, end - 0.0001) });
      } else {
        paths.push({ key: slice.key, d: sector(c, c, outer, inner, start, end) });
      }
    }
    return paths;
  }

  /** "27.4": gigabytes with one decimal, without a trailing ".0". */
  function gigabytes(bytes) {
    const value = Math.round((bytes / GB) * 10) / 10;
    return String(value).replace(/\.0$/, '');
  }

  /** "412 / 994 GB" or "1.2 / 2 TB", in the units the computer uses for disks. */
  function diskPair(used, total, platform) {
    const base = platform === 'darwin' ? 1000 : 1024;
    const tb = base ** 4;
    const unit = total >= tb ? tb : base ** 3;
    const fmt = (bytes) => {
      const value = bytes / unit;
      if (unit === tb || value < 100) return String(Math.round(value * 10) / 10).replace(/\.0$/, '');
      return String(Math.round(value));
    };
    return `${fmt(used)} / ${fmt(total)} ${unit === tb ? 'TB' : 'GB'}`;
  }

  /**
   * The status bar's short line: "RAM 4.1 / 27.4 / 36 GB" (Switchboard and
   * its sessions / in use on the computer / installed) and "Disk 412 / 994 GB"
   * (used / size of the main disk), each with its level ('low', 'mid' amber,
   * 'high' red), and a plain-words title for the tooltip.
   */
  function resourceStatus(data) {
    if (!data) return { ram: '', disk: '', title: '', ramLevel: 'low', diskLevel: 'low' };
    const totals = memoryTotals(data);
    const ram = totals.installed
      ? `RAM ${[totals.ours, ...(totals.used === null ? [] : [totals.used]), totals.installed].map(gigabytes).join(' / ')} GB`
      : '';
    const disk = (data.disks || [])[0];
    const platform = data.platform;
    const diskText = disk?.totalBytes ? `Disk ${diskPair(disk.totalBytes - disk.freeBytes, disk.totalBytes, platform)}` : '';
    const memory = ram ? ramLevel(totals) : 'low';
    const space = diskText ? diskLevel(disk).level : 'low';
    const lines = [];
    if (ram) {
      const parts = [`Switchboard and its sessions ${formatBytes(totals.ours)}`];
      if (totals.used !== null) parts.push(`in use on this computer ${formatBytes(totals.used)}`);
      parts.push(`installed ${formatBytes(totals.installed)}`);
      const warn = memory === 'high' ? ' — memory almost full' : memory === 'mid' ? ' — memory running low' : '';
      lines.push(`RAM: ${parts.join(' · ')}${warn}`);
    }
    if (diskText) {
      const warn = space === 'high' ? ' — disk almost full' : space === 'mid' ? ' — disk low on space' : '';
      lines.push(`Disk${disk.name ? ` (${disk.name})` : ''}: ${formatDisk(disk.totalBytes - disk.freeBytes, platform)} used of ${formatDisk(disk.totalBytes, platform)} · ${formatDisk(disk.freeBytes, platform)} free${warn}`);
    }
    return { ram, disk: diskText, title: lines.join('\n'), ramLevel: memory, diskLevel: space };
  }

  const api = {
    COLORS,
    formatBytes,
    formatDisk,
    formatPercent,
    ownerKey,
    memoryTotals,
    assignColors,
    memorySlices,
    ramLevel,
    diskLevel,
    diskSlices,
    donutPaths,
    resourceStatus,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.UsageChart = api;
})(typeof window !== 'undefined' ? window : globalThis);
