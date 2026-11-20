const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { subagentsDirFor, subagentsRunning, STALE_MS } = require('../subagent-activity');

function session() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'subagents-'));
  const transcript = path.join(dir, 'abc.jsonl');
  fs.writeFileSync(transcript, '');
  const sub = subagentsDirFor(transcript);
  fs.mkdirSync(sub, { recursive: true });
  const agent = (id, meta, writtenAgo = 0) => {
    fs.writeFileSync(path.join(sub, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'general-purpose', ...meta }));
    const log = path.join(sub, `agent-${id}.jsonl`);
    fs.writeFileSync(log, '{}\n');
    const when = new Date(Date.now() - writtenAgo);
    fs.utimesSync(log, when, when);
    fs.utimesSync(path.join(sub, `agent-${id}.meta.json`), when, when);
  };
  return { transcript, sub, agent };
}

test('subagentsDirFor is the folder named after the session, beside its transcript', () => {
  assert.equal(subagentsDirFor('/p/-Users-x-proj/abc.jsonl'), path.join('/p/-Users-x-proj', 'abc', 'subagents'));
  assert.equal(subagentsDirFor(null), null);
});

test('a subagent whose meta has no finished is working; a finished one is not', () => {
  const { sub, agent } = session();
  assert.equal(subagentsRunning(sub), false);
  agent('done', { finished: true });
  assert.equal(subagentsRunning(sub), false);
  agent('busy', {});
  assert.equal(subagentsRunning(sub), true);
  agent('busy', { finished: false });
  assert.equal(subagentsRunning(sub), true);
});

test('an unfinished subagent quiet for longer than STALE_MS no longer counts', () => {
  const { sub, agent } = session();
  agent('left', {}, STALE_MS + 60_000);
  assert.equal(subagentsRunning(sub), false);
  agent('recent', {}, 5_000);
  assert.equal(subagentsRunning(sub), true);
});

test('a session without subagents, or a broken meta file, is not working', () => {
  const { sub, transcript } = session();
  assert.equal(subagentsRunning(path.join(path.dirname(transcript), 'nope', 'subagents')), false);
  fs.writeFileSync(path.join(sub, 'agent-x.meta.json'), '{ not json');
  assert.equal(subagentsRunning(sub), false);
  assert.equal(subagentsRunning(null), false);
});
