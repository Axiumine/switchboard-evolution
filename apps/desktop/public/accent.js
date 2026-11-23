// accent.js — the accent colour of the whole app (Settings > Application >
// Accent color). The stylesheets draw every accent shade from --accent; this
// sets it on <html> before the window is first painted, in every window, from
// a copy kept in localStorage. The setting itself is `accentColor` in the
// global settings: AccentColor.sync() brings the copy in line with it at
// start, and a change made in one window reaches the others through the
// `storage` event.
(function () {
  const KEY = 'switchboard-e.accentColor';
  const DEFAULT = '#8088ff';
  const PRESETS = [
    { color: DEFAULT, label: 'Indigo (default)' },
    { color: '#5b9dff', label: 'Blue' },
    { color: '#2fc4b2', label: 'Teal' },
    { color: '#5cc46a', label: 'Green' },
    { color: '#e8b23a', label: 'Amber' },
    { color: '#ff8a4c', label: 'Orange' },
    { color: '#f06464', label: 'Red' },
    { color: '#f06aa8', label: 'Pink' },
    { color: '#b07cff', label: 'Violet' },
  ];

  /** A colour the setting accepts: #rrggbb. Anything else is the default. */
  function normalize(color) {
    return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim().toLowerCase() : DEFAULT;
  }

  let shown = DEFAULT;

  // What cannot follow --accent by itself (the Lens, a page of its own) listens to 'accent-color-changed'.
  function paint(color) {
    const c = normalize(color);
    const root = document.documentElement;
    if (c === DEFAULT) root.style.removeProperty('--accent');
    else root.style.setProperty('--accent', c);
    if (c !== shown) {
      shown = c;
      try { window.dispatchEvent(new CustomEvent('accent-color-changed', { detail: c })); } catch {}
    }
    return c;
  }

  function stored() {
    try { return localStorage.getItem(KEY); } catch { return null; }
  }

  function remember(c) {
    try {
      if (c === DEFAULT) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, c);
    } catch {}
  }

  paint(stored());
  window.addEventListener('storage', (e) => { if (e.key === KEY) paint(e.newValue); });

  window.AccentColor = {
    DEFAULT,
    PRESETS,
    normalize,
    /** The colour this window shows. */
    current: () => shown,
    /** Show a colour here and in every other window (the caller saves the setting). */
    apply(color) { const c = paint(color); remember(c); return c; },
    /** At start: the saved setting wins over the copy. */
    sync(globalSettings) {
      const c = normalize(globalSettings && globalSettings.accentColor);
      if (c !== normalize(stored())) this.apply(c);
      return c;
    },
  };
})();
