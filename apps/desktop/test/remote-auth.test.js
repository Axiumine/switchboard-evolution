const { test } = require('node:test');
const assert = require('node:assert/strict');
const nacl = require('tweetnacl');

const { createRemoteAuth, PAIRING_TTL_MS, PAIRING_MAX_FAILURES } = require('../remote-auth');

/** An auth module on an in-memory settings table, with a clock the test moves. */
function setup() {
  const settings = new Map();
  const clock = { now: 1_000_000 };
  const auth = createRemoteAuth({
    nacl,
    getSetting: (key) => (settings.has(key) ? JSON.parse(settings.get(key)) : null),
    setSetting: (key, value) => settings.set(key, JSON.stringify(value)),
    now: () => clock.now,
  });
  return { auth, settings, clock };
}

test('the desktop key is created once and kept', () => {
  const { auth, settings } = setup();
  const first = auth.identity();
  const second = auth.identity();
  assert.deepEqual(second.publicKey, first.publicKey);
  assert.deepEqual(second.secretKey, first.secretKey);
  assert.ok(settings.has('remoteAccessIdentity'));
});

test('a pairing code adds the device once and then stops working', () => {
  const { auth } = setup();
  const phone = nacl.box.keyPair();
  const { code } = auth.startPairing();
  assert.equal(auth.pairingOpen(), true);
  const result = auth.completePairing(code, phone.publicKey, '  Alex iPhone  ');
  assert.equal(result.ok, true);
  assert.equal(result.device.name, 'Alex iPhone');
  assert.deepEqual(auth.findDevice(phone.publicKey), result.device);
  assert.equal(auth.pairingOpen(), false);
  const again = auth.completePairing(code, nacl.box.keyPair().publicKey, 'Other');
  assert.deepEqual(again, { ok: false, error: 'No pairing is open' });
  assert.equal(auth.listDevices().length, 1);
});

test('pairing the same phone twice keeps one entry', () => {
  const { auth } = setup();
  const phone = nacl.box.keyPair();
  const first = auth.completePairing(auth.startPairing().code, phone.publicKey, 'Phone');
  const second = auth.completePairing(auth.startPairing().code, phone.publicKey, 'Phone again');
  assert.equal(second.device.id, first.device.id);
  assert.equal(auth.listDevices().length, 1);
});

test('a pairing expires after two minutes', () => {
  const { auth, clock } = setup();
  const { code, expiresAt } = auth.startPairing();
  assert.equal(expiresAt, clock.now + PAIRING_TTL_MS);
  clock.now = expiresAt + 1;
  assert.equal(auth.pairingOpen(), false);
  assert.equal(auth.completePairing(code, nacl.box.keyPair().publicKey, 'Late').ok, false);
});

test('too many wrong codes close the pairing', () => {
  const { auth } = setup();
  const { code } = auth.startPairing();
  for (let i = 0; i < PAIRING_MAX_FAILURES; i++) {
    assert.deepEqual(auth.completePairing(nacl.randomBytes(32), nacl.box.keyPair().publicKey, 'Guess'), { ok: false, error: 'Wrong pairing code' });
  }
  assert.equal(auth.pairingOpen(), false);
  assert.equal(auth.completePairing(code, nacl.box.keyPair().publicKey, 'Right but late').ok, false);
});

test('a revoked device is forgotten, and the list never shows keys', () => {
  const { auth } = setup();
  const phone = nacl.box.keyPair();
  const { device } = auth.completePairing(auth.startPairing().code, phone.publicKey, 'Phone');
  auth.touchDevice(device.id);
  const [listed] = auth.listDevices();
  assert.deepEqual(Object.keys(listed).sort(), ['id', 'lastSeenAt', 'name', 'pairedAt']);
  assert.ok(listed.lastSeenAt);
  assert.equal(auth.revokeDevice(device.id), true);
  assert.equal(auth.findDevice(phone.publicKey), null);
  assert.equal(auth.revokeDevice(device.id), false);
});
