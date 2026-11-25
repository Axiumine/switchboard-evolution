/** @jest-environment node */
// The grammars the editor page does not carry (scripts/editor-page/grammars.js,
// languages.js): asked for once, put in by the app, run on the page's own CodeMirror.
import { SHARED_MODULES, grammar, setLanguageHost, whenLoaded, languageReady, shareModules } from '../editor-page/languages.js';
import { GRAMMARS, SHARED_MODULE_NAMES, grammarSource } from '../editor-page/grammars.js';
import { EDITOR_LANGUAGES } from '../../src/editor/editor-languages.generated';

globalThis.window = globalThis;

test('the page gives the grammars every module the build leaves out of them', () => {
  expect(Object.keys(SHARED_MODULES).sort()).toEqual([...SHARED_MODULE_NAMES].sort());
});

test('a grammar is asked for once, then colours the file and the code blocks that wait', async () => {
  const posted = [];
  const ready = [];
  setLanguageHost({ post: (m) => posted.push(m), onReady: (addon) => ready.push(addon) });
  const php = grammar('php');
  expect(php.addon).toBe('lang-php');
  expect(php()).toEqual([]);
  expect(php()).toEqual([]);
  const waiting = whenLoaded('lang-php');
  expect(posted).toEqual([{ type: 'needLanguage', addon: 'lang-php' }]);

  shareModules();
  // The script the app puts in the page (bridge.ts languageScript): the real one, on the page's modules.
  new Function(EDITOR_LANGUAGES['lang-php'])();
  languageReady('lang-php');
  expect(ready).toEqual(['lang-php']);
  expect(php().language.name).toBe('php');
  expect((await waiting).support('php')).toBe(php());
});

test('every grammar has its script, and each gives its languages', () => {
  shareModules();
  for (const [key, { languages }] of Object.entries(GRAMMARS)) {
    expect(grammarSource(key)).toContain(`'lang-${key}'`.replace(/'/g, '"'));
    new Function(EDITOR_LANGUAGES[`lang-${key}`])();
    for (const name of Object.keys(languages)) {
      expect(window.__sbEditorAddons[`lang-${key}`].support(name).language).toBeDefined();
    }
  }
  expect(window.__sbEditorAddons['lang-sass'].support('scss').language.name).toBe('sass');
});
