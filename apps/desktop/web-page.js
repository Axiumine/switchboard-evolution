// A pull request's page on GitHub shown inside the app: in a panel over the
// Pull Requests view, or in a window of its own (public/web-page-view.js,
// public/web-window.html), through a <webview>. This is what main allows such
// a page: https only, its own persistent session (so GitHub's sign-in stays
// from one start to the next, apart from the app's own pages), no preload and
// no Node, a sandbox, and no permissions but the clipboard and full screen.
// A link that asks for a new window goes to the system browser.
//
// The Node Knowledge tab's Lens (codebase-memory-mcp's own web UI, which a
// frame cannot show: it sends frame-ancestors 'none') is the other page a
// <webview> may hold: http on 127.0.0.1 only, in a session of its own.

const WEB_PARTITION = 'persist:github-web';
const LENS_PARTITION = 'persist:cbm-lens';
const LENS_HOSTS = new Set(['127.0.0.1', 'localhost']);
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

/** The Lens on this computer: http to 127.0.0.1 or localhost, on a port of its own. */
function isLensUrl(url) {
  if (typeof url !== 'string' || !url || url.length > WEB_URL_MAX) return false;
  try {
    const u = new URL(url);
    const port = Number(u.port);
    return u.protocol === 'http:' && LENS_HOSTS.has(u.hostname) && Number.isInteger(port) && port >= 1024 && port <= 65535 && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Whether a page of this partition may load `url`. */
function allowedIn(partition, url) {
  if (partition === WEB_PARTITION) return isWebPageUrl(url);
  if (partition === LENS_PARTITION) return isLensUrl(url);
  return false;
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
  return !!params && allowedIn(params.partition, params.src);
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
    // A GitHub page stays on https and the Lens on this computer; any other
    // address goes to the browser.
    contents.on('will-navigate', (event, url) => {
      if (contents.session === lensSession ? isLensUrl(url) : isWebPageUrl(url)) return;
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
  lensSession = session.fromPartition(LENS_PARTITION);
  lensSession.setPermissionRequestHandler((_contents, permission, callback) => callback(lensPermission(permission)));
  lensSession.setPermissionCheckHandler((_contents, permission) => lensPermission(permission));
}

let lensSession = null;

/** The Lens may copy to the clipboard; nothing else (no camera, location, notifications). */
function lensPermission(permission) {
  return permission === 'clipboard-sanitized-write';
}

module.exports = { WEB_PARTITION, LENS_PARTITION, WEB_URL_MAX, isWebPageUrl, isLensUrl, guardWebviewAttach, webPagePermission, lensPermission, webPageMenuItems, setupWebPages };
