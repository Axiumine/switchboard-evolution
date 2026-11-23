// project-knowledge-agents.js — the Node Knowledge tab and the project's
// agents: "Ask an agent" starts a session on one of codebase-memory-mcp's
// prompts (explore_codebase, review_change_impact), written for the folder's
// graph; and the agents' integration that CBM's own installer sets up
// (previewed with --dry-run first).

function knAskAgentButtonHtml(kind) {
  const title = kind === 'review' ? 'Start a session that reviews this change with the graph: callers, tests, boundaries, risks' : 'Start a session that answers a question about this code, graph first';
  return `<button type="button" class="ws-ghost ws-ghost--sm ws-ghost--accent" data-kn-act="ask-agent" data-kn-ask="${kind}" title="${escapeAttr(title)}">${PICONS.messages(11)}<span>Ask an agent…</span></button>`;
}

function knWireAskAgent(project, view, folder, defaults) {
  view.querySelectorAll('[data-kn-act="ask-agent"]').forEach(btn => {
    btn.onclick = () => knAskAgent(project, folder, btn.dataset.knAsk, typeof defaults === 'function' ? defaults() : defaults || {});
  });
}

/** A dialog: the question (or the change), the CLI; then the session starts with CBM's prompt. */
function knAskAgent(project, folder, kind, defaults = {}) {
  const review = kind === 'review';
  const clis = typeof LAUNCH_CLIS !== 'undefined' ? LAUNCH_CLIS : ['claude'];
  const cliOptions = clis.map(c => `<option value="${escapeAttr(c)}">${escapeHtml(typeof harnessLabel === 'function' ? harnessLabel(c) : c)}</option>`).join('');
  const fields = review
    ? `<label class="gg-field"><span class="gg-field-label">The change</span><input type="text" class="gg-field-input" data-kn-field="change" value="${escapeAttr(defaults.change || 'the uncommitted changes')}"></label>
       <label class="gg-field"><span class="gg-field-label">Base branch (empty: main or master)</span><input type="text" class="gg-field-input" data-kn-field="base" value="${escapeAttr(defaults.base_branch || '')}"></label>`
    : `<label class="gg-field"><span class="gg-field-label">Question about ${escapeHtml(pathBasename(folder))}</span><textarea class="gg-field-input" data-kn-field="question" rows="3" placeholder="How does a request reach the database?">${escapeHtml(defaults.question || '')}</textarea></label>`;
  const handle = gitGraphOpenDialog({
    title: review ? 'Review the change with an agent' : 'Ask an agent about the code',
    bodyHtml: `${fields}<label class="gg-field"><span class="gg-field-label">Agent</span><select class="gg-field-input" data-kn-field="cli">${cliOptions}</select></label>
      <p class="kn-dialog-text">The session starts in this project with codebase-memory-mcp's ${review ? 'change-impact review' : 'graph-first exploration'} prompt for <span class="mono">${escapeHtml(pathBasename(folder))}</span>.</p>`,
    primaryLabel: 'Start session',
    focusSelector: review ? '[data-kn-field="change"]' : '[data-kn-field="question"]',
    onSubmit: async () => {
      const value = (name) => handle.dialog.querySelector(`[data-kn-field="${name}"]`)?.value?.trim() || '';
      const args = review ? { change: value('change'), base_branch: value('base') } : { question: value('question') };
      if (!review && !args.question) throw new Error('Write the question first');
      const r = await window.api.knowledgePrompt(project.id, folder, review ? 'review_change_impact' : 'explore_codebase', args);
      if (r?.error) throw new Error(r.error);
      const target = typeof launchTargetFor === 'function' ? launchTargetFor(project, null) : project;
      const options = await resolveDefaultSessionOptions(target);
      options.runtime = value('cli') || 'claude';
      options.initialPrompt = r.text;
      handle.close();
      launchNewSession(target, options);
    },
  });
}

/** The agents' integration by CBM's installer: its --dry-run in a dialog, then install. */
async function knInstallAgents(onDone) {
  const preview = await window.api.knowledgeInstallAgents({ dryRun: true });
  if (preview?.error && !preview.output) { alert(preview.error); return; }
  const handle = gitGraphOpenDialog({
    title: 'Set up codebase-memory-mcp for your agents',
    bodyHtml: `<p class="kn-dialog-text">codebase-memory-mcp's installer registers its MCP server with every coding agent it finds on this computer, and adds its skill, its hooks (context only: they never block a tool) and its graph agents. This is what it would change:</p>
      <pre class="kn-source kn-install-preview">${escapeHtml(preview.output || 'Nothing to change.')}</pre>
      <p class="kn-dialog-text">Without it, Switchboard still gives this project's Claude and Codex sessions the server, on their own command line.</p>`,
    primaryLabel: 'Install',
    onSubmit: async () => {
      const r = await window.api.knowledgeInstallAgents({ dryRun: false });
      if (r?.error) throw new Error(`${r.error}${r.output ? `\n${r.output.slice(-600)}` : ''}`);
      handle.close();
      onDone?.(r);
    },
  });
}
