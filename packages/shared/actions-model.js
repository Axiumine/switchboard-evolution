// actions-model.js — what the Git tab's Actions view shows, as GitHub's own
// Actions tab does, from the answers of the GitHub REST API (actions.js in the
// desktop's main process normalises them): the state of a run, a job or a step
// and its words, the line under a run that says what started it, durations and
// sizes, the qualifiers of the run search ("is:failure branch:main"), the job
// graph rebuilt from the workflow file, the fields of "Run workflow", the kinds
// of log lines, and the addresses of the pages that stay on GitHub.
//
// Shared with the phone app (scripts/sync-shared.mjs): no DOM, no Node.
(function (root) {
  // --- States ---

  const STATUSES = Object.freeze(['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending']);
  const CONCLUSIONS = Object.freeze(['success', 'failure', 'cancelled', 'skipped', 'neutral', 'timed_out', 'action_required', 'stale', 'startup_failure']);

  // The Status menu and `is:`, in the order GitHub's menu lists them.
  const STATUS_FILTERS = Object.freeze([
    { value: 'success', label: 'Success' },
    { value: 'failure', label: 'Failure' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'skipped', label: 'Skipped' },
    { value: 'in_progress', label: 'In progress' },
    { value: 'queued', label: 'Queued' },
    { value: 'waiting', label: 'Waiting' },
    { value: 'action_required', label: 'Action required' },
    { value: 'startup_failure', label: 'Startup failure' },
    { value: 'timed_out', label: 'Timed out' },
    { value: 'neutral', label: 'Neutral' },
    { value: 'stale', label: 'Stale' },
    { value: 'completed', label: 'Completed' },
    { value: 'requested', label: 'Requested' },
    { value: 'pending', label: 'Pending' },
  ]);

  // bucket: what icon and colour a state gets. label: the word GitHub shows.
  // a11y: what GitHub's run rows say to a screen reader. verb: a job's header.
  const STATE_WORDS = Object.freeze({
    success: { bucket: 'success', label: 'Success', a11y: 'completed successfully', verb: 'succeeded' },
    failure: { bucket: 'failure', label: 'Failure', a11y: 'failed', verb: 'failed' },
    timed_out: { bucket: 'failure', label: 'Timed out', a11y: 'timed out', verb: 'timed out' },
    startup_failure: { bucket: 'failure', label: 'Startup failure', a11y: 'failed at startup', verb: 'failed at startup' },
    cancelled: { bucket: 'cancelled', label: 'Cancelled', a11y: 'cancelled', verb: 'was cancelled' },
    skipped: { bucket: 'skipped', label: 'Skipped', a11y: 'skipped', verb: 'was skipped' },
    neutral: { bucket: 'neutral', label: 'Neutral', a11y: 'completed with a neutral result', verb: 'completed' },
    stale: { bucket: 'neutral', label: 'Stale', a11y: 'stale', verb: 'went stale' },
    action_required: { bucket: 'action', label: 'Action required', a11y: 'requires action with the application', verb: 'needs an action' },
    in_progress: { bucket: 'running', label: 'In progress', a11y: 'currently running', verb: 'is running' },
    queued: { bucket: 'queued', label: 'Queued', a11y: 'queued', verb: 'is queued' },
    requested: { bucket: 'queued', label: 'Requested', a11y: 'requested', verb: 'is requested' },
    pending: { bucket: 'queued', label: 'Pending', a11y: 'pending', verb: 'is pending' },
    waiting: { bucket: 'waiting', label: 'Waiting', a11y: 'waiting', verb: 'is waiting' },
  });

  const ACTIVE = Object.freeze(['queued', 'in_progress', 'waiting', 'requested', 'pending']);

  /** { key, bucket, label, a11y, verb } of a run, a job or a step: the conclusion once it is completed, else the status. */
  function runState(status, conclusion) {
    const s = String(status || '').toLowerCase();
    const c = String(conclusion || '').toLowerCase();
    if (s === 'completed') {
      // Completed without a conclusion yet: GitHub is still wrapping it up.
      if (!c) return { key: 'in_progress', ...STATE_WORDS.in_progress };
      const key = STATE_WORDS[c] ? c : 'neutral';
      return { key, ...STATE_WORDS[key] };
    }
    const key = STATE_WORDS[s] && !CONCLUSIONS.includes(s) ? s : 'queued';
    return { key, ...STATE_WORDS[key] };
  }

  function isActive(status) {
    return ACTIVE.includes(String(status || '').toLowerCase());
  }

  // Of several jobs together (a matrix, a node of the graph), the state that
  // speaks for all of them, as GitHub's graph shows a group.
  const BUCKET_WEIGHT = { failure: 7, action: 6, running: 5, waiting: 4, queued: 3, cancelled: 2, neutral: 1, success: 1, skipped: 0 };

  function groupState(items) {
    const list = (items || []).filter(Boolean);
    if (!list.length) return runState('pending', null);
    let best = null;
    let allSkipped = true;
    for (const item of list) {
      const state = runState(item.status, item.conclusion);
      if (state.bucket !== 'skipped') allSkipped = false;
      if (!best || BUCKET_WEIGHT[state.bucket] > BUCKET_WEIGHT[best.bucket]) best = state;
    }
    if (allSkipped) return runState('completed', 'skipped');
    return best;
  }

  // --- Time and size ---

  function parseTime(value) {
    if (!value) return null;
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }

  /** Milliseconds from `start` to `end` (or `now` while it is still running), or null. */
  function durationMs(start, end, now) {
    const a = parseTime(start);
    if (a === null) return null;
    const b = end ? parseTime(end) : (Number.isFinite(now) ? now : null);
    if (b === null || b < a) return null;
    return b - a;
  }

  /** "45s", "3m 8s", "1h 2m": the way GitHub writes a run's or a job's duration. */
  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '';
    const total = Math.round(ms / 1000);
    if (total < 60) return `${total}s`;
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m < 60) return `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }

  /** How long a run took: from its start to its last update once it has finished, to `now` while it runs. */
  function runDuration(run, now, jobs) {
    if (!run) return null;
    const start = run.startedAt || run.createdAt;
    if (isActive(run.status)) return durationMs(start, null, now);
    // A run changes after it ends (its logs deleted, say): its jobs' ends, when known, say when it did.
    const ends = (jobs || []).map(j => j && j.completedAt).filter(Boolean).sort();
    return durationMs(start, ends.length ? ends[ends.length - 1] : run.updatedAt, now);
  }

  /**
   * Whether a run's page should read it again: while it goes, and for a
   * couple of minutes after it ends while GitHub still shows one of its jobs
   * going (the run and its jobs are read together, and GitHub's copies catch
   * up a moment apart).
   */
  function runStillGoing(run, jobs, now) {
    if (!run) return false;
    if (isActive(run.status)) return true;
    const ended = Date.parse(run.updatedAt || '');
    const at = typeof now === 'number' ? now : Date.now();
    return Number.isFinite(ended) && at - ended < 120000 && (jobs || []).some(j => j && isActive(j.status));
  }

  /** "512 B", "3.4 KB", "12.3 MB", "1.2 GB". */
  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '';
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = n / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')} ${units[unit]}`;
  }

  function shortSha(sha) {
    return String(sha || '').slice(0, 7);
  }

  // --- What started a run ---

  // The events a workflow can run on (docs.github.com, "Events that trigger
  // workflows"), and `dynamic`: runs GitHub starts itself (Copilot, Dependabot,
  // code scanning).
  const EVENTS = Object.freeze([
    'branch_protection_rule', 'check_run', 'check_suite', 'create', 'delete', 'deployment', 'deployment_status',
    'discussion', 'discussion_comment', 'dynamic', 'fork', 'gollum', 'image_version', 'issue_comment', 'issues', 'label',
    'merge_group', 'milestone', 'page_build', 'public', 'pull_request', 'pull_request_review', 'pull_request_review_comment',
    'pull_request_target', 'push', 'registry_package', 'release', 'repository_dispatch', 'schedule', 'status', 'watch',
    'workflow_call', 'workflow_dispatch', 'workflow_run',
  ]);

  /** "pull request" for pull_request: how the run summary says "Triggered via …". */
  function eventWords(event) {
    return String(event || '').replace(/_/g, ' ');
  }

  /**
   * The line under a run in the list: "Commit abc1234 pushed by octocat",
   * "Pull request #12 by octocat", "Scheduled", "Manually run by octocat".
   * The REST API does not say what a pull request or an issue event did
   * (opened, synchronize…), so those lines name the event and who started it.
   */
  function triggerText(run) {
    if (!run) return '';
    const who = run.triggeringActor || run.actor || '';
    const by = who ? ` by ${who}` : '';
    const pr = (run.pullRequests || [])[0];
    switch (run.event) {
      case 'push': return `Commit ${shortSha(run.sha)} pushed${by}`;
      case 'pull_request':
      case 'pull_request_target':
        return pr ? `Pull request #${pr.number}${by}` : `Pull request${by}`;
      case 'pull_request_review': return pr ? `Pull request review on #${pr.number}${by}` : `Pull request review${by}`;
      case 'pull_request_review_comment': return pr ? `Review comment on #${pr.number}${by}` : `Review comment${by}`;
      case 'schedule': return 'Scheduled';
      case 'workflow_dispatch': return `Manually run${by}`;
      case 'merge_group': return 'Merge group checks requested';
      case 'release': return run.branch ? `Release ${run.branch}${by}` : `Release${by}`;
      case 'issue_comment': return `Issue comment${by}`;
      case 'issues': return `Issue${by}`;
      case 'workflow_run': return `Workflow run${by}`;
      case 'repository_dispatch': return `Repository dispatch${by}`;
      case 'dynamic': return who ? `by ${who}` : 'Dynamic';
      default: {
        const words = eventWords(run.event);
        return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}${by}` : by.trim();
      }
    }
  }

  // --- The run search ---

  const QUALIFIERS = Object.freeze(['workflow', 'event', 'is', 'branch', 'actor', 'created']);
  const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;
  const DAY = '\\d{4}-\\d{2}-\\d{2}(?:T\\d{2}:\\d{2}(?::\\d{2})?(?:Z|[+-]\\d{2}:\\d{2})?)?';
  const CREATED = new RegExp(`^(?:(?:[<>]=?)?${DAY}|${DAY}\\.\\.(?:${DAY}|\\*)|\\*\\.\\.${DAY})$`);

  function tokens(text) {
    const out = [];
    const re = /(\w+):"([^"]*)"|(\w+):(\S+)|"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(String(text || ''))) !== null) {
      if (m[1] !== undefined) out.push({ key: m[1].toLowerCase(), value: m[2], quoted: true });
      else if (m[3] !== undefined) out.push({ key: m[3].toLowerCase(), value: m[4] });
      else out.push({ text: m[5] !== undefined ? m[5] : m[6] });
    }
    return out;
  }

  /**
   * The search box's text as { workflow, event, is, branch, actor, created,
   * text }: GitHub's qualifiers (`workflow:"Deploy site"`, `is:failure`,
   * `created:>=2026-11-01`…) and the words left over. The last of a repeated
   * qualifier counts; an unknown `key:value` stays in the words.
   */
  function parseQuery(text) {
    const parsed = { text: '' };
    const words = [];
    for (const token of tokens(text)) {
      if (token.key && QUALIFIERS.includes(token.key)) parsed[token.key] = token.value;
      else if (token.key) words.push(`${token.key}:${token.quoted ? `"${token.value}"` : token.value}`);
      else words.push(token.text);
    }
    parsed.text = words.join(' ');
    return parsed;
  }

  function quote(value) {
    return /[\s"]/.test(value) ? `"${String(value).replace(/"/g, '')}"` : value;
  }

  /** The search box's text for parsed filters, qualifiers first in GitHub's order. */
  function queryString(parsed) {
    const parts = [];
    for (const key of QUALIFIERS) {
      const value = parsed && parsed[key];
      if (value !== undefined && value !== null && value !== '') parts.push(`${key}:${quote(String(value))}`);
    }
    if (parsed && parsed.text) parts.push(parsed.text);
    return parts.join(' ');
  }

  /** `text` with one qualifier set to `value`, or taken out when `value` is empty. */
  function setQualifier(text, key, value) {
    const parsed = parseQuery(text);
    if (value === undefined || value === null || value === '') delete parsed[key];
    else parsed[key] = String(value);
    return queryString(parsed);
  }

  /**
   * What the REST API's run list takes from parsed filters: { params } (actor,
   * branch, event, status, created) and the workflow's name, or { error } for a
   * value GitHub would not take.
   */
  function runFilters(parsed) {
    const p = parsed || {};
    const params = {};
    if (p.is) {
      const value = String(p.is).toLowerCase();
      if (!STATUS_FILTERS.some(s => s.value === value)) return { error: `"is:${p.is}" is not a state GitHub knows` };
      params.status = value;
    }
    if (p.event) {
      const value = String(p.event).toLowerCase();
      if (!/^[a-z_]{1,40}$/.test(value)) return { error: `"event:${p.event}" is not an event` };
      params.event = value;
    }
    if (p.branch) {
      const value = String(p.branch);
      if (value.length > 255 || /[\x00-\x20\x7f~^:?*[\\]/.test(value) || value.startsWith('-')) return { error: `"branch:${p.branch}" is not a branch name` };
      params.branch = value;
    }
    if (p.actor) {
      if (!LOGIN.test(String(p.actor))) return { error: `"actor:${p.actor}" is not a GitHub login` };
      params.actor = String(p.actor);
    }
    if (p.created) {
      if (!CREATED.test(String(p.created))) return { error: `"created:${p.created}" is not a date GitHub takes (2026-11-01, >=2026-11-01, 2026-11-01..2026-11-15)` };
      params.created = String(p.created);
    }
    const workflow = p.workflow ? String(p.workflow) : null;
    return { params, workflow };
  }

  /** Whether a run matches the free words of the search (GitHub's API has no text search: this looks through a loaded page). */
  function matchesText(run, text) {
    const words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const haystack = [run.title, run.workflow, run.branch, run.actor, run.triggeringActor, shortSha(run.sha), `#${run.number}`, triggerText(run)]
      .filter(Boolean).join(' ').toLowerCase();
    return words.every(w => haystack.includes(w));
  }

  // --- Workflows ---

  function fileName(path) {
    const parts = String(path || '').split('/');
    return parts[parts.length - 1] || '';
  }

  /** The sidebar's order: the active workflows by name, then the disabled ones. */
  function sortWorkflows(list) {
    const rank = w => (String(w.state || '').startsWith('disabled') ? 1 : 0);
    return [...(list || [])].sort((a, b) => rank(a) - rank(b) || String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
  }

  /** "Disabled manually", "Disabled for inactivity", "Disabled in this fork", or '' for an active workflow. */
  function workflowStateText(state) {
    if (state === 'disabled_manually') return 'Disabled manually';
    if (state === 'disabled_inactivity') return 'Disabled for inactivity';
    if (state === 'disabled_fork') return 'Disabled in this fork';
    if (state === 'deleted') return 'Deleted';
    return '';
  }

  /** A workflow's status badge, as "Create status badge" gives it. */
  function badgeUrl({ host = 'github.com', owner, repo, file, branch = '', event = '' }) {
    const query = [];
    if (branch) query.push(`branch=${encodeURIComponent(branch)}`);
    if (event) query.push(`event=${encodeURIComponent(event)}`);
    return `https://${host}/${owner}/${repo}/actions/workflows/${encodeURIComponent(file)}/badge.svg${query.length ? `?${query.join('&')}` : ''}`;
  }

  function badgeMarkdown({ name, host = 'github.com', owner, repo, file, branch = '', event = '' }) {
    const workflowUrl = `https://${host}/${owner}/${repo}/actions/workflows/${encodeURIComponent(file)}`;
    return `[![${String(name || file).replace(/[[\]]/g, '')}](${badgeUrl({ host, owner, repo, file, branch, event })})](${workflowUrl})`;
  }

  // --- "Run workflow" ---

  const INPUT_TYPES = Object.freeze(['string', 'boolean', 'choice', 'number', 'environment']);
  const MAX_INPUTS = 25;
  const MAX_INPUTS_SIZE = 65535;

  function plain(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return '';
    return String(value);
  }

  /**
   * The fields of the "Run workflow" form from a workflow's
   * `on.workflow_dispatch.inputs`: { name, type, description, required,
   * default, options }, in the file's order. An unknown type is a string.
   */
  function dispatchFields(inputs) {
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return [];
    return Object.keys(inputs).map((name) => {
      const def = inputs[name] && typeof inputs[name] === 'object' ? inputs[name] : {};
      const type = INPUT_TYPES.includes(def.type) ? def.type : 'string';
      const options = type === 'choice' && Array.isArray(def.options) ? def.options.map(plain) : [];
      let fallback = plain(def.default);
      if (type === 'boolean') fallback = String(def.default) === 'true' ? 'true' : 'false';
      if (type === 'choice' && !fallback && options.length) fallback = options[0];
      return {
        name,
        type,
        description: plain(def.description),
        required: def.required === true || def.required === 'true',
        default: fallback,
        options,
      };
    });
  }

  /**
   * The inputs to send for the form's values, every value a string as GitHub
   * takes them: { inputs } or { errors: { name: words }, error }.
   */
  function validateDispatch(fields, values) {
    const list = Array.isArray(fields) ? fields : [];
    const given = values && typeof values === 'object' ? values : {};
    const errors = {};
    for (const key of Object.keys(given)) {
      if (!list.some(f => f.name === key)) errors[key] = 'The workflow has no such input';
    }
    const inputs = {};
    for (const field of list) {
      const raw = Object.prototype.hasOwnProperty.call(given, field.name) ? given[field.name] : field.default;
      const value = raw === undefined || raw === null ? '' : String(raw);
      if (field.type === 'boolean') {
        if (value !== 'true' && value !== 'false') { errors[field.name] = 'Either true or false'; continue; }
      } else if (field.type === 'choice') {
        if (value && !field.options.includes(value)) { errors[field.name] = 'Not one of the options'; continue; }
      } else if (field.type === 'number') {
        if (value && !Number.isFinite(Number(value))) { errors[field.name] = 'Not a number'; continue; }
      }
      if (field.required && !value.trim()) { errors[field.name] = 'Required'; continue; }
      inputs[field.name] = value;
    }
    if (list.length > MAX_INPUTS) return { errors, error: `GitHub takes at most ${MAX_INPUTS} inputs; this workflow declares ${list.length}.` };
    if (Object.keys(errors).length) return { errors, error: 'Some inputs need a look.' };
    if (JSON.stringify(inputs).length > MAX_INPUTS_SIZE) return { errors, error: 'The inputs are longer than GitHub takes (65,535 characters together).' };
    return { inputs };
  }

  // --- The job graph ---

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** A job's `name:` with `${{ … }}` in it as a pattern for the names GitHub gives it once evaluated. */
  function namePattern(name) {
    const parts = String(name).split(/\$\{\{[\s\S]*?\}\}/);
    if (parts.length < 2) return null;
    return new RegExp(`^${parts.map(escapeRegExp).join('.+?')}$`);
  }

  function baseOf(apiName) {
    const name = String(apiName || '');
    const slash = name.indexOf(' / ');
    const paren = name.indexOf(' (');
    const cuts = [slash, paren].filter(i => i > 0);
    return cuts.length ? name.slice(0, Math.min(...cuts)) : name;
  }

  /** From the first start to the last end of some jobs (to `now` while one runs), in milliseconds, or null. */
  function spanMs(jobs, now) {
    let start = null;
    let end = null;
    let running = false;
    for (const job of jobs) {
      const a = parseTime(job.startedAt);
      const b = parseTime(job.completedAt);
      if (a !== null && (start === null || a < start)) start = a;
      if (b !== null && (end === null || b > end)) end = b;
      if (isActive(job.status)) running = true;
    }
    if (running) end = Number.isFinite(now) ? now : null;
    if (start === null || end === null || end < start) return null;
    return end - start;
  }

  /**
   * The graph GitHub draws on a run's summary, rebuilt from the workflow
   * file's jobs (`yamlJobs`: { key, name, needs, matrix, uses }) and the jobs
   * the API lists (`apiJobs`: { id, name, status, conclusion, startedAt,
   * completedAt }).
   *
   * An API job belongs to the file's job whose display name (its `name:`, else
   * its key) it carries: the same name, the name and " (…)" for a matrix, the
   * name and " / …" for a reusable workflow's jobs, or the pattern of a name
   * with expressions. Jobs of the file that have not started yet stay in the
   * graph, waiting; API jobs that belong to none go to "Other jobs".
   *
   * Columns follow `needs`: a job stands one column right of the furthest job
   * it needs. Once the run has `finished`, a job of the file that never
   * started was skipped. Returns { columns: [[node]], edges: [{ from, to }], nodes }.
   */
  function graphLayout(yamlJobs, apiJobs, now, finished) {
    const defs = (yamlJobs || []).filter(j => j && j.key);
    const jobs = (apiJobs || []).filter(Boolean);
    const nodes = defs.map(def => ({
      key: def.key,
      name: def.name || def.key,
      needs: (def.needs || []).filter(n => defs.some(d => d.key === n)),
      matrix: !!def.matrix,
      reusable: !!def.uses,
      pattern: def.name ? namePattern(def.name) : null,
      jobs: [],
    }));
    const byName = new Map(nodes.map(n => [n.name, n]));
    const taken = new Set();
    const place = (job, node) => { node.jobs.push(job); taken.add(job); };
    // Exact names first, then a matrix's or a reusable workflow's children, then patterns.
    for (const job of jobs) {
      const node = byName.get(job.name);
      if (node && !node.pattern) place(job, node);
    }
    for (const job of jobs) {
      if (taken.has(job)) continue;
      const node = byName.get(baseOf(job.name));
      if (node && !node.pattern) place(job, node);
    }
    for (const job of jobs) {
      if (taken.has(job)) continue;
      const node = nodes.find(n => n.pattern && (n.pattern.test(job.name) || n.pattern.test(baseOf(job.name))));
      if (node) place(job, node);
    }

    // Depth: the longest chain of needs before a job (a cycle counts as none).
    const depth = new Map();
    const visiting = new Set();
    const depthOf = (node) => {
      if (depth.has(node.key)) return depth.get(node.key);
      if (visiting.has(node.key)) return 0;
      visiting.add(node.key);
      let d = 0;
      for (const need of node.needs) {
        const other = nodes.find(n => n.key === need);
        if (other) d = Math.max(d, depthOf(other) + 1);
      }
      visiting.delete(node.key);
      depth.set(node.key, d);
      return d;
    };

    const out = [];
    for (const node of nodes) {
      const state = node.jobs.length ? groupState(node.jobs) : runState(finished ? 'completed' : 'pending', finished ? 'skipped' : null);
      const single = node.jobs.length <= 1 && !node.matrix && !node.reusable;
      let name = node.name;
      // A name with expressions shows as GitHub evaluated it for a lone job, as its key for a group.
      if (node.pattern) name = single && node.jobs.length ? node.jobs[0].name : node.key;
      out.push({
        key: node.key,
        name,
        needs: node.needs,
        group: !single,
        kind: node.reusable ? 'reusable' : (single ? 'job' : 'matrix'),
        jobs: node.jobs,
        state,
        durationMs: spanMs(node.jobs, now),
        done: node.jobs.filter(j => !isActive(j.status)).length,
        column: depthOf(node),
      });
    }
    const others = jobs.filter(j => !taken.has(j));
    const columns = [];
    for (const node of out) (columns[node.column] = columns[node.column] || []).push(node);
    if (others.length) {
      const column = defs.length ? columns.length : 0;
      for (const job of others) {
        const node = {
          key: `job:${job.id}`, name: job.name, needs: [], group: false, kind: 'job', other: defs.length > 0,
          jobs: [job], state: runState(job.status, job.conclusion),
          durationMs: durationMs(job.startedAt, job.completedAt, now), done: isActive(job.status) ? 0 : 1, column,
        };
        out.push(node);
        (columns[column] = columns[column] || []).push(node);
      }
    }
    const edges = [];
    for (const node of out) for (const need of node.needs) edges.push({ from: need, to: node.key });
    return { columns: columns.filter(Boolean), edges, nodes: out };
  }

  // --- Usage ---

  /** The run time of each job and their sum, as a run's Usage page shows them. */
  function usageRows(jobs, now) {
    const rows = (jobs || []).filter(Boolean).map(job => ({
      id: job.id, name: job.name, state: runState(job.status, job.conclusion), ms: durationMs(job.startedAt, job.completedAt, now),
    }));
    const total = rows.reduce((sum, row) => sum + (row.ms || 0), 0);
    return { rows, total };
  }

  // --- Logs ---

  // GitHub's marks: `##[group]` in a job's log, `[group]` too in a step's.
  const LOG_MARK = /^(?:##)?\[(group|endgroup|error|warning|notice|command|debug|section)\]/;

  /** group, endgroup, error, warning, notice, command, debug, section or plain. */
  function logLineKind(line) {
    const m = LOG_MARK.exec(String(line || ''));
    return m ? m[1] : 'plain';
  }

  /** A log line without its ##[kind] mark. */
  function logLineText(line) {
    return String(line || '').replace(LOG_MARK, '');
  }

  const LOG_TIME = /^\uFEFF?(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) ?/;

  /**
   * The lines of a log as { kind, text, group, time }: what is between
   * ##[group] and ##[endgroup] belongs to the group's line (`group` is that
   * line's index), so a view can fold it; `time` is the timestamp GitHub puts
   * in front of each line, when the log has them.
   */
  function logLines(text) {
    const lines = String(text || '').replace(/\n$/, '').split('\n');
    const out = [];
    let open = null;
    for (const raw of lines) {
      const stamp = LOG_TIME.exec(raw);
      const line = stamp ? raw.slice(stamp[0].length) : raw.replace(/^\uFEFF/, '');
      const time = stamp ? stamp[1] : null;
      const kind = logLineKind(line);
      if (kind === 'endgroup') { open = null; continue; }
      if (kind === 'group') {
        out.push({ kind, text: logLineText(line), group: null, time });
        open = out.length - 1;
        continue;
      }
      out.push({ kind, text: logLineText(line), group: open, time });
    }
    return out;
  }

  /**
   * What a finished step without a log says (GitHub answers 404 for both):
   * while its job runs, the log is not ready yet; once the job is over, the
   * run's logs were deleted or have expired.
   */
  function missingStepLog(jobActive) {
    return jobActive
      ? 'GitHub does not have this step\'s log yet. Try again in a moment.'
      : 'GitHub has no log for this step: the run\'s logs were deleted, or they have expired.';
  }

  /** A log line's time as the clock on this computer reads it, "18:06:38" ('' without one). */
  function logTime(time) {
    // GitHub writes seven digits after the second: not every engine reads more than three.
    const d = time ? new Date(String(time).replace(/(\.\d{3})\d+/, '$1')) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    const two = n => String(n).padStart(2, '0');
    return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
  }

  // --- Addresses ---

  /** { runId, jobId, attempt } from a GitHub Actions address (a check's Details, a deployment's log), or null. */
  function parseActionsUrl(url) {
    const m = /^https:\/\/[^/]+\/([\w.-]+)\/([\w.-]+)\/actions\/runs\/(\d+)(?:\/attempts\/(\d+))?(?:\/job\/(\d+))?/.exec(String(url || ''));
    if (!m) return null;
    return { owner: m[1], repo: m[2], runId: Number(m[3]), attempt: m[4] ? Number(m[4]) : null, jobId: m[5] ? Number(m[5]) : null };
  }

  // The Management pages that stay on GitHub, opened in the app's web panel.
  const GITHUB_PAGES = Object.freeze({
    runners: { label: 'Runners', path: 'settings/actions/runners' },
    newRunner: { label: 'New self-hosted runner', path: 'settings/actions/runners/new' },
    attestations: { label: 'Attestations', path: 'attestations' },
    usageMetrics: { label: 'Usage metrics', path: 'actions/metrics/usage' },
    performanceMetrics: { label: 'Performance metrics', path: 'actions/metrics/performance' },
    caches: { label: 'Caches', path: 'actions/caches' },
    deployments: { label: 'Deployments', path: 'deployments' },
  });

  function githubPage({ host = 'github.com', owner, repo }, page) {
    const spec = GITHUB_PAGES[page];
    return spec ? `https://${host}/${owner}/${repo}/${spec.path}` : null;
  }

  const api = {
    STATUSES,
    CONCLUSIONS,
    STATUS_FILTERS,
    STATE_WORDS,
    EVENTS,
    QUALIFIERS,
    INPUT_TYPES,
    MAX_INPUTS,
    GITHUB_PAGES,
    runState,
    isActive,
    groupState,
    durationMs,
    formatDuration,
    runDuration,
    runStillGoing,
    formatBytes,
    shortSha,
    eventWords,
    triggerText,
    parseQuery,
    queryString,
    setQualifier,
    runFilters,
    matchesText,
    fileName,
    sortWorkflows,
    workflowStateText,
    badgeUrl,
    badgeMarkdown,
    dispatchFields,
    validateDispatch,
    namePattern,
    graphLayout,
    usageRows,
    logLineKind,
    logLineText,
    logLines,
    logTime,
    missingStepLog,
    parseActionsUrl,
    githubPage,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ActionsModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
