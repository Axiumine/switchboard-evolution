// pull-request-search.js — the Pull Requests view's search box, its People
// filter and its Prompt menu: the parts with no document and no window.api,
// so node --test loads them (project-pull-requests-view.js paints and asks).
//
// The search takes words, and every word must be found in a pull request: in
// its title, its number (#12), its description, its comments, or the path of
// one of its changed files. Never in its code. A word with * or ? is a pattern
// for the files: *.sql finds the pull requests that change a .sql file. A
// pattern without a slash is matched against a file's name, one with a slash
// against the end of its path (a leading / against the whole path), and **
// crosses folders. "Quotes" keep words together. Case is ignored.
//
// The title is on the row already; the rest comes from GitHub per pull
// request (pull-request-search.js in main), so until it has come a pull
// request matches only by its title, and one that does not is held back.

// --- The search ---

/** A glob as a RegExp over a name or a path: * and ? stay in one folder, ** crosses them. */
function prGlobRegExp(pattern) {
  let out = '';
  const text = String(pattern || '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '*') {
      if (text[i + 1] === '*') {
        if (text[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

/** The search box's text as terms: { raw, terms: [{ kind: 'text', text, lower, number } | { kind: 'glob', text, re, path, anchored }] }. */
function prParseSearch(text) {
  const raw = String(text || '').trim();
  const terms = [];
  const seen = new Set();
  const re = /"([^"]*)"?|(\S+)/g;
  let m;
  while ((m = re.exec(raw))) {
    const quoted = m[1] !== undefined;
    const value = (quoted ? m[1] : m[2]).trim();
    const key = `${quoted ? 'q' : 'w'}:${value.toLowerCase()}`;
    if (!value || seen.has(key)) continue;
    seen.add(key);
    if (!quoted && /[*?]/.test(value)) {
      const anchored = value.startsWith('/');
      const pattern = anchored ? value.slice(1) : value;
      terms.push({ kind: 'glob', text: value, re: prGlobRegExp(pattern), path: pattern.includes('/'), anchored });
    } else {
      const number = /^#(\d+)$/.exec(value);
      terms.push({ kind: 'text', text: value, lower: value.toLowerCase(), number: number ? Number(number[1]) : null });
    }
  }
  return { raw, terms };
}

/** True when a file's path answers a pattern term. */
function prGlobMatches(term, filePath) {
  const p = String(filePath || '');
  if (!term.path) return term.re.test(p.slice(p.lastIndexOf('/') + 1));
  if (term.re.test(p)) return true;
  if (term.anchored) return false;
  for (let i = p.indexOf('/'); i !== -1; i = p.indexOf('/', i + 1)) {
    if (term.re.test(p.slice(i + 1))) return true;
  }
  return false;
}

/**
 * Whether a pull request answers the search, and where: { match, where }.
 * `match` is true, false, or null while its texts have not come and its title
 * alone does not answer every word. `where` is { title, body, comments (how
 * many), files (the paths found) }.
 */
function prSearchMatch(pr, texts, search) {
  const where = { title: false, body: false, comments: 0, files: [] };
  if (!search || !search.terms.length) return { match: true, where };
  const title = String(pr.title || '').toLowerCase();
  const body = texts ? String(texts.body || '').toLowerCase() : '';
  const comments = texts ? (texts.comments || []).map(c => String(c).toLowerCase()) : [];
  const files = texts ? (texts.files || []) : [];
  const hitComments = new Set();
  const hitFiles = new Set();
  let missing = false;
  for (const term of search.terms) {
    let found = false;
    if (term.kind === 'glob') {
      for (const f of files) if (prGlobMatches(term, f)) { hitFiles.add(f); found = true; }
    } else {
      if (term.number !== null && term.number === pr.number) found = true;
      if (title.includes(term.lower)) { where.title = true; found = true; }
      if (body.includes(term.lower)) { where.body = true; found = true; }
      comments.forEach((c, i) => { if (c.includes(term.lower)) { hitComments.add(i); found = true; } });
      for (const f of files) if (f.toLowerCase().includes(term.lower)) { hitFiles.add(f); found = true; }
    }
    if (!found) missing = true;
  }
  where.comments = hitComments.size;
  where.files = [...hitFiles];
  if (!missing) return { match: true, where };
  return { match: texts ? false : null, where };
}

/** The texts read for a pull request are behind it when GitHub has changed it since. */
function prTextsStale(texts, pr) {
  if (!texts) return true;
  if (!pr.updatedAt || !texts.updatedAt) return false;
  return String(texts.updatedAt) < String(pr.updatedAt);
}

/** "description, 2 comments and 3 files": where the words were found beyond the title. */
function prSearchWhereText(where) {
  if (!where) return '';
  const parts = [];
  if (where.body) parts.push('description');
  if (where.comments) parts.push(`${where.comments} comment${where.comments === 1 ? '' : 's'}`);
  if (where.files && where.files.length) parts.push(`${where.files.length} file${where.files.length === 1 ? '' : 's'}`);
  if (parts.length < 2) return parts[0] || '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function prSearchEscape(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Where the search's words are in `text`, as [start, end] ranges, merged and in order. */
function prSearchRanges(text, search) {
  const words = (search?.terms || []).filter(t => t.kind === 'text').map(t => t.lower).filter(Boolean);
  if (!words.length) return [];
  const lower = String(text || '').toLowerCase();
  const ranges = [];
  for (const word of words) {
    for (let i = lower.indexOf(word); i !== -1; i = lower.indexOf(word, i + word.length)) ranges.push([i, i + word.length]);
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** `text` as HTML with the search's words marked; `whole` marks all of it (a file a pattern found). */
function prMarkHtml(text, search, { whole = false } = {}) {
  const value = String(text ?? '');
  if (whole && value) return `<mark class="pr-hit">${prSearchEscape(value)}</mark>`;
  const ranges = prSearchRanges(value, search);
  if (!ranges.length) return prSearchEscape(value);
  let out = '';
  let at = 0;
  for (const [start, end] of ranges) {
    out += prSearchEscape(value.slice(at, start)) + `<mark class="pr-hit">${prSearchEscape(value.slice(start, end))}</mark>`;
    at = end;
  }
  return out + prSearchEscape(value.slice(at));
}

/** True when a file's path is one the search found: a pattern answers it, or a word is in it. */
function prFileHit(filePath, search) {
  if (!search || !search.terms.length) return false;
  const lower = String(filePath || '').toLowerCase();
  return search.terms.some(t => (t.kind === 'glob' ? prGlobMatches(t, filePath) : lower.includes(t.lower)));
}

/**
 * Mark the search's words in the text under `roots` (GitHub's HTML of a
 * message, already in the page): each found piece goes in a <mark>. Fields,
 * code blocks' own markup and marks already there are left alone. Returns how
 * many pieces were marked.
 */
function prMarkIn(roots, search) {
  const list = roots && typeof roots.length === 'number' ? [...roots] : (roots ? [roots] : []);
  let count = 0;
  for (const root of list) {
    const doc = root && root.ownerDocument;
    if (!doc || typeof doc.createTreeWalker !== 'function') continue;
    const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.closest('mark.pr-hit, textarea, input, script, style')) continue;
      if (prSearchRanges(node.nodeValue, search).length) nodes.push(node);
    }
    for (const node of nodes) {
      const text = node.nodeValue;
      const fragment = doc.createDocumentFragment();
      let at = 0;
      for (const [start, end] of prSearchRanges(text, search)) {
        if (start > at) fragment.appendChild(doc.createTextNode(text.slice(at, start)));
        const mark = doc.createElement('mark');
        mark.className = 'pr-hit';
        mark.textContent = text.slice(start, end);
        fragment.appendChild(mark);
        at = end;
        count++;
      }
      if (at < text.length) fragment.appendChild(doc.createTextNode(text.slice(at)));
      node.parentNode.replaceChild(fragment, node);
    }
  }
  return count;
}

// --- People ---

/**
 * The People filter's choices: every author among `items`, with how many of
 * them each wrote, the account's own first, then the busiest; anyone chosen
 * and not among them stays, with 0, so they can be taken off.
 */
function prPeopleChoices(items, chosen = []) {
  const byLogin = new Map();
  for (const pr of items || []) {
    const login = pr.author || 'ghost';
    const entry = byLogin.get(login) || { login, count: 0, avatar: null, you: false };
    entry.count++;
    if (pr.viewerDidAuthor) entry.you = true;
    if (!entry.avatar && pr.authorAvatar) entry.avatar = pr.authorAvatar;
    byLogin.set(login, entry);
  }
  for (const login of chosen || []) if (!byLogin.has(login)) byLogin.set(login, { login, count: 0, avatar: null, you: false });
  return [...byLogin.values()].sort((a, b) => (Number(b.you) - Number(a.you)) || (b.count - a.count) || a.login.localeCompare(b.login));
}

/** The People button's words: Everyone, one or two names, or how many people. */
function prPeopleLabel(people) {
  const list = people || [];
  if (!list.length) return 'Everyone';
  if (list.length <= 2) return list.join(', ');
  return `${list.length} people`;
}

/** The people chosen with `login` added or taken off; none chosen is everyone. */
function prTogglePerson(people, login) {
  const list = people || [];
  return list.includes(login) ? list.filter(l => l !== login) : [...list, login];
}

function prByPeople(pr, people) {
  return !people || !people.length || people.includes(pr.author || 'ghost');
}

// --- Prompt ---

const PR_PROMPTS = [
  ['numbers', 'Numbers'],
  ['titles', 'Numbers and titles'],
];

/** What gh's --repo takes: OWNER/REPO on github.com, HOST/OWNER/REPO elsewhere. */
function prRepoRef(repo) {
  const name = repo?.nameWithOwner || '';
  let host = 'github.com';
  try { host = new URL(repo?.url || '').host || host; } catch {}
  return host === 'github.com' ? name : `${host}/${name}`;
}

/**
 * A prompt, in English, for an agent to read the pull requests shown, through
 * the GitHub CLI: their numbers (`numbers`) or their numbers and titles
 * (`titles`). Empty without pull requests.
 */
function prPromptText(kind, prs, repo) {
  const list = (prs || []).filter(pr => pr && Number.isInteger(pr.number));
  if (!list.length) return '';
  const ref = prRepoRef(repo);
  const these = list.length === 1 ? 'this pull request' : `these ${list.length} pull requests`;
  const where = ref ? ` in ${ref}` : '';
  const head = kind === 'titles'
    ? `Get the information about ${these}${where} on GitHub:\n${list.map(pr => `- #${pr.number} ${String(pr.title || '').trim()}`.trimEnd()).join('\n')}`
    : `Get the information about ${these}${where} on GitHub: ${list.map(pr => `#${pr.number}`).join(', ')}.`;
  const repoArg = ref ? ` --repo ${ref}` : '';
  const each = list.length === 1 ? 'Read with the GitHub CLI' : 'For each one, read with the GitHub CLI';
  return `${head}

${each}:
- its title, state, author, branches, description, reviews and comments: gh pr view <number>${repoArg} --comments
- its changed files: gh pr diff <number>${repoArg} --name-only
- its checks: gh pr checks <number>${repoArg}
`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    prGlobRegExp, prParseSearch, prGlobMatches, prSearchMatch, prTextsStale, prSearchWhereText, prSearchRanges, prMarkHtml, prFileHit, prMarkIn,
    prPeopleChoices, prPeopleLabel, prTogglePerson, prByPeople,
    PR_PROMPTS, prRepoRef, prPromptText,
  };
}
