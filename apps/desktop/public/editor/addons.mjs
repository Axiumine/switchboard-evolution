// The heavy parts of the editor (Vim, the language-server client) are in
// bundles of their own, editor-<name>-bundle.js next to the page, loaded the
// first time an editor needs them. They do not carry CodeMirror: their
// imports of @codemirror/* (and @lezer/*, marked) are the main bundle's own
// modules, given on window.__sbEditorModules (codemirror-setup.js), so that
// an add-on's extensions are of the same instances as the editor's.
// scripts/bundle-editor-addons.mjs builds them and checks that no CodeMirror
// package slipped in. An add-on puts what it exports on window.__sbEditorAddons[name].

const loading = new Map(); // name → Promise of the add-on's exports

function addonUrl(name) {
  return new URL(`editor-${name}-bundle.js`, document.baseURI).href;
}

/** The add-on `name`, loaded once for the page. Rejects when its bundle cannot be loaded. */
function loadAddon(name) {
  const ready = loadedAddon(name);
  if (ready) return Promise.resolve(ready);
  if (typeof document === 'undefined') return Promise.reject(new Error(`No page to load the editor's ${name} into`));
  if (!loading.has(name)) {
    loading.set(name, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = addonUrl(name);
      script.async = true;
      script.onload = () => {
        const exports = window.__sbEditorAddons && window.__sbEditorAddons[name];
        if (exports) resolve(exports);
        else { loading.delete(name); reject(new Error(`The editor's ${name} bundle loaded without its exports`)); }
      };
      script.onerror = () => {
        loading.delete(name);
        script.remove();
        reject(new Error(`Could not load the editor's ${name} (${script.src})`));
      };
      document.head.appendChild(script);
    }));
  }
  return loading.get(name);
}

/** The add-on if it is already loaded, else null (no loading). */
function loadedAddon(name) {
  return (typeof window !== 'undefined' && window.__sbEditorAddons && window.__sbEditorAddons[name]) || null;
}

export { loadAddon, loadedAddon };
