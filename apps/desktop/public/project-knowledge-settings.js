// project-knowledge-settings.js — the Node Knowledge section of the app's
// Settings (settings-panel.js calls knRenderGlobalSettings): which
// codebase-memory-mcp the app runs, and CBM's own settings (`config`), which
// its every process reads, the agents' sessions too. Each one is saved as it
// changes, apart from the panel's Save button, since it lives in CBM.

const KN_CONFIG_FIELDS = [
  { key: 'auto_watch', label: 'Refresh the agents\' projects', help: 'Re-index the project of an agent\'s session when its git state moves.' },
  { key: 'watch_non_git', label: 'Watch folders without git', help: 'Also re-index such folders when files change (a scan of the tree).' },
  { key: 'ignore_worktrees', label: 'Leave git worktrees alone', help: 'Do not index linked worktrees on the automatic paths.' },
  { key: 'auto_index', label: 'Index new projects', help: 'Index a folder when an agent first opens a session in it.' },
  { key: 'auto_index_limit', label: 'Up to', help: 'Files at most, for that automatic index.', number: true },
  { key: 'doc_candidates', label: 'Docs to code', help: 'Link documentation to the code it describes (auto: on in a full index).' },
  { key: 'index_max_files', label: 'Files per index', help: 'A limit, or off.', limit: true },
  { key: 'index_max_source_mb', label: 'Source per index (MB)', help: 'A limit, or off.', limit: true },
  { key: 'index_max_rss_mb', label: 'Memory while indexing (MB)', help: 'A limit, or off.', limit: true },
  { key: 'index_max_duration_seconds', label: 'Time per index (s)', help: 'A limit, or off.', limit: true },
];

function knConfigControl(field, value, keys) {
  const kind = keys[field.key];
  const id = `sv-kn-${field.key}`;
  if (kind === 'bool') return `<label class="settings-toggle"><input type="checkbox" id="${id}" data-kn-key="${field.key}"${value === 'true' ? ' checked' : ''}><span class="settings-toggle-slider"></span></label>`;
  if (Array.isArray(kind)) return `<select class="settings-select" id="${id}" data-kn-key="${field.key}">${kind.map(v => `<option value="${v}"${v === value ? ' selected' : ''}>${v}</option>`).join('')}</select>`;
  // A limit CBM does not list is off.
  const placeholder = kind === 'limit' ? ' placeholder="off"' : '';
  return `<input type="text" class="settings-input settings-input-compact kn-config-input" id="${id}" data-kn-key="${field.key}" value="${escapeAttr(value ?? '')}"${placeholder} spellcheck="false">`;
}

function knSettingsField(label, help, control) {
  return `<div class="settings-field"><div class="settings-field-info"><span class="settings-label">${escapeHtml(label)}</span><div class="settings-description">${help}</div></div><div class="settings-field-control">${control}</div></div>`;
}

async function knRenderGlobalSettings(el) {
  el.innerHTML = '<div class="settings-section-title">Node Knowledge</div><div class="settings-description">Looking for codebase-memory-mcp…</div>';
  const status = await window.api.getKnowledgeBinary();
  const bin = status?.binary || {};
  const found = bin.found;
  const sourceText = { override: 'from SWITCHBOARD_CBM', settings: 'chosen here', agents: 'the one your agents use', installed: 'installed on this computer' }[found?.source] || '';
  let html = '<div class="settings-section-title">Node Knowledge</div>';
  html += knSettingsField('codebase-memory-mcp',
    found
      ? `${escapeHtml(found.version)}, ${escapeHtml(sourceText)}${found.ok ? '' : ` · <span class="kn-error-text">too old: ${escapeHtml(bin.minimum)} or later</span>`}${bin.updateAvailable ? ` · ${escapeHtml(bin.latest)} is out` : ''}<br><span class="kn-mono">${escapeHtml(found.path)}</span>`
      : `Not found. The Node Knowledge tab can download ${escapeHtml(bin.pinned || '')} into <span class="kn-mono">${escapeHtml(bin.installDir || '')}</span>.`,
    `<button class="settings-check-updates-btn" data-kn-act="pick">Choose…</button>${found?.source === 'settings' ? '<button class="settings-check-updates-btn" data-kn-act="default">Use the default</button>' : ''}${!found && bin.canDownload ? '<button class="settings-check-updates-btn" data-kn-act="download">Download</button>' : ''}`);
  if (found?.ok) {
    html += knSettingsField('Your agents', 'codebase-memory-mcp\'s installer registers it with every coding agent on this computer (Claude Code, Codex and many more), with its skill, hooks and graph agents. You see what it would change before it runs.',
      '<button class="settings-check-updates-btn" data-kn-act="agents">Set up…</button>');
  }
  let values = null;
  let keys = {};
  if (found?.ok) {
    const cfg = await window.api.getKnowledgeConfig();
    if (!cfg?.error) { values = cfg.values; keys = cfg.keys; }
  }
  if (values) {
    html += '<div class="settings-description kn-settings-note">codebase-memory-mcp\'s own settings: every CBM process reads them, your agents\' sessions too. Each one saves as it changes; the watcher and Lens ones apply when CBM\'s daemon next starts.</div>';
    for (const field of KN_CONFIG_FIELDS) {
      if (!(field.key in keys)) continue;
      html += knSettingsField(field.label, escapeHtml(field.help), knConfigControl(field, values[field.key], keys));
    }
    html += knSettingsField('CBM Lens', 'codebase-memory-mcp\'s own web view of the graph, shown in the Node Knowledge tab. <span class="kn-error-text">No login</span>: any program on this computer can open it and, through it, read every index or start and delete one. It listens on 127.0.0.1 only; never publish its port through a tunnel.',
      `${knConfigControl({ key: 'ui_enabled' }, values.ui_enabled, keys)}<input type="text" class="settings-input settings-input-compact kn-config-input" data-kn-key="ui_port" value="${escapeAttr(values.ui_port || '9749')}" aria-label="Port" title="Port">`);
  }
  html += '<div class="settings-description kn-settings-saved" data-kn-saved></div>';
  el.innerHTML = html;

  const saved = el.querySelector('[data-kn-saved]');
  const say = (text, bad) => { saved.textContent = text; saved.classList.toggle('kn-error-text', !!bad); };
  el.querySelectorAll('[data-kn-key]').forEach(input => {
    input.addEventListener('change', async () => {
      const key = input.dataset.knKey;
      const value = input.type === 'checkbox' ? String(input.checked) : input.value.trim();
      const r = await window.api.setKnowledgeConfig(key, value);
      if (r?.error) { say(r.error, true); if (input.type !== 'checkbox' && values) input.value = values[key] ?? ''; return; }
      values = r.values;
      say(`Saved ${key.replace(/_/g, ' ')}.`);
    });
  });
  const on = (act, fn) => el.querySelectorAll(`[data-kn-act="${act}"]`).forEach(b => b.addEventListener('click', fn));
  on('agents', () => { if (typeof knInstallAgents === 'function') knInstallAgents(() => say('codebase-memory-mcp is set up for your agents. Restart them to load it.')); });
  on('pick', async () => { const r = await window.api.knowledgePickBinary(); if (!r?.canceled) knRenderGlobalSettings(el); });
  on('default', async () => { await window.api.setKnowledgeGlobal({ binaryPath: '' }); knRenderGlobalSettings(el); });
  on('download', async (e) => {
    e.currentTarget.disabled = true;
    say('Downloading…');
    const r = await window.api.knowledgeDownloadBinary();
    if (r?.error) { say(r.error, true); e.currentTarget.disabled = false; return; }
    knRenderGlobalSettings(el);
  });
}
