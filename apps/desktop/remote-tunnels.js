// Remote access from the Internet, for the Fork: a Cloudflare Tunnel or ngrok,
// or both, publish the remote-access server's port without opening the
// router. Switchboard runs the agent (cloudflared, ngrok) while access is on,
// starts it again if it stops, and reads the address it publishes; those are
// the Internet routes a phone gets (remote-server.js). Through a tunnel a
// phone still needs the access key and its own key, and what it sends stays
// encrypted end to end: Cloudflare and ngrok see only ciphertext.
//
// Stored under `remoteTunnels`: { cloudflare: { hostname, accountId, zoneId,
// tunnelId, recordId, port, token }, ngrok: { domain, token } }. The tokens
// (the tunnel's own, ngrok's authtoken) are encrypted with the system keychain
// first. Cloudflare's API token is used to set the tunnel up and then dropped.

const fs = require('fs');
const path = require('path');

const CF_API = 'https://api.cloudflare.com/client/v4';
const RESTART_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000, 60_000];
// One label, as Cloudflare's free certificate covers *.domain but not deeper.
const NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const HOMEBREW_BINS = ['/opt/homebrew/bin', '/usr/local/bin'];

/** Where a program is: PATH first, then Homebrew's folders (an app opened from the Finder has a short PATH). */
function findBinary(name, { pathEnv = process.env.PATH || '', exists = fs.existsSync } = {}) {
  for (const dir of [...pathEnv.split(path.delimiter).filter(Boolean), ...HOMEBREW_BINS]) {
    const candidate = path.join(dir, name);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/**
 * One agent process, kept running while wanted. `command()` gives what to run
 * (or throws a message to show), and `parse(line)` turns its output into
 * { url } once it publishes and { error } when it complains; { refused: true }
 * too when its token was turned down, and then it is not started again until
 * its settings change or access is turned on again.
 */
function supervise({ name, spawn, command, parse, log, onChange, restartDelaysMs }) {
  let child = null;
  let timer = null;
  let wanted = false;
  let failures = 0;
  let refused = false;
  let state = { running: false, url: null, error: null };

  const set = (patch) => { state = { ...state, ...patch }; onChange(); };

  function launch() {
    timer = null;
    let spec;
    try {
      spec = command();
    } catch (err) {
      set({ running: false, url: null, error: err.message });
      return;
    }
    const proc = spawn(spec.bin, spec.args, { env: { ...process.env, ...spec.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    child = proc;
    set({ running: true, url: null });
    const reader = () => {
      let rest = '';
      return (chunk) => {
        const lines = (rest + chunk.toString()).split('\n');
        rest = lines.pop();
        for (const line of lines) {
          const found = line.trim() && parse(line);
          if (!found) continue;
          if (found.url) failures = 0;
          if (found.refused) refused = true;
          const { refused: _, ...patch } = found;
          set(patch);
        }
      };
    };
    proc.stdout.on('data', reader());
    proc.stderr.on('data', reader());
    proc.on('error', (err) => set({ error: err.message }));
    proc.on('exit', (code, signal) => {
      if (child !== proc) return;
      child = null;
      set({ running: false, url: null });
      if (!wanted || refused) return;
      const delay = restartDelaysMs[Math.min(failures, restartDelaysMs.length - 1)];
      failures += 1;
      log.warn(`[tunnel] ${name} exited (${signal || code}), starting it again in ${delay} ms`);
      timer = setTimeout(launch, delay);
    });
  }

  return {
    start() {
      wanted = true;
      refused = false;
      if (!child && !timer) launch();
    },
    stop() {
      wanted = false;
      clearTimeout(timer);
      timer = null;
      const proc = child;
      child = null;
      if (proc) proc.kill();
      set({ running: false, url: null });
    },
    /** Start again, e.g. after its settings changed. */
    restart() {
      this.stop();
      this.start();
    },
    reset() {
      failures = 0;
      refused = false;
      set({ error: null });
    },
    state: () => state,
  };
}

const TUNNEL_EDIT = 'Account › Cloudflare Tunnel › Edit';
const DNS_EDIT = 'Zone › DNS › Edit';

/** Cloudflare's answer to a failed call (`step`, which needs `need`), in words the user can act on. */
function cloudflareError(status, error, { step, need }) {
  const codes = [error?.code, ...(error?.error_chain || []).map((e) => e.code)];
  if (codes.some((code) => code === 6003 || code === 6111 || code === 9106)) {
    return 'The Cloudflare token is not valid: copy it again from the Cloudflare dashboard (My Profile, API Tokens).';
  }
  if (status === 401 || status === 403 || error?.code === 10000 || error?.code === 9109) {
    return `Cloudflare refused ${step}: the token needs the permission ${need}.`;
  }
  return `Cloudflare: ${error?.message || `HTTP ${status}`}`;
}

function createRemoteTunnels({
  getSetting, setSetting, encrypt, decrypt, spawn, fetch, log, port, configDir,
  findBinary: find = findBinary, restartDelaysMs = RESTART_DELAYS_MS, onChange = () => {},
}) {
  let active = false;
  const config = () => getSetting('remoteTunnels') || {};
  const save = (patch) => {
    const next = { ...config(), ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    setSetting('remoteTunnels', next);
  };
  const binary = (name) => {
    const found = find(name);
    if (!found) throw new Error(`${name} is not installed. Install it with: brew install ${name}`);
    return found;
  };

  const cloudflare = supervise({
    name: 'cloudflared', spawn, log, onChange, restartDelaysMs,
    command: () => {
      const cf = config().cloudflare;
      if (cf.port !== port()) throw new Error(`The tunnel points to port ${cf.port}: set Cloudflare up again for port ${port()}.`);
      return { bin: binary('cloudflared'), args: ['tunnel', '--no-autoupdate', 'run'], env: { TUNNEL_TOKEN: decrypt(cf.token) } };
    },
    parse: (line) => {
      if (/Registered tunnel connection/.test(line)) return { url: `wss://${config().cloudflare?.hostname}`, error: null };
      const error = /\sERR\s+(.*)$/.exec(line);
      if (!error) return null;
      return { error: error[1].trim(), refused: /Unauthorized|token is not valid|Invalid tunnel secret/i.test(line) };
    },
  });

  // ngrok wants a config file; this one only turns off its web page and update check.
  const ngrokConfig = () => {
    const file = path.join(configDir, 'ngrok.yml');
    if (!fs.existsSync(file)) {
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(file, 'version: "3"\nagent:\n  web_addr: false\n  update_check: false\n');
    }
    return file;
  };
  const ngrok = supervise({
    name: 'ngrok', spawn, log, onChange, restartDelaysMs,
    command: () => {
      const ng = config().ngrok;
      const bin = binary('ngrok');
      const args = ['http', String(port()), '--log', 'stdout', '--log-format', 'json', '--config', ngrokConfig()];
      if (ng.domain) args.push('--url', `https://${ng.domain}`);
      return { bin, args, env: { NGROK_AUTHTOKEN: decrypt(ng.token) } };
    },
    parse: (line) => {
      let entry;
      try { entry = JSON.parse(line); } catch { return null; }
      if (entry.msg === 'started tunnel' && typeof entry.url === 'string') return { url: entry.url.replace(/^https?:/, 'wss:'), error: null };
      if (entry.lvl === 'eror' && entry.err && entry.err !== '<nil>') {
        const text = String(entry.err).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        const code = text.find((l) => /^ERR_NGROK_\d+$/.test(l));
        // ERR_NGROK_10x: the authtoken itself; trying again with it is pointless.
        const refused = /^authentication failed/i.test(text[0]) || /^ERR_NGROK_10\d$/.test(code || '');
        return { error: code && text[0] !== code ? `${text[0]} (${code})` : text[0], refused };
      }
      return null;
    },
  });
  const agents = { cloudflare, ngrok };

  /** Run the agents that are set up, while remote access is on. */
  function start() {
    active = true;
    for (const [name, agent] of Object.entries(agents)) if (config()[name]) agent.start();
  }

  function stop() {
    active = false;
    for (const agent of Object.values(agents)) agent.stop();
  }

  /** The address each running tunnel publishes, as the phone dials it. */
  function routes() {
    const out = {};
    for (const [name, agent] of Object.entries(agents)) if (agent.state().url) out[name] = agent.state().url;
    return out;
  }

  function status() {
    const cfg = config();
    return {
      cloudflare: { configured: !!cfg.cloudflare, hostname: cfg.cloudflare?.hostname || null, ...cloudflare.state() },
      ngrok: { configured: !!cfg.ngrok, domain: cfg.ngrok?.domain || null, ...ngrok.state() },
    };
  }

  async function cf(token, method, apiPath, body, why = { step: 'this', need: `${TUNNEL_EDIT} and ${DNS_EDIT}` }) {
    const res = await fetch(CF_API + apiPath, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (!data?.success) throw new Error(cloudflareError(res.status, data?.errors?.[0], why));
    return data.result;
  }

  /**
   * Make (or reuse) a tunnel named for `name.domain`, point it at this
   * server's port and give it a DNS record. The API token is not kept.
   */
  async function setupCloudflare({ apiToken, domain, name }) {
    const zoneName = String(domain || '').trim().toLowerCase().replace(/\.$/, '');
    const label = String(name || '').trim().toLowerCase();
    if (!apiToken) throw new Error('Paste a Cloudflare API token.');
    if (!DOMAIN_RE.test(zoneName)) throw new Error('Write the domain, like example.com.');
    if (!NAME_RE.test(label)) throw new Error('The name must be one word of letters, digits and dashes, like switchboard (no dots).');
    const hostname = `${label}.${zoneName}`;
    const zones = await cf(apiToken, 'GET', `/zones?name=${encodeURIComponent(zoneName)}`, undefined, { step: 'reading the domain', need: DNS_EDIT });
    if (!zones.length) throw new Error(`The token cannot see ${zoneName}: is the domain on this Cloudflare account, and the token allowed on it?`);
    const zone = zones[0];
    const accountId = zone.account.id;

    const records = await cf(apiToken, 'GET', `/zones/${zone.id}/dns_records?name=${encodeURIComponent(hostname)}`, undefined, { step: 'reading the DNS records', need: DNS_EDIT });
    const tunnelName = `switchboard-${hostname}`;
    const existing = await cf(apiToken, 'GET', `/accounts/${accountId}/cfd_tunnel?name=${encodeURIComponent(tunnelName)}&is_deleted=false`, undefined, { step: 'reading the tunnels', need: TUNNEL_EDIT });
    let tunnelId;
    let token;
    if (existing.length) {
      tunnelId = existing[0].id;
      token = await cf(apiToken, 'GET', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`, undefined, { step: 'reading the tunnel token', need: TUNNEL_EDIT });
    }
    const content = (id) => `${id}.cfargotunnel.com`;
    const ours = (record) => record.type === 'CNAME' && tunnelId && record.content === content(tunnelId);
    if (records.length && !records.every(ours)) {
      throw new Error(`${hostname} already has a DNS record: choose another name.`);
    }
    if (!tunnelId) {
      const created = await cf(apiToken, 'POST', `/accounts/${accountId}/cfd_tunnel`, { name: tunnelName, config_src: 'cloudflare' }, { step: 'creating the tunnel', need: TUNNEL_EDIT });
      tunnelId = created.id;
      token = created.token || await cf(apiToken, 'GET', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/token`, undefined, { step: 'reading the tunnel token', need: TUNNEL_EDIT });
    }
    await cf(apiToken, 'PUT', `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`, {
      config: { ingress: [{ hostname, service: `http://localhost:${port()}`, originRequest: {} }, { service: 'http_status:404' }] },
    }, { step: 'configuring the tunnel', need: TUNNEL_EDIT });
    const record = records.length
      ? records[0]
      : await cf(apiToken, 'POST', `/zones/${zone.id}/dns_records`, { type: 'CNAME', name: hostname, content: content(tunnelId), proxied: true }, { step: 'creating the DNS record', need: DNS_EDIT });

    save({ cloudflare: { hostname, accountId, zoneId: zone.id, tunnelId, recordId: record.id, port: port(), token: encrypt(token) } });
    log.info(`[tunnel] Cloudflare set up for ${hostname}`);
    cloudflare.reset();
    if (active) cloudflare.restart();
    return status();
  }

  /** Stop and forget the Cloudflare tunnel; with the API token, delete it and its record too. */
  async function removeCloudflare({ apiToken } = {}) {
    const cfg = config().cloudflare;
    cloudflare.stop();
    if (cfg && apiToken) {
      // A tunnel with connections cannot be deleted: drop them first.
      await cf(apiToken, 'DELETE', `/accounts/${cfg.accountId}/cfd_tunnel/${cfg.tunnelId}/connections`).catch(() => {});
      await cf(apiToken, 'DELETE', `/accounts/${cfg.accountId}/cfd_tunnel/${cfg.tunnelId}`);
      if (cfg.recordId) await cf(apiToken, 'DELETE', `/zones/${cfg.zoneId}/dns_records/${cfg.recordId}`);
    }
    save({ cloudflare: undefined });
    onChange();
    return status();
  }

  /** ngrok with the account's authtoken, on its own free domain unless one is given. */
  function setupNgrok({ authtoken, domain }) {
    const token = String(authtoken || '').trim();
    if (!token) throw new Error('Paste your ngrok authtoken.');
    const own = String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (own && !DOMAIN_RE.test(own)) throw new Error('Write the domain alone, like name.ngrok-free.app, or leave it empty.');
    save({ ngrok: { domain: own || null, token: encrypt(token) } });
    ngrok.reset();
    if (active) ngrok.restart();
    return status();
  }

  function removeNgrok() {
    ngrok.stop();
    save({ ngrok: undefined });
    onChange();
    return status();
  }

  /** The server moved to another port: ngrok follows; Cloudflare's tunnel says it must be set up again. */
  function portChanged() {
    if (!active) return;
    for (const [name, agent] of Object.entries(agents)) if (config()[name]) agent.restart();
  }

  return { start, stop, routes, status, setupCloudflare, removeCloudflare, setupNgrok, removeNgrok, portChanged };
}

module.exports = { createRemoteTunnels, findBinary };
