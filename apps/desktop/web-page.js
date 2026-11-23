// A pull request's page on GitHub shown inside the app: in a panel over the
// Pull Requests view, or in a window of its own (public/web-page-view.js,
// public/web-window.html), through a <webview>. This is what main allows such
// a page: https only, its own persistent session (so GitHub's sign-in stays
// from one start to the next, apart from the app's own pages), no preload and
// no Node, a sandbox, and no permissions but the clipboard and full screen.
// A link that asks for a new window goes to the system browser.

const WEB_PARTITION = 'persist:github-web';
const WEB_URL_MAX = 2048;
// GitHub's "Copy" buttons write the clipboard; a video may go full screen.
const WEB_PERMISSIONS = new Set(['clipboard-sanitized-write', 'fullscreen']);

/** A web address such a page may load: a valid https one, not too long. */
function isWebPageUrl(url) {
  if (typeof url !== 'string' || !url || url.length > WEB_URL_MAX) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Set the preferences a <webview> attaches with (will-attach-webview), whatever
 * the page that made it asked for; false when it must not attach at all:
 * another session than the web pages' own, or a source that is not https.
 */
function guardWebviewAttach(webPreferences, params) {
  if (webPreferences && typeof webPreferences === 'object') {
    delete webPreferences.preload;
    delete webPreferences.preloadURL;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
  }
  return !!params && params.partition === WEB_PARTITION && isWebPageUrl(params.src);
}

function webPagePermission(permission) {
  return WEB_PERMISSIONS.has(permission);
}

/** The items of the menu a right click opens on such a page. */
function webPageMenuItems(params = {}, { openExternal, copy } = {}) {
  const items = [];
  const link = typeof params.linkURL === 'string' && /^https?:\/\//i.test(params.linkURL) ? params.linkURL : '';
  if (link) {
    items.push({ label: 'Open Link in the Browser', click: () => openExternal(link) });
    items.push({ label: 'Copy Link Address', click: () => copy(link) });
  }
  if (params.isEditable) {
    if (items.length) items.push({ type: 'separator' });
    items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
  } else if (params.selectionText) {
    if (items.length) items.push({ type: 'separator' });
    items.push({ role: 'copy' });
  }
  const page = typeof params.pageURL === 'string' && isWebPageUrl(params.pageURL) ? params.pageURL : '';
  if (page) {
    if (items.length) items.push({ type: 'separator' });
    items.push({ label: 'Open Page in the Browser', click: () => openExternal(page) });
    items.push({ label: 'Copy Page Address', click: () => copy(page) });
  }
  return items;
}

/** Watch every <webview> the app's pages make, and set up the web pages' session. */
function setupWebPages({ app, session, shell, clipboard, Menu, log }) {
  const openExternal = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {}); };
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      if (guardWebviewAttach(webPreferences, params)) return;
      event.preventDefault();
      log?.warn?.('[web-page] refused a webview', params && params.partition, params && String(params.src).slice(0, 200));
    });
    if (contents.getType() !== 'webview') return;
    contents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: 'deny' };
    });
    // http and other schemes never load inside; an http link goes to the browser.
    contents.on('will-navigate', (event, url) => {
      if (isWebPageUrl(url)) return;
      event.preventDefault();
      openExternal(url);
    });
    contents.on('context-menu', (_e, params) => {
      const items = webPageMenuItems(params, { openExternal, copy: (text) => clipboard.writeText(text) });
      if (items.length) Menu.buildFromTemplate(items).popup();
    });
  });
  const ses = session.fromPartition(WEB_PARTITION);
  ses.setPermissionRequestHandler((_contents, permission, callback) => callback(webPagePermission(permission)));
  ses.setPermissionCheckHandler((_contents, permission) => webPagePermission(permission));
}

module.exports = { WEB_PARTITION, WEB_URL_MAX, isWebPageUrl, guardWebviewAttach, webPagePermission, webPageMenuItems, setupWebPages };
