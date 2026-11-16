const { test } = require('node:test');
const assert = require('node:assert/strict');
const nacl = require('tweetnacl');

const { createRemoteProtocol, toBase64, fromBase64, PROTOCOL_VERSION } = require('../remote-protocol');

const protocol = createRemoteProtocol(nacl);
const desktop = nacl.box.keyPair();
const phone = nacl.box.keyPair();

/** Run a whole handshake; returns both channels and what the desktop learned. */
function handshake({ mode = 'auth', code = null, desktopKeyOnPhone = desktop.publicKey } = {}) {
  const hello = protocol.phoneHello(phone, { mode, name: 'Test phone' });
  const challenge = protocol.desktopChallenge(JSON.parse(JSON.stringify(hello.message)), desktop);
  const answer = protocol.phoneAnswer(JSON.parse(JSON.stringify(challenge.message)), hello.state, phone, desktopKeyOnPhone, code);
  const verified = protocol.desktopVerifyProof(JSON.parse(JSON.stringify(answer.message)), challenge.state, desktop);
  return { phoneChannel: answer.channel, desktopChannel: verified.channel, verified, challengeState: challenge.state };
}

test('base64 round-trips every length', () => {
  for (let n = 0; n < 70; n++) {
    const bytes = nacl.randomBytes(n);
    assert.deepEqual(fromBase64(toBase64(bytes)), bytes);
    assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'));
  }
  assert.throws(() => fromBase64('abc'), /Invalid base64/);
  assert.throws(() => fromBase64('ab$='), /Invalid base64/);
});

test('a handshake gives both ends a working channel in each direction', () => {
  const { phoneChannel, desktopChannel, verified } = handshake();
  assert.deepEqual(verified.devicePublicKey, phone.publicKey);
  assert.equal(verified.pairingCode, null);
  assert.deepEqual(desktopChannel.open(phoneChannel.seal({ id: 1, method: 'get-projects' })), { id: 1, method: 'get-projects' });
  assert.deepEqual(phoneChannel.open(desktopChannel.seal({ id: 1, result: ['è', 42] })), { id: 1, result: ['è', 42] });
});

test('pairing carries the code from the QR inside the proof', () => {
  const code = nacl.randomBytes(32);
  const { verified } = handshake({ mode: 'pair', code });
  assert.deepEqual([...verified.pairingCode], [...code]);
  assert.throws(() => handshake({ mode: 'pair', code: null }), /needs the code/);
});

test('a phone refuses a desktop whose key is not the one from the QR', () => {
  const impostor = nacl.box.keyPair();
  assert.throws(() => handshake({ desktopKeyOnPhone: impostor.publicKey }), /not from this desktop/);
});

test('the desktop refuses a proof from another key or for another challenge', () => {
  const hello = protocol.phoneHello(phone);
  const challenge = protocol.desktopChallenge(hello.message, desktop);
  const answer = protocol.phoneAnswer(challenge.message, hello.state, phone, desktop.publicKey);

  // The same proof against a new challenge (a replay of an old handshake).
  const fresh = protocol.desktopChallenge(hello.message, desktop);
  assert.throws(() => protocol.desktopVerifyProof(answer.message, fresh.state, desktop), /Wrong challenge/);

  // A hello naming another key: the proof does not open.
  const other = nacl.box.keyPair();
  const swapped = { ...challenge.state, devicePublicKey: other.publicKey };
  assert.throws(() => protocol.desktopVerifyProof(answer.message, swapped, desktop), /failed to decrypt/);
});

test('a swapped ephemeral key is caught on both sides', () => {
  const hello = protocol.phoneHello(phone);
  const challenge = protocol.desktopChallenge(hello.message, desktop);
  const tamperedChallenge = { ...challenge.message, eph: toBase64(nacl.box.keyPair().publicKey) };
  assert.throws(() => protocol.phoneAnswer(tamperedChallenge, hello.state, phone, desktop.publicKey), /Ephemeral key mismatch/);

  const answer = protocol.phoneAnswer(challenge.message, hello.state, phone, desktop.publicKey);
  const tamperedState = { ...challenge.state, phoneEph: nacl.box.keyPair().publicKey };
  assert.throws(() => protocol.desktopVerifyProof(answer.message, tamperedState, desktop), /Ephemeral key mismatch/);
});

test('frames cannot be altered, replayed or sent back to their sender', () => {
  const { phoneChannel, desktopChannel } = handshake();
  const frame = phoneChannel.seal({ id: 7 });
  const altered = Uint8Array.from(frame);
  altered[altered.length - 1] ^= 1;
  assert.throws(() => desktopChannel.open(altered), /failed to decrypt/);
  assert.deepEqual(desktopChannel.open(frame), { id: 7 });
  assert.throws(() => desktopChannel.open(frame), /Replayed frame/);
  assert.throws(() => phoneChannel.open(phoneChannel.seal({ id: 8 })), /wrong direction/);
});

test('each connection gets its own key', () => {
  const first = handshake();
  const second = handshake();
  assert.throws(() => second.desktopChannel.open(first.phoneChannel.seal({ id: 1 })), /failed to decrypt/);
});

test('an unknown protocol version is refused', () => {
  const hello = protocol.phoneHello(phone);
  assert.throws(() => protocol.desktopChallenge({ ...hello.message, v: PROTOCOL_VERSION + 1 }, desktop), /Unsupported protocol version/);
});

test('UTF-8 is encoded without TextEncoder, exactly as Node does', () => {
  const { encodeUtf8, decodeUtf8 } = require('../remote-protocol');
  for (const text of ['ascii', 'città è', '日本語', 'emoji 😀👍🏽', '\u0000 \u007f \u0080 ߿ ࠀ ￿']) {
    assert.deepEqual(Buffer.from(encodeUtf8(text)), Buffer.from(text, 'utf8'));
    assert.equal(decodeUtf8(encodeUtf8(text)), text);
  }
  // A cut-off sequence, a stray continuation byte and a lone surrogate become U+FFFD.
  assert.equal(decodeUtf8(Uint8Array.from([0x61, 0xe2, 0x82])), 'a�');
  assert.equal(decodeUtf8(Uint8Array.from([0x80, 0x62])), '�b');
  assert.equal(decodeUtf8(encodeUtf8('\ud800x')), '�x');
});
