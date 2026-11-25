import { describe, expect, it } from '@jest/globals';

import { call, languageScript, parseMessage } from '../bridge';

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

describe('find and replace through the bridge', () => {
  it('calls the page\'s find functions with their options', () => {
    const options = { matchCase: true, wholeWord: false, isRegex: true, preserveCase: false };
    expect(runInPage(call('find', 'a(b)', options)).calls).toEqual([{ fn: 'find', args: ['a(b)', options] }]);
    expect(runInPage(call('findNext', -1)).calls).toEqual([{ fn: 'findNext', args: [-1] }]);
    expect(runInPage(call('replaceAll', '$1', options)).calls).toEqual([{ fn: 'replaceAll', args: ['$1', options] }]);
    expect(runInPage(call('clearFind')).calls).toEqual([{ fn: 'clearFind', args: [] }]);
  });

  it('reads what the page found, and refuses anything else', () => {
    expect(parseMessage(JSON.stringify({ type: 'find', count: 3, current: 2, limited: false }))).toEqual({ type: 'find', count: 3, current: 2, limited: false });
    expect(parseMessage(JSON.stringify({ type: 'find', count: 0, current: 0, error: 'Invalid regular expression: x' })))
      .toEqual({ type: 'find', count: 0, current: 0, limited: false, error: 'Invalid regular expression: x' });
    expect(parseMessage(JSON.stringify({ type: 'find', count: 4, current: 0, limited: false, replaced: 4 }))?.type).toBe('find');
    expect(parseMessage(JSON.stringify({ type: 'find', count: 2, current: 9 }))).toEqual({ type: 'find', count: 2, current: 2, limited: false });
    expect(parseMessage(JSON.stringify({ type: 'find', count: -1, current: 0 }))).toBeNull();
    expect(parseMessage(JSON.stringify({ type: 'openFind' }))).toEqual({ type: 'openFind' });
  });
});

describe('a grammar the page asks for', () => {
  it('is asked by its add-on name, and nothing else is', () => {
    expect(parseMessage(JSON.stringify({ type: 'needLanguage', addon: 'lang-php' }))).toEqual({ type: 'needLanguage', addon: 'lang-php' });
    expect(parseMessage(JSON.stringify({ type: 'needLanguage', addon: '../x' }))).toBeNull();
    expect(parseMessage(JSON.stringify({ type: 'needLanguage' }))).toBeNull();
  });

  it('goes in with the page told it is there', () => {
    const told: string[] = [];
    const sb = { languageReady: (addon: string) => told.push(addon) };
    const window = { sb, __sbEditorAddons: {} as Record<string, unknown> };
    const source = "window.__sbEditorAddons['lang-php'] = { support: () => null };";
    new Function('window', languageScript('lang-php', source))(window);
    expect(window.__sbEditorAddons['lang-php']).toBeDefined();
    expect(told).toEqual(['lang-php']);
  });
});
