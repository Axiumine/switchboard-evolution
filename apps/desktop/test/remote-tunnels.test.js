const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createRemoteTunnels, findBinary } = require('../remote-tunnels');

/** A child process that prints what the test tells it to, and exits when killed. */
function fakeSpawn() {
  const children = [];
  const spawn = (bin, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.bin = bin;
    child.args = args;
    child.env = options.env;
    child.killed = false;
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('exit', null, 'SIGTERM')); };
    child.print = (text, stream = 'stdout') => child[stream].emit('data', Buffer.from(text));
    children.push(child);
    return child;
  };
  return { spawn, children };
}

/** Cloudflare's API, answering from a table of `METHOD path` → result, and recording the calls. */
function fakeCloudflare(routes) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    const path = url.replace('https://api.cloudflare.com/client/v4', '');
    const method = options.method || 'GET';
    calls.push({ method, path, body: options.body ? JSON.parse(options.body) : undefined, auth: options.headers?.Authorization });
    const key = Object.keys(routes).find((k) => k === `${method} ${path}` || (k.endsWith('*') && `${method} ${path}`.startsWith(k.slice(0, -1))));
    const answer = key ? routes[key] : { status: 404, body: { success: false, errors: [{ code: 7003, message: `No route for ${method} ${path}` }] } };
    const { status = 200, body } = typeof answer === 'function' ? answer(options) : answer;
    return { status, ok: status < 400, json: async () => body };
  };
  return { fetch, calls };
}

const ok = (result) => ({ body: { success: true, errors: [], result } });

function setup({ fetch, binaries = { cloudflared: '/opt/homebrew/bin/cloudflared', ngrok: '/opt/homebrew/bin/ngrok' } } = {}) {
  const settings = new Map();
  const { spawn, children } = fakeSpawn();
  const changes = [];
  const tunnels = createRemoteTunnels({
    getSetting: (key) => (settings.has(key) ? JSON.parse(settings.get(key)) : null),
    setSetting: (key, value) => settings.set(key, JSON.stringify(value)),
    encrypt: (text) => `enc(${text})`,
    decrypt: (text) => text.replace(/^enc\((.*)\)$/, '$1'),
    spawn,
    fetch: fetch || (async () => { throw new Error('no network in this test'); }),
    log: { info() {}, warn() {}, error() {} },
    port: () => 47100,
    configDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sb-tunnels-')),
    findBinary: (name) => binaries[name] || null,
    restartDelaysMs: [5],
    onChange: () => changes.push(tunnels.status()),
  });
  return { tunnels, settings, children, changes };
}

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

const CF_ROUTES = {
  'GET /zones?name=example.com': ok([{ id: 'zone1', name: 'example.com', account: { id: 'acc1' } }]),
  'GET /accounts/acc1/cfd_tunnel?name=switchboard-sb.example.com&is_deleted=false': ok([]),
  'POST /accounts/acc1/cfd_tunnel': ok({ id: 'tun1', token: 'tunnel-token' }),
  'PUT /accounts/acc1/cfd_tunnel/tun1/configurations': ok({}),
  'GET /zones/zone1/dns_records?name=sb.example.com': ok([]),
  'POST /zones/zone1/dns_records': ok({ id: 'rec1' }),
};

test('ngrok runs with the authtoken in its environment, never in its arguments, and its address becomes a route', async () => {
  const { tunnels, settings, children } = setup();
  tunnels.setupNgrok({ authtoken: 'secret-authtoken' });
  assert.match(settings.get('remoteTunnels'), /enc\(secret-authtoken\)/);
  tunnels.start();
  const [ngrok] = children;
  assert.equal(ngrok.bin, '/opt/homebrew/bin/ngrok');
  assert.deepEqual(ngrok.args.slice(0, 2), ['http', '47100']);
  assert.ok(!ngrok.args.join(' ').includes('secret-authtoken'));
  assert.equal(ngrok.env.NGROK_AUTHTOKEN, 'secret-authtoken');
  assert.equal(tunnels.routes().ngrok, undefined, 'no route before ngrok says where');
  ngrok.print(`${JSON.stringify({ lvl: 'info', msg: 'started tunnel', url: 'https://abc.ngrok-free.app' })}\n`);
  assert.deepEqual(tunnels.routes(), { ngrok: 'wss://abc.ngrok-free.app' });
  assert.equal(tunnels.status().ngrok.running, true);
  tunnels.stop();
});

test('a domain of their own goes to ngrok as --url', () => {
  const { tunnels, children } = setup();
  tunnels.setupNgrok({ authtoken: 't', domain: 'sb.example.dev' });
  tunnels.start();
  assert.ok(children[0].args.includes('--url'));
  assert.ok(children[0].args.includes('https://sb.example.dev'));
  tunnels.stop();
});

test('an ngrok error is shown in words, from a line split across two writes', () => {
  const { tunnels, children } = setup();
  tunnels.setupNgrok({ authtoken: 'bad' });
  tunnels.start();
  const line = JSON.stringify({ lvl: 'eror', msg: 'session closing', err: 'authentication failed: The authtoken you specified does not look like a proper ngrok authtoken.\nInstructions...\r\n\r\nERR_NGROK_105\r\n' });
  children[0].print(line.slice(0, 40));
  children[0].print(`${line.slice(40)}\n`);
  assert.match(tunnels.status().ngrok.error, /^authentication failed: The authtoken you specified/);
  assert.match(tunnels.status().ngrok.error, /ERR_NGROK_105/);
  tunnels.stop();
});

test('Cloudflare: the tunnel and its DNS record are made with the API token, which is not kept', async () => {
  const cf = fakeCloudflare(CF_ROUTES);
  const { tunnels, settings, children } = setup({ fetch: cf.fetch });
  await tunnels.setupCloudflare({ apiToken: 'api-token', domain: 'example.com', name: 'sb' });

  assert.ok(cf.calls.every((c) => c.auth === 'Bearer api-token'));
  assert.ok(cf.calls.filter((c) => c.method === 'GET').every((c) => c.body === undefined), 'no body on a GET');
  const create = cf.calls.find((c) => c.method === 'POST' && c.path === '/accounts/acc1/cfd_tunnel');
  assert.deepEqual(create.body, { name: 'switchboard-sb.example.com', config_src: 'cloudflare' });
  const ingress = cf.calls.find((c) => c.method === 'PUT').body.config.ingress;
  assert.deepEqual(ingress[0], { hostname: 'sb.example.com', service: 'http://localhost:47100', originRequest: {} });
  assert.deepEqual(ingress.at(-1), { service: 'http_status:404' });
  const record = cf.calls.find((c) => c.method === 'POST' && c.path === '/zones/zone1/dns_records').body;
  assert.deepEqual(record, { type: 'CNAME', name: 'sb.example.com', content: 'tun1.cfargotunnel.com', proxied: true });

  const stored = settings.get('remoteTunnels');
  assert.ok(!stored.includes('api-token'), 'the API token is not stored');
  assert.match(stored, /enc\(tunnel-token\)/);

  tunnels.start();
  const [agent] = children;
  assert.equal(agent.bin, '/opt/homebrew/bin/cloudflared');
  assert.deepEqual(agent.args, ['tunnel', '--no-autoupdate', 'run']);
  assert.equal(agent.env.TUNNEL_TOKEN, 'tunnel-token');
  agent.print('2026-11-04T21:00:00Z INF Registered tunnel connection connIndex=0 location=mxp01 protocol=quic\n', 'stderr');
  assert.deepEqual(tunnels.routes(), { cloudflare: 'wss://sb.example.com' });
  tunnels.stop();
});

test('Cloudflare: a name of more than one level, or one already in use in the zone, is refused', async () => {
  const cf = fakeCloudflare({
    ...CF_ROUTES,
    'GET /zones/zone1/dns_records?name=www.example.com': ok([{ id: 'site', type: 'A', content: '1.2.3.4' }]),
    'GET /accounts/acc1/cfd_tunnel?name=switchboard-www.example.com&is_deleted=false': ok([]),
  });
  const { tunnels } = setup({ fetch: cf.fetch });
  await assert.rejects(tunnels.setupCloudflare({ apiToken: 't', domain: 'example.com', name: 'a.b' }), /one word/);
  await assert.rejects(tunnels.setupCloudflare({ apiToken: 't', domain: 'example.com', name: 'www' }), /already has a DNS record/);
  assert.ok(!cf.calls.some((c) => c.method === 'POST' && c.path.endsWith('/dns_records')), 'nothing written over the site');
});

test('Cloudflare: a token without the permissions says which ones it needs', async () => {
  const cf = fakeCloudflare({ ...CF_ROUTES, 'POST /accounts/acc1/cfd_tunnel': { status: 403, body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] } } });
  const { tunnels } = setup({ fetch: cf.fetch });
  await assert.rejects(tunnels.setupCloudflare({ apiToken: 't', domain: 'example.com', name: 'sb' }), /creating the tunnel.*Account › Cloudflare Tunnel › Edit/);
});

test('Cloudflare: a token that may make tunnels but not DNS records says it needs DNS › Edit', async () => {
  const cf = fakeCloudflare({ ...CF_ROUTES, 'POST /zones/zone1/dns_records': { status: 403, body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] } } });
  const { tunnels } = setup({ fetch: cf.fetch });
  await assert.rejects(tunnels.setupCloudflare({ apiToken: 't', domain: 'example.com', name: 'sb' }), /DNS record.*Zone › DNS › Edit/);
});

test('Cloudflare: a domain the token cannot see is named', async () => {
  const cf = fakeCloudflare({ ...CF_ROUTES, 'GET /zones?name=other.com': ok([]) });
  const { tunnels } = setup({ fetch: cf.fetch });
  await assert.rejects(tunnels.setupCloudflare({ apiToken: 't', domain: 'other.com', name: 'sb' }), /other\.com/);
});

test('removing Cloudflare with the API token deletes the tunnel and its record', async () => {
  const cf = fakeCloudflare({
    ...CF_ROUTES,
    'DELETE /accounts/acc1/cfd_tunnel/tun1/connections': ok(null),
    'DELETE /accounts/acc1/cfd_tunnel/tun1': ok({}),
    'DELETE /zones/zone1/dns_records/rec1': ok({ id: 'rec1' }),
  });
  const { tunnels, settings } = setup({ fetch: cf.fetch });
  await tunnels.setupCloudflare({ apiToken: 't', domain: 'example.com', name: 'sb' });
  await tunnels.removeCloudflare({ apiToken: 't' });
  const deletes = cf.calls.filter((c) => c.method === 'DELETE').map((c) => c.path);
  assert.deepEqual(deletes, ['/accounts/acc1/cfd_tunnel/tun1/connections', '/accounts/acc1/cfd_tunnel/tun1', '/zones/zone1/dns_records/rec1']);
  assert.equal(JSON.parse(settings.get('remoteTunnels')).cloudflare, undefined);
  assert.equal(tunnels.status().cloudflare.configured, false);
});

test('an agent that stops is started again while access is on, and not after', async () => {
  const { tunnels, children } = setup();
  tunnels.setupNgrok({ authtoken: 't' });
  tunnels.start();
  children[0].emit('exit', 1, null);
  assert.equal(tunnels.status().ngrok.running, false);
  await tick();
  assert.equal(children.length, 2, 'started again');
  tunnels.stop();
  await tick();
  assert.equal(children[1].killed, true);
  assert.equal(children.length, 2, 'not started after stop');
});

test('without the program installed, the status says how to install it', () => {
  const { tunnels, children } = setup({ binaries: {} });
  tunnels.setupNgrok({ authtoken: 't' });
  tunnels.start();
  assert.equal(children.length, 0);
  assert.match(tunnels.status().ngrok.error, /brew install ngrok/);
  tunnels.stop();
});

test('findBinary looks in PATH and in Homebrew, which an app opened from the Finder does not have in PATH', () => {
  const present = new Set(['/opt/homebrew/bin/cloudflared', '/usr/bin/true']);
  const exists = (p) => present.has(p);
  assert.equal(findBinary('cloudflared', { pathEnv: '/usr/bin:/bin', exists }), '/opt/homebrew/bin/cloudflared');
  assert.equal(findBinary('true', { pathEnv: '/usr/bin:/bin', exists }), '/usr/bin/true');
  assert.equal(findBinary('ngrok', { pathEnv: '/usr/bin', exists }), null);
});

test('an authtoken ngrok refuses is not tried again until it changes', async () => {
  const { tunnels, children } = setup();
  tunnels.setupNgrok({ authtoken: 'bad' });
  tunnels.start();
  children[0].print(`${JSON.stringify({ lvl: 'eror', msg: 'session closing', err: 'authentication failed: Your authtoken is invalid.\r\n\r\nERR_NGROK_107\r\n' })}\n`);
  children[0].emit('exit', 1, null);
  await tick();
  assert.equal(children.length, 1, 'not started again with the same authtoken');
  assert.match(tunnels.status().ngrok.error, /ERR_NGROK_107/);
  tunnels.setupNgrok({ authtoken: 'good' });
  assert.equal(children.length, 2, 'a new authtoken starts it again');
  tunnels.stop();
});

test('Cloudflare: a token that is not one says so', async () => {
  const cf = fakeCloudflare({ ...CF_ROUTES, 'GET /zones?name=example.com': { status: 400, body: { success: false, errors: [{ code: 6003, message: 'Invalid request headers', error_chain: [{ code: 6111, message: 'Invalid format for Authorization header' }] }] } } });
  const { tunnels } = setup({ fetch: cf.fetch });
  await assert.rejects(tunnels.setupCloudflare({ apiToken: 'x', domain: 'example.com', name: 'sb' }), /token is not valid/);
});
