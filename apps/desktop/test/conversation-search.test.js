const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ID = '41a185fe-81fa-459a-9f48-cab9e5ab1e65';
const harnesses = [
  {
    name: 'Claude',
    harness: require('../harnesses/claude'),
    filename: `${ID}.jsonl`,
    prefix: [],
    message: (role, content) => ({ type: role, cwd: '/tmp/project', message: { role, content } }),
    text: text => ({ type: 'text', text }),
    other: [
      { type: 'system', message: 'system_marker' },
      { type: 'file-history-snapshot', snapshot: { text: 'snapshot_marker' } },
    ],
  },
  {
    name: 'Codex',
    harness: require('../harnesses/codex'),
    filename: `rollout-2026-09-08T10-00-00-${ID}.jsonl`,
    prefix: [{ type: 'session_meta', payload: { cwd: '/tmp/project' } }],
    message: (role, content) => ({ type: 'response_item', payload: { type: 'message', role, content } }),
    text: text => ({ type: 'output_text', text }),
    other: [
      { type: 'response_item', payload: { type: 'function_call', name: 'tool_name_marker', arguments: 'tool_input_marker' } },
      { type: 'response_item', payload: { type: 'function_call_output', output: 'tool_output_marker' } },
      { type: 'response_item', payload: { type: 'custom_tool_call', name: 'tool_name_marker', input: 'tool_input_marker' } },
      { type: 'response_item', payload: { type: 'custom_tool_call_output', output: 'tool_output_marker' } },
      { type: 'response_item', payload: { type: 'reasoning', summary: [{ text: 'thinking_marker' }], encrypted_content: 'encrypted_marker' } },
      { type: 'event_msg', payload: { type: 'agent_message', message: 'event_marker' } },
    ],
  },
];

function readFixture(provider, entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-search-'));
  try {
    const file = path.join(dir, provider.filename);
    fs.writeFileSync(file, [...provider.prefix, ...entries].map(e => JSON.stringify(e)).join('\n') + '\n');
    return provider.harness.readSessionFile(file, 'folder', '/tmp/project');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

for (const provider of harnesses) {
  test(`${provider.name} indexes full messages and later turns beyond the old search limits`, () => {
    const first = 'a'.repeat(600) + ' move_fna_lines';
    const middle = 'b'.repeat(600);
    const session = readFixture(provider, [
      provider.message('user', first),
      ...Array.from({ length: 20 }, () => provider.message('assistant', [provider.text(middle)])),
      provider.message('assistant', [provider.text('late_conversation_marker'), provider.text('second_block_marker')]),
      provider.message('user', [{ type: 'input_text', text: 'codex_input_marker' }, { type: 'text', text: 'final_user_marker' }]),
    ]);
    assert.ok(session);
    assert.ok(session.textContent.includes(first), 'the first message must not be cut at 500 characters');
    assert.ok(session.textContent.includes(middle), 'assistant messages must not be cut either');
    assert.ok(session.textContent.includes('late_conversation_marker\nsecond_block_marker'));
    assert.ok(session.textContent.includes('final_user_marker'));
    if (provider.name === 'Codex') assert.ok(session.textContent.includes('codex_input_marker'));
    assert.ok(session.textContent.length > 12000, 'the index must not stop after 8000 characters');
    assert.equal(session.summary, first.slice(0, 120), 'sidebar previews remain short');
  });

  test(`${provider.name} indexes only conversation text, excluding tools and scaffolding`, () => {
    const session = readFixture(provider, [
      provider.message('developer', [provider.text('developer_marker')]),
      provider.message('user', [
        { type: 'image', source: { data: 'image_marker' } },
        { type: 'text', text: 'real_question' },
      ]),
      provider.message('assistant', [
        { type: 'thinking', thinking: 'thinking_marker', text: 'thinking_marker', signature: 'signature_marker' },
        provider.text('first_answer'),
        { type: 'tool_use', name: 'tool_name_marker', input: { command: 'tool_input_marker' } },
        provider.text('second_answer'),
      ]),
      provider.message('user', [{ type: 'tool_result', content: [{ type: 'text', text: 'tool_output_marker' }] }]),
      ...provider.other,
    ]);
    assert.ok(session);
    assert.equal(session.summary, 'real_question', 'text after an image must still supply the summary');
    assert.equal(session.textContent, 'real_question\nfirst_answer\nsecond_answer');
  });
}

// OpenCode keeps sessions in a database, so its fixture is a database row set
// rather than a transcript file.
function readOpencodeFixture(messages) {
  const { DatabaseSync } = require('node:sqlite');
  const opencode = require('../harnesses/opencode');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conversation-search-opencode-'));
  const prev = process.env.OPENCODE_DB;
  const file = path.join(dir, 'opencode.db');
  const db = new DatabaseSync(file);
  try {
    db.exec(`CREATE TABLE session_v2 (id text PRIMARY KEY, project_id text NOT NULL, parent_id text, slug text NOT NULL,
        directory text NOT NULL, title text, version text NOT NULL, time_created integer NOT NULL,
        time_updated integer NOT NULL, time_archived integer);
      CREATE TABLE session_message (id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL,
        seq integer NOT NULL, time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL);`);
    db.prepare("INSERT INTO session_v2 VALUES ('ses_1', 'p', NULL, 's', '/tmp/project', NULL, '2.3.2', 1, 1, NULL)").run();
    messages.forEach(([type, data], i) => db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?, 1, 1, ?)')
      .run(`msg_${i}`, 'ses_1', type, i + 1, JSON.stringify(data)));
    process.env.OPENCODE_DB = file;
    return opencode.readSessionFile('ses_1', 'opencode/p', '/tmp/project');
  } finally {
    require('../harnesses/opencode').closeDb();
    db.close();
    if (prev === undefined) delete process.env.OPENCODE_DB; else process.env.OPENCODE_DB = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const done = { created: 1, completed: 2 };

test('OpenCode indexes full messages and later turns beyond the old search limits', () => {
  const first = 'a'.repeat(600) + ' move_fna_lines';
  const middle = 'b'.repeat(600);
  const session = readOpencodeFixture([
    ['user', { text: first }],
    ...Array.from({ length: 20 }, () => ['assistant', { time: done, content: [{ type: 'text', text: middle }] }]),
    ['assistant', { time: done, content: [{ type: 'text', text: 'late_conversation_marker' }, { type: 'text', text: 'second_block_marker' }] }],
    ['user', { text: 'final_user_marker' }],
  ]);
  assert.ok(session.textContent.includes(first));
  assert.ok(session.textContent.includes('late_conversation_marker\nsecond_block_marker'));
  assert.ok(session.textContent.includes('final_user_marker'));
  assert.ok(session.textContent.length > 12000);
  assert.equal(session.summary, first.slice(0, 120));
});

test('OpenCode indexes only conversation text, excluding tools and scaffolding', () => {
  const session = readOpencodeFixture([
    ['synthetic', { text: 'synthetic_marker' }],
    ['system', { text: 'system_marker' }],
    ['user', { text: 'real_question' }],
    ['assistant', { time: done, content: [
      { type: 'reasoning', text: 'thinking_marker' },
      { type: 'text', text: 'first_answer' },
      { type: 'tool', id: 'c1', name: 'shell', state: { status: 'completed', input: { command: 'tool_input_marker' },
        content: [{ type: 'text', text: 'tool_output_marker' }] } },
      { type: 'text', text: 'second_answer' },
    ] }],
    ['shell', { command: 'shell_marker', output: 'shell_output_marker' }],
    ['idle', { outcome: 'succeeded' }],
  ]);
  assert.equal(session.summary, 'real_question');
  assert.equal(session.textContent, 'real_question\nfirst_answer\nsecond_answer');
});
