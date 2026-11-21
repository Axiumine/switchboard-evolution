// Read a transcript a bit at a time: only the lines written since the last
// read. The cursor is a byte offset just past the last complete line, so a
// line the CLI is still writing is left for the next read.

const fs = require('fs');

/**
 * The parsed entries after `cursor`, and the cursor for the next read. When
 * the file is shorter than the cursor (it was rewritten), reading starts over
 * from the top and `reset` is true.
 */
function readTranscriptSince(filePath, cursor = 0) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    let start = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0;
    let reset = false;
    if (start > size) { start = 0; reset = true; }
    if (start === size) return { entries: [], cursor: start, reset };
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    const end = buffer.lastIndexOf(0x0a);
    if (end === -1) return { entries: [], cursor: start, reset };
    const entries = [];
    for (const line of buffer.subarray(0, end).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      try { entries.push(JSON.parse(line)); } catch {}
    }
    return { entries, cursor: start + end + 1, reset };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The viewer entries of a cached session written after `cursor`, for any CLI:
 * read from its transcript file and mapped by the harness, or, for a CLI that
 * keeps its sessions in a database, asked of the harness itself. The cursor is
 * opaque to callers either way: a byte offset, or the harness's own position.
 */
function readViewerEntriesSince(harness, row, cursor = 0) {
  if (typeof harness.readEntriesSince === 'function') return harness.readEntriesSince(row, cursor || 0);
  const read = readTranscriptSince(harness.transcriptPath(row), cursor || 0);
  return { entries: harness.toViewerEntries(read.entries), cursor: read.cursor, reset: read.reset };
}

module.exports = { readTranscriptSince, readViewerEntriesSince };
