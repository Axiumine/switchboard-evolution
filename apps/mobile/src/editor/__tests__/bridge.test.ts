import { describe, expect, it } from '@jest/globals';

import { call, parseMessage } from '../bridge';

/** Runs a call as the WebView would, against a page that records what it was given. */
function runInPage(script: string) {
  const calls: { fn: string; args: unknown[] }[] = [];
  const sb = new Proxy({}, { get: (_, fn: string) => (...args: unknown[]) => { calls.push({ fn, args }); } });
  const result = new Function('window', `return eval(${JSON.stringify(script)});`)({ sb });
  return { calls, result };
}

describe('a call to the editor page', () => {
  it('reaches window.sb with its arguments as they were', () => {
    const text = 'const s = "a\\"b";\n</script><b>\n\ttab \u2028 \u2029 ✓ 🙂\n';
    const { calls, result } = runInPage(call('load', text, 'src/a.ts', { line: 3, wrap: false }));
    expect(calls).toEqual([{ fn: 'load', args: [text, 'src/a.ts', { line: 3, wrap: false }] }]);
    // injectJavaScript wants the script to end in a value.
    expect(result).toBe(true);
  });

  it('keeps U+2028 and U+2029 out of the script itself', () => {
    const script = call('load', 'a\u2028b\u2029c', 'x.txt');
    expect(script).not.toMatch(/[\u2028\u2029]/);
    expect(script).toContain('\\u2028');
  });

  it('can have no arguments, or an undefined one', () => {
    expect(runInPage(call('undo')).calls).toEqual([{ fn: 'undo', args: [] }]);
    expect(runInPage(call('load', 'x', 'y', undefined)).calls).toEqual([{ fn: 'load', args: ['x', 'y', undefined] }]);
    expect(runInPage(call('setEditable', true)).calls).toEqual([{ fn: 'setEditable', args: [true] }]);
    expect(runInPage(call('cursors', 'next')).calls).toEqual([{ fn: 'cursors', args: ['next'] }]);
    expect(runInPage(call('setFontSize', 14)).calls).toEqual([{ fn: 'setFontSize', args: [14] }]);
    expect(runInPage(call('saved', 'a\nb')).calls).toEqual([{ fn: 'saved', args: ['a\nb'] }]);
    expect(runInPage(call('load', 'x', 'a.js', { line: null, wrap: false, base: 'old' })).calls).toEqual([{ fn: 'load', args: ['x', 'a.js', { line: null, wrap: false, base: 'old' }] }]);
  });
});

describe('a message from the editor page', () => {
  it('reads the five kinds', () => {
    expect(parseMessage('{"type":"ready"}')).toEqual({ type: 'ready' });
    expect(parseMessage('{"type":"changed"}')).toEqual({ type: 'changed' });
    expect(parseMessage('{"type":"loaded","extra":1}')).toEqual({ type: 'loaded' });
    expect(parseMessage('{"type":"state","dirty":true,"canUndo":true,"canRedo":false,"cursors":3}')).toEqual({ type: 'state', dirty: true, canUndo: true, canRedo: false, cursors: 3 });
    // A count that is missing or wrong is one cursor.
    expect(parseMessage('{"type":"state","dirty":true,"canUndo":true,"canRedo":false}')).toEqual({ type: 'state', dirty: true, canUndo: true, canRedo: false, cursors: 1 });
    expect(parseMessage('{"type":"state","dirty":false,"canUndo":false,"canRedo":false,"cursors":0}')).toMatchObject({ cursors: 1 });
    expect(parseMessage(JSON.stringify({ type: 'text', id: 4, text: 'a\nb' }))).toEqual({ type: 'text', id: 4, text: 'a\nb' });
  });

  it('is null for anything else', () => {
    for (const data of ['', 'not json', 'null', '"ready"', '{}', '{"type":"input","data":"x"}',
      '{"type":"state","dirty":"yes","canUndo":true,"canRedo":false}', '{"type":"text","id":"4","text":"a"}', '{"type":"text","id":1.5,"text":"a"}']) {
      expect(parseMessage(data)).toBeNull();
    }
  });
});
