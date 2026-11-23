// What main allows a pull request's page shown inside the app (web-page.js):
// https only, its own session, no preload and no Node, and a short menu.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const webPage = require('../web-page');

test('only a valid https address shows inside the app', () => {
  assert.equal(webPage.isWebPageUrl('https://github.com/acme/widgets/pull/4'), true);
  assert.equal(webPage.isWebPageUrl('https://git.example.com/acme/widgets/pull/4#discussion_r1'), true);
  for (const url of ['http://github.com/acme/widgets/pull/4', 'file:///etc/hosts', 'javascript:alert(1)', 'about:blank', '', null, 42, 'https://', `https://github.com/${'a'.repeat(webPage.WEB_URL_MAX)}`]) {
    assert.equal(webPage.isWebPageUrl(url), false, String(url).slice(0, 40));
  }
});

test('a webview attaches without preload or Node, sandboxed, and only in the web pages\' session over https', () => {
  const prefs = { preload: '/somewhere/preload.js', preloadURL: 'file:///somewhere/preload.js', nodeIntegration: true, nodeIntegrationInSubFrames: true, contextIsolation: false, sandbox: false, webSecurity: false, allowRunningInsecureContent: true };
  const ok = webPage.guardWebviewAttach(prefs, { partition: webPage.WEB_PARTITION, src: 'https://github.com/acme/widgets/pull/4' });
  assert.equal(ok, true);
  assert.deepEqual(prefs, { nodeIntegration: false, nodeIntegrationInSubFrames: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false });
  assert.equal(webPage.guardWebviewAttach({}, { partition: 'persist:other', src: 'https://github.com/' }), false);
  assert.equal(webPage.guardWebviewAttach({}, { src: 'https://github.com/' }), false);
  assert.equal(webPage.guardWebviewAttach({}, { partition: webPage.WEB_PARTITION, src: 'http://github.com/' }), false);
  assert.equal(webPage.guardWebviewAttach({}, { partition: webPage.WEB_PARTITION, src: 'file:///etc/hosts' }), false);
  assert.equal(webPage.guardWebviewAttach({}, null), false);
});

test('the page may use the clipboard and full screen, nothing else', () => {
  assert.equal(webPage.webPagePermission('clipboard-sanitized-write'), true);
  assert.equal(webPage.webPagePermission('fullscreen'), true);
  for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read', 'openExternal', 'midi']) {
    assert.equal(webPage.webPagePermission(permission), false, permission);
  }
});

test('a right click offers the link, the selection or the fields, then the page', () => {
  const calls = [];
  const actions = { openExternal: url => calls.push(['open', url]), copy: text => calls.push(['copy', text]) };
  const page = 'https://github.com/acme/widgets/pull/4';
  const labels = items => items.map(item => item.label || item.role || item.type);

  const onLink = webPage.webPageMenuItems({ linkURL: 'https://example.com/docs', pageURL: page }, actions);
  assert.deepEqual(labels(onLink), ['Open Link in the Browser', 'Copy Link Address', 'separator', 'Open Page in the Browser', 'Copy Page Address']);
  onLink[0].click();
  onLink[1].click();
  onLink[4].click();
  assert.deepEqual(calls, [['open', 'https://example.com/docs'], ['copy', 'https://example.com/docs'], ['copy', page]]);

  assert.deepEqual(labels(webPage.webPageMenuItems({ selectionText: 'text', pageURL: page }, actions)), ['copy', 'separator', 'Open Page in the Browser', 'Copy Page Address']);
  assert.deepEqual(labels(webPage.webPageMenuItems({ isEditable: true }, actions)), ['cut', 'copy', 'paste', 'selectAll']);
  // A link that is not a web one is left out.
  assert.deepEqual(labels(webPage.webPageMenuItems({ linkURL: 'javascript:alert(1)' }, actions)), []);
});

test('every webview is checked as it attaches, and the page\'s new windows go to the browser', () => {
  const app = new EventEmitter();
  const opened = [];
  const handlers = {};
  const sessions = {};
  const session = {
    fromPartition(name) {
      assert.ok([webPage.WEB_PARTITION, webPage.LENS_PARTITION].includes(name), name);
      if (!sessions[name]) {
        sessions[name] = {
          setPermissionRequestHandler(fn) { if (name === webPage.WEB_PARTITION) handlers.request = fn; else handlers.lensRequest = fn; },
          setPermissionCheckHandler(fn) { if (name === webPage.WEB_PARTITION) handlers.check = fn; else handlers.lensCheck = fn; },
        };
      }
      return sessions[name];
    },
  };
  const shell = { openExternal: url => { opened.push(url); return Promise.resolve(); } };
  webPage.setupWebPages({ app, session, shell, clipboard: { writeText() {} }, Menu: { buildFromTemplate: () => ({ popup() {} }) }, log: { warn() {} } });

  // The app's own page: a webview with another session is refused.
  const host = new EventEmitter();
  host.getType = () => 'window';
  app.emit('web-contents-created', {}, host);
  let refused = false;
  host.emit('will-attach-webview', { preventDefault: () => { refused = true; } }, {}, { partition: 'persist:other', src: 'https://github.com/' });
  assert.equal(refused, true);
  refused = false;
  host.emit('will-attach-webview', { preventDefault: () => { refused = true; } }, {}, { partition: webPage.WEB_PARTITION, src: 'https://github.com/' });
  assert.equal(refused, false);

  // The page itself.
  const guest = new EventEmitter();
  guest.getType = () => 'webview';
  guest.setWindowOpenHandler = (fn) => { handlers.open = fn; };
  app.emit('web-contents-created', {}, guest);
  assert.deepEqual(handlers.open({ url: 'https://example.com/a' }), { action: 'deny' });
  assert.deepEqual(handlers.open({ url: 'file:///etc/hosts' }), { action: 'deny' });
  let stopped = false;
  guest.emit('will-navigate', { preventDefault: () => { stopped = true; } }, 'https://github.com/acme/widgets/pull/4/files');
  assert.equal(stopped, false);
  guest.emit('will-navigate', { preventDefault: () => { stopped = true; } }, 'http://example.com/');
  assert.equal(stopped, true);
  assert.deepEqual(opened, ['https://example.com/a', 'http://example.com/']);

  let granted = null;
  handlers.request(null, 'media', (value) => { granted = value; });
  assert.equal(granted, false);
  assert.equal(handlers.check(null, 'clipboard-sanitized-write'), true);

  // The Lens: it navigates on this computer only, and gets no permission but the clipboard.
  const lens = new EventEmitter();
  lens.getType = () => 'webview';
  lens.session = sessions[webPage.LENS_PARTITION];
  lens.setWindowOpenHandler = () => {};
  app.emit('web-contents-created', {}, lens);
  stopped = false;
  lens.emit('will-navigate', { preventDefault: () => { stopped = true; } }, 'http://127.0.0.1:9749/?project=api&workspace=adr');
  assert.equal(stopped, false);
  lens.emit('will-navigate', { preventDefault: () => { stopped = true; } }, 'https://github.com/acme/widgets');
  assert.equal(stopped, true, 'a web page leaves the Lens for the browser');
  assert.equal(handlers.lensCheck(null, 'clipboard-sanitized-write'), true);
  assert.equal(handlers.lensCheck(null, 'media'), false);
  // And a GitHub page cannot go to the Lens.
  stopped = false;
  guest.session = sessions[webPage.WEB_PARTITION];
  guest.emit('will-navigate', { preventDefault: () => { stopped = true; } }, 'http://127.0.0.1:9749/');
  assert.equal(stopped, true);
});

test('the Lens shows inside the app only from this computer, over http, in its own session', () => {
  assert.equal(webPage.isLensUrl('http://127.0.0.1:9749/?project=api&workspace=galaxy'), true);
  assert.equal(webPage.isLensUrl('http://localhost:9800/'), true);
  for (const url of ['https://127.0.0.1:9749/', 'http://127.0.0.1/', 'http://127.0.0.1:80/', 'http://192.168.1.5:9749/', 'http://example.com:9749/', 'http://user:pw@127.0.0.1:9749/', 'file:///etc/hosts', '', null]) {
    assert.equal(webPage.isLensUrl(url), false, String(url));
  }
  assert.equal(webPage.guardWebviewAttach({}, { partition: webPage.LENS_PARTITION, src: 'http://127.0.0.1:9749/' }), true);
  assert.equal(webPage.guardWebviewAttach({}, { partition: webPage.LENS_PARTITION, src: 'https://github.com/' }), false, 'the Lens session holds nothing else');
  assert.equal(webPage.guardWebviewAttach({}, { partition: webPage.WEB_PARTITION, src: 'http://127.0.0.1:9749/' }), false, 'nor GitHub\'s session the Lens');
  assert.equal(webPage.lensPermission('geolocation'), false);
});
