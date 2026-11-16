// git-diff-model.js — the diff of one file, as `git diff` prints it, read into
// hunks and lines; and a patch made of some of those lines, to stage or
// unstage part of a file the way a Git client does.
//
// Lines are named by their index in diff.split('\n'), so the Git tab (desktop
// and phone) and the main process, which builds and applies the patch, agree
// on what was picked without sending the patch itself.
//
// Shared with the phone app (scripts/sync-shared.mjs there): no DOM, no Node.
(function (root) {
  const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

  /**
   * { lines, header: [index], hunks: [{ index, header, oldStart, oldCount,
   * newStart, newCount, section, lines: [{ index, kind, text, oldLine,
   * newLine }] }], binary, files, isNew, isDeleted, isRename, hasModeChange }.
   * kind is 'context', 'add', 'remove' or 'eof' (the "\ No newline at end of
   * file" note, which belongs to the line before it).
   */
  function parseUnifiedDiff(text) {
    const lines = String(text || '').split('\n');
    const parsed = {
      lines, header: [], hunks: [], binary: false, files: 0,
      isNew: false, isDeleted: false, isRename: false, hasModeChange: false,
    };
    let hunk = null;
    let oldLeft = 0;
    let newLeft = 0;
    let oldLine = 0;
    let newLine = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (hunk && (oldLeft > 0 || newLeft > 0)) {
        const c = line[0];
        // diff.suppressBlankEmpty prints an empty context line as nothing at all.
        if (c === ' ' || line === '') {
          hunk.lines.push({ index: i, kind: 'context', text: line.slice(1), oldLine, newLine });
          oldLine += 1; newLine += 1; oldLeft -= 1; newLeft -= 1;
          continue;
        }
        if (c === '-' && oldLeft > 0) {
          hunk.lines.push({ index: i, kind: 'remove', text: line.slice(1), oldLine, newLine: null });
          oldLine += 1; oldLeft -= 1;
          continue;
        }
        if (c === '+' && newLeft > 0) {
          hunk.lines.push({ index: i, kind: 'add', text: line.slice(1), oldLine: null, newLine });
          newLine += 1; newLeft -= 1;
          continue;
        }
        if (c === '\\') {
          hunk.lines.push({ index: i, kind: 'eof', text: line, oldLine: null, newLine: null });
          continue;
        }
        // A hunk shorter than its header says: stop reading it.
        oldLeft = 0;
        newLeft = 0;
      }
      if (hunk && line[0] === '\\') {
        // The note can follow the very last line of a hunk.
        hunk.lines.push({ index: i, kind: 'eof', text: line, oldLine: null, newLine: null });
        continue;
      }
      const m = HUNK_RE.exec(line);
      if (m) {
        const oldCount = m[2] === undefined ? 1 : Number(m[2]);
        const newCount = m[4] === undefined ? 1 : Number(m[4]);
        hunk = {
          index: i, header: line,
          oldStart: Number(m[1]), oldCount, newStart: Number(m[3]), newCount,
          section: (m[5] || '').trim(), lines: [],
        };
        parsed.hunks.push(hunk);
        oldLeft = oldCount;
        newLeft = newCount;
        oldLine = hunk.oldStart;
        newLine = hunk.newStart;
        continue;
      }
      hunk = null;
      if (i === lines.length - 1 && line === '') continue;
      if (line.startsWith('diff --git ') || line.startsWith('diff --cc ') || line.startsWith('diff --combined ')) parsed.files += 1;
      if (/^Binary files |^GIT binary patch/.test(line)) parsed.binary = true;
      if (line.startsWith('new file mode ') || line === '--- /dev/null') parsed.isNew = true;
      if (line.startsWith('deleted file mode ') || line === '+++ /dev/null') parsed.isDeleted = true;
      if (/^(rename|copy) (from|to) /.test(line) || line.startsWith('similarity index ')) parsed.isRename = true;
      if (line.startsWith('old mode ') || line.startsWith('new mode ')) parsed.hasModeChange = true;
      if (line.startsWith('diff --cc ') || line.startsWith('diff --combined ')) parsed.combined = true;
      parsed.header.push(i);
    }
    return parsed;
  }

  /** The indices of the lines that can be picked: every added or removed line. */
  function changedLineIndices(parsed, hunkIndex = null) {
    const hunks = hunkIndex === null ? parsed.hunks : [parsed.hunks[hunkIndex]].filter(Boolean);
    const out = [];
    for (const hunk of hunks) {
      for (const line of hunk.lines) if (line.kind === 'add' || line.kind === 'remove') out.push(line.index);
    }
    return out;
  }

  /**
   * Whether lines (and hunks) of this diff can be staged on their own. A
   * binary file, a rename, a mode change or a merge conflict only goes as a
   * whole file.
   */
  function canPickLines(parsed) {
    return !!parsed && !parsed.binary && !parsed.combined && !parsed.isRename && !parsed.hasModeChange
      && parsed.files <= 1 && parsed.hunks.length > 0;
  }

  /**
   * A patch with only the picked lines of `parsed`, or null when none is
   * picked. `reverse` is for a staged diff (HEAD → index) applied in reverse
   * to the index, which unstages the picked lines; otherwise the diff is the
   * unstaged one (index → working tree), applied to the index as it is.
   *
   * Applied forward, a line left out must not change the index: an added line
   * is dropped and a removed one becomes context. In reverse, the patch's new
   * side is what the index holds, so it is the other way round.
   */
  function buildPartialPatch(parsed, picked, { reverse = false } = {}) {
    const chosen = picked instanceof Set ? picked : new Set(picked || []);
    const changed = changedLineIndices(parsed);
    const any = changed.some(index => chosen.has(index));
    if (!any) return null;
    const all = changed.every(index => chosen.has(index));
    // A new file staged in part is still created with the picked lines; a
    // deleted file (or, in reverse, an added one) kept in part is changed, not
    // deleted, so its header says so.
    const toModification = !all && ((!reverse && parsed.isDeleted) || (reverse && parsed.isNew));
    const out = [];
    let plusPath = null;
    let minusPath = null;
    for (const index of parsed.header) {
      const line = parsed.lines[index];
      if (line.startsWith('index ')) continue;
      if (line.startsWith('--- ') && line !== '--- /dev/null') minusPath = line;
      if (line.startsWith('+++ ') && line !== '+++ /dev/null') plusPath = line;
    }
    for (const index of parsed.header) {
      const line = parsed.lines[index];
      if (line.startsWith('index ')) continue;
      if (toModification) {
        if (line.startsWith('new file mode ') || line.startsWith('deleted file mode ')) continue;
        if (line === '+++ /dev/null' && minusPath) { out.push(minusPath.replace(/^--- ("?)a\//, '+++ $1b/')); continue; }
        if (line === '--- /dev/null' && plusPath) { out.push(plusPath.replace(/^\+\+\+ ("?)b\//, '--- $1a/')); continue; }
      }
      out.push(line);
    }
    let delta = 0; // new side minus old side, over the hunks written so far
    for (const hunk of parsed.hunks) {
      if (!hunk.lines.some(line => (line.kind === 'add' || line.kind === 'remove') && chosen.has(line.index))) continue;
      const body = [];
      let oldCount = 0;
      let newCount = 0;
      let lastKept = false;
      for (const line of hunk.lines) {
        if (line.kind === 'eof') {
          if (lastKept) body.push(line.text);
          continue;
        }
        const on = chosen.has(line.index);
        let kind = line.kind;
        if (kind === 'add' && !on) kind = reverse ? 'context' : null;
        else if (kind === 'remove' && !on) kind = reverse ? null : 'context';
        if (!kind) { lastKept = false; continue; }
        lastKept = true;
        if (kind === 'context') { body.push(' ' + line.text); oldCount += 1; newCount += 1; }
        else if (kind === 'add') { body.push('+' + line.text); newCount += 1; }
        else { body.push('-' + line.text); oldCount += 1; }
      }
      // One side keeps the source's numbering: the old side applied forward,
      // the new side (the index) in reverse. An empty side names the line
      // before it, as git writes it. (git apply runs with --recount, so the
      // counts are checked again; the starts tell it where to look.)
      let oldStart = hunk.oldStart;
      let newStart = hunk.newStart;
      if (reverse) {
        oldStart = oldCount === 0 ? newStart - 1 - delta : newCount === 0 ? newStart + 1 - delta : newStart - delta;
      } else {
        newStart = newCount === 0 ? oldStart - 1 + delta : oldCount === 0 ? oldStart + 1 + delta : oldStart + delta;
      }
      oldStart = Math.max(0, oldStart);
      newStart = Math.max(0, newStart);
      delta += newCount - oldCount;
      out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${hunk.section ? ' ' + hunk.section : ''}`);
      out.push(...body);
    }
    return out.join('\n') + '\n';
  }

  const api = { parseUnifiedDiff, changedLineIndices, canPickLines, buildPartialPatch };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GitDiffModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
