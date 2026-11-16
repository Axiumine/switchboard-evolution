// Who may connect to the remote-access server: the desktop's own key pair,
// the paired devices, and the one pairing that can be open at a time.
//
// Stored in the settings table, so no schema change is needed:
// `remoteAccessIdentity` ({ publicKey, secretKey }, base64), `remoteDevices`
// ([{ id, name, publicKey, pairedAt, lastSeenAt }]) and `remoteAccessKey`. The
// secret key never leaves this machine; a device is known by its public key.

const crypto = require('crypto');
const { toBase64, fromBase64, equalBytes, KEY_BYTES } = require('./remote-protocol');

const PAIRING_TTL_MS = 2 * 60 * 1000;
const PAIRING_MAX_FAILURES = 5;
const MAX_DEVICE_NAME = 80;

function createRemoteAuth({ nacl, getSetting, setSetting, now = () => Date.now() }) {
  let pairing = null; // { code, expiresAt, failures }

  function identity() {
    const stored = getSetting('remoteAccessIdentity');
    if (stored?.publicKey && stored?.secretKey) {
      return { publicKey: fromBase64(stored.publicKey), secretKey: fromBase64(stored.secretKey) };
    }
    const pair = nacl.box.keyPair();
    setSetting('remoteAccessIdentity', { publicKey: toBase64(pair.publicKey), secretKey: toBase64(pair.secretKey) });
    return pair;
  }

  /**
   * The access key: random, made once, given to a phone only by the pairing QR
   * or inside its encrypted connection. A phone puts it in the address of every
   * connection, so the server can turn away anyone else before the handshake.
   */
  function accessKey() {
    const stored = getSetting('remoteAccessKey');
    if (typeof stored === 'string' && stored) return stored;
    const key = crypto.randomBytes(16).toString('base64url');
    setSetting('remoteAccessKey', key);
    return key;
  }

  function devices() {
    const list = getSetting('remoteDevices');
    return Array.isArray(list) ? list : [];
  }

  /** The paired device with this public key, or null. */
  function findDevice(publicKey) {
    const key = toBase64(publicKey);
    return devices().find(d => d.publicKey === key) || null;
  }

  /** Open a pairing: a fresh one-time code, valid for two minutes. Replaces any open one. */
  function startPairing() {
    pairing = { code: nacl.randomBytes(KEY_BYTES), expiresAt: now() + PAIRING_TTL_MS, failures: 0 };
    return { code: pairing.code, expiresAt: pairing.expiresAt };
  }

  function cancelPairing() {
    pairing = null;
  }

  function pairingOpen() {
    if (pairing && now() > pairing.expiresAt) pairing = null;
    return !!pairing;
  }

  /**
   * Check a pairing code from a proof and, if it matches, add the device.
   * The code works once. Too many wrong codes close the pairing.
   */
  function completePairing(code, publicKey, name) {
    if (!pairingOpen()) return { ok: false, error: 'No pairing is open' };
    if (!equalBytes(code, pairing.code)) {
      pairing.failures += 1;
      if (pairing.failures >= PAIRING_MAX_FAILURES) pairing = null;
      return { ok: false, error: 'Wrong pairing code' };
    }
    pairing = null;
    const key = toBase64(publicKey);
    const existing = devices().find(d => d.publicKey === key);
    if (existing) return { ok: true, device: existing };
    const device = {
      id: crypto.randomUUID(),
      name: String(name || '').trim().slice(0, MAX_DEVICE_NAME) || 'Phone',
      publicKey: key,
      pairedAt: now(),
      lastSeenAt: null,
    };
    setSetting('remoteDevices', [...devices(), device]);
    return { ok: true, device };
  }

  function touchDevice(id) {
    setSetting('remoteDevices', devices().map(d => (d.id === id ? { ...d, lastSeenAt: now() } : d)));
  }

  /** Forget a device. It cannot connect again until it is paired again. */
  function revokeDevice(id) {
    const list = devices();
    const kept = list.filter(d => d.id !== id);
    if (kept.length === list.length) return false;
    setSetting('remoteDevices', kept);
    return true;
  }

  /** Devices as the desktop UI shows them: no keys. */
  function listDevices() {
    return devices().map(({ id, name, pairedAt, lastSeenAt }) => ({ id, name, pairedAt, lastSeenAt }));
  }

  return { identity, accessKey, findDevice, startPairing, cancelPairing, pairingOpen, completePairing, touchDevice, revokeDevice, listDevices };
}

module.exports = { createRemoteAuth, PAIRING_TTL_MS, PAIRING_MAX_FAILURES };
