const { test } = require('node:test');
const assert = require('node:assert/strict');

const { addSink, emit } = require('../broadcast');

test('an event reaches every destination with its arguments', () => {
  const window = [];
  const remote = [];
  const removeWindow = addSink((channel, args) => window.push([channel, ...args]));
  const removeRemote = addSink((channel, args) => remote.push([channel, ...args]));
  try {
    emit('cli-busy-state', 's1', true);
    emit('harnesses-changed');
  } finally {
    removeWindow();
    removeRemote();
  }
  assert.deepEqual(window, [['cli-busy-state', 's1', true], ['harnesses-changed']]);
  assert.deepEqual(remote, window);
});

test('a removed destination receives nothing more', () => {
  const seen = [];
  const remove = addSink((channel) => seen.push(channel));
  emit('projects-changed', 'project');
  remove();
  emit('projects-changed', 'sessions');
  assert.deepEqual(seen, ['projects-changed']);
});

test('a destination that throws does not stop the others', () => {
  const seen = [];
  const originalError = console.error;
  const errors = [];
  console.error = (msg) => errors.push(msg);
  const removeBad = addSink(() => { throw new Error('socket closed'); });
  const removeGood = addSink((channel) => seen.push(channel));
  try {
    emit('file-changed', '/tmp/a.md');
  } finally {
    removeBad();
    removeGood();
    console.error = originalError;
  }
  assert.deepEqual(seen, ['file-changed']);
  assert.match(errors[0], /file-changed: socket closed/);
});

test('with no destination an event is dropped quietly', () => {
  assert.doesNotThrow(() => emit('status-update', 'Indexing…', 'info'));
});
