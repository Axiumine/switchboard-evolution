// A pull request's page on GitHub inside the app: in a panel over the Pull
// Requests view (openWebPagePanel, from the icon before Merge) or in a window
// of its own (web-window.html, main.js openWebWindow). Both are one <webview>
// in a session of its own, where GitHub's sign-in stays, and which main checks
// (web-page.js: https only, no preload, a sandbox). A toolbar goes with it:
// Back, Forward, Reload, the address, Copy the address, Open in a window of
// its own (the panel), Open in the browser and Close (the panel); the window
// has its pin there too. This file only defines functions at top level.

const WEB_PAGE_PARTITION = 'persist:github-web';

const WEB_ICONS = {
  back: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`,
  forward: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>`,
  reload: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`,
  stop: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  link: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`,
  check: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  popOut: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7"/><path d="M21 3l-9 9"/><path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5"/></svg>`,
  globe: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
  close: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
};

function webPageEscape(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** An address the page can show inside the app: https, as main allows (web-page.js isWebPageUrl). */
function webPageCanShow(url) {
  if (typeof url !== 'string' || !url || url.length > 2048) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** The toolbar over the page: in the panel with its title, Open in a window and Close; in a window with the pin. */
function webPageToolbarHtml({ url = '', title = '', inWindow = false } = {}) {
  const esc = webPageEscape;
  const btn = (act, label, icon, disabled = false) =>
    `<button type="button" class="web-page-btn" data-act="${act}" title="${esc(label)}" aria-label="${esc(label)}"${disabled ? ' disabled' : ''}>${icon}</button>`;
  const lead = inWindow
    ? '<button id="tool-window-pin" class="tool-window-btn web-page-pin" type="button" aria-pressed="false"></button>'
    : `<span class="web-page-title" title="${esc(title)}">${esc(title)}</span>`;
  return `
    <div class="web-page-bar">
      ${lead}
      <span class="web-page-group" role="group" aria-label="Navigation">
        ${btn('back', 'Back', WEB_ICONS.back(), true)}
        ${btn('forward', 'Forward', WEB_ICONS.forward(), true)}
        ${btn('reload', 'Reload', WEB_ICONS.reload())}
      </span>
      <input class="web-page-address" data-role="address" type="text" readonly spellcheck="false" aria-label="Address" value="${esc(url)}">
      <span class="web-page-group" role="group" aria-label="Page">
        ${btn('copy', 'Copy the address', WEB_ICONS.link())}
        ${inWindow ? '' : btn('window', 'Open in a window of its own', WEB_ICONS.popOut())}
        ${btn('browser', 'Open in the browser', WEB_ICONS.globe())}
        ${inWindow ? '' : btn('close', 'Close (Esc)', WEB_ICONS.close())}
      </span>
      <span class="web-page-progress" aria-hidden="true"></span>
    </div>`;
}

function webPageErrorHtml(description) {
  const text = description ? `The page did not open: ${description}.` : 'The page did not open.';
  return `
    <p>${webPageEscape(text)}</p>
    <span class="web-page-error-actions">
      <button type="button" class="ws-btn ws-btn--sm" data-act="retry">Try again</button>
      <button type="button" class="ws-btn ws-btn--sm" data-act="error-browser">Open in the browser</button>
    </span>`;
}

/** The icon of a button shows a check for a moment: the address is copied. */
function webPageFlashCopied(button, icon, check) {
  if (!button) return;
  clearTimeout(button._copiedTimer);
  button.innerHTML = check;
  button.classList.add('is-done');
  button._copiedTimer = setTimeout(() => {
    button.innerHTML = icon;
    button.classList.remove('is-done');
  }, 1200);
}

/**
 * Put the toolbar and the page in `container`. Returns the page's handle: its
 * address now (the page may have moved on, to Files changed say), and focus().
 */
function mountWebPage(container, { url, title = '', inWindow = false, onClose = null } = {}) {
  container.classList.add('web-page');
  container.innerHTML = `${webPageToolbarHtml({ url, title, inWindow })}<div class="web-page-body"><div class="web-page-error" role="alert" hidden></div></div>`;
  const bar = container.querySelector('.web-page-bar');
  const body = container.querySelector('.web-page-body');
  const errorBox = container.querySelector('.web-page-error');
  const address = container.querySelector('[data-role="address"]');
  const button = act => bar.querySelector(`[data-act="${act}"]`);

  // The session first, before the source: a webview takes them as it attaches.
  const view = document.createElement('webview');
  view.className = 'web-page-view';
  view.setAttribute('partition', WEB_PAGE_PARTITION);
  // window.open and target=_blank reach main, which sends them to the browser.
  view.setAttribute('allowpopups', '');
  view.setAttribute('src', url);
  body.prepend(view);

  let current = url;
  let ready = false;
  let loading = false;
  const setAddress = (next) => {
    if (!next) return;
    current = next;
    address.value = next;
  };
  const showNav = () => {
    if (!ready) return;
    try {
      button('back').disabled = !view.canGoBack();
      button('forward').disabled = !view.canGoForward();
    } catch {}
  };
  const setLoading = (on) => {
    loading = on;
    container.classList.toggle('is-loading', on);
    const reload = button('reload');
    reload.innerHTML = on ? WEB_ICONS.stop() : WEB_ICONS.reload();
    reload.title = on ? 'Stop' : 'Reload';
    reload.setAttribute('aria-label', reload.title);
  };
  const hideError = () => { errorBox.hidden = true; errorBox.innerHTML = ''; };

  view.addEventListener('dom-ready', () => { ready = true; showNav(); });
  view.addEventListener('did-navigate', (e) => { setAddress(e.url); hideError(); showNav(); });
  view.addEventListener('did-navigate-in-page', (e) => { if (e.isMainFrame) { setAddress(e.url); showNav(); } });
  view.addEventListener('page-title-updated', (e) => { if (inWindow && e.title) document.title = e.title; });
  view.addEventListener('did-start-loading', () => setLoading(true));
  view.addEventListener('did-stop-loading', () => { setLoading(false); showNav(); });
  view.addEventListener('did-fail-load', (e) => {
    // -3 is a load given up for another (a click while loading): not an error.
    if (!e.isMainFrame || e.errorCode === -3) return;
    if (e.validatedURL) setAddress(e.validatedURL);
    errorBox.innerHTML = webPageErrorHtml(e.errorDescription);
    errorBox.hidden = false;
    errorBox.querySelector('[data-act="retry"]').onclick = () => { hideError(); view.reload(); };
    errorBox.querySelector('[data-act="error-browser"]').onclick = () => window.api?.openExternal?.(current);
  });

  button('back').onclick = () => { try { if (view.canGoBack()) view.goBack(); } catch {} };
  button('forward').onclick = () => { try { if (view.canGoForward()) view.goForward(); } catch {} };
  button('reload').onclick = () => {
    try {
      if (loading) view.stop();
      else { hideError(); view.reload(); }
    } catch {}
  };
  button('copy').onclick = () => {
    window.api?.writeClipboard?.(current);
    webPageFlashCopied(button('copy'), WEB_ICONS.link(), WEB_ICONS.check());
  };
  button('browser').onclick = () => window.api?.openExternal?.(current);
  const popOut = button('window');
  if (popOut) {
    popOut.onclick = () => {
      window.api?.openWebWindow?.(current, title);
      if (onClose) onClose();
    };
  }
  const close = button('close');
  if (close && onClose) close.onclick = () => onClose();
  address.addEventListener('focus', () => address.select());

  return {
    view,
    get url() { return current; },
    focus: () => view.focus(),
  };
}

/**
 * The page in a panel over the window, nearly as large as it. A click outside
 * does nothing (the app's rule for dialogs); Close and Escape close it, Escape
 * while the focus is not in the page, which keeps its own keys. One at a time.
 */
function openWebPagePanel({ url, title = '' } = {}) {
  if (!webPageCanShow(url)) {
    if (/^https?:\/\//i.test(String(url || ''))) window.api?.openExternal?.(url);
    return null;
  }
  document.querySelectorAll('.web-page-overlay').forEach(open => open._close?.());
  const opener = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'web-page-overlay';
  const panel = document.createElement('div');
  panel.className = 'web-page-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', title || 'Pull request');
  panel.tabIndex = -1;
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  let closed = false;
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
  }
  overlay._close = close;
  document.addEventListener('keydown', onKey, true);
  const page = mountWebPage(panel, { url, title, onClose: close });
  panel.focus();
  return { close, page };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WEB_PAGE_PARTITION, webPageEscape, webPageCanShow, webPageToolbarHtml, webPageErrorHtml };
}
