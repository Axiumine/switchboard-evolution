import * as SecureStore from 'expo-secure-store';

import { fromBase64, toBase64, type KeyPair } from '@/shared/vendor/remote-protocol';
import type { DesktopLink, Hello, InternetRoutes, RouteName } from '@/remote/client';

// The computers this phone is paired with, in the keychain (iOS) or the
// Keystore-backed store (Android): each holds this phone's secret key for it.

export type SavedDesktop = {
  /** This phone's id on that computer. */
  deviceId: string;
  name: string;
  addresses: string[];
  port: number;
  desktopKey: string;
  devicePublicKey: string;
  deviceSecretKey: string;
  pairedAt: number;
  lastAddress?: string;
  /** The computer's access key, carried by every connection. */
  accessKey?: string;
  /** Its ways in from the Internet. */
  internet?: InternetRoutes;
  /** The way chosen at the top of the sessions: the local network when not set. */
  route?: RouteName;
};

const INDEX_KEY = 'desktops';
const ACTIVE_KEY = 'desktops.active';
const itemKey = (deviceId: string) => `desktop.${deviceId}`;

async function readIndex(): Promise<string[]> {
  try {
    const list = JSON.parse((await SecureStore.getItemAsync(INDEX_KEY)) || '[]');
    return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export async function loadDesktops(): Promise<SavedDesktop[]> {
  const desktops: SavedDesktop[] = [];
  for (const id of await readIndex()) {
    const raw = await SecureStore.getItemAsync(itemKey(id));
    if (raw) {
      try { desktops.push(JSON.parse(raw)); } catch {}
    }
  }
  return desktops;
}

export async function loadActiveDesktop(): Promise<SavedDesktop | null> {
  const desktops = await loadDesktops();
  const active = await SecureStore.getItemAsync(ACTIVE_KEY);
  return desktops.find((d) => d.deviceId === active) || desktops[0] || null;
}

export async function saveDesktop(desktop: SavedDesktop, { makeActive = false } = {}) {
  await SecureStore.setItemAsync(itemKey(desktop.deviceId), JSON.stringify(desktop));
  const index = await readIndex();
  if (!index.includes(desktop.deviceId)) await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify([...index, desktop.deviceId]));
  if (makeActive) await SecureStore.setItemAsync(ACTIVE_KEY, desktop.deviceId);
}

/** Forget a computer on this phone. It stays paired there until removed on the computer. */
export async function removeDesktop(deviceId: string) {
  await SecureStore.deleteItemAsync(itemKey(deviceId));
  await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify((await readIndex()).filter((id) => id !== deviceId)));
  if ((await SecureStore.getItemAsync(ACTIVE_KEY)) === deviceId) await SecureStore.deleteItemAsync(ACTIVE_KEY);
}

export function desktopFromPairing(
  pairing: { desktopName: string; addresses: string[]; port: number; desktopKey: Uint8Array; accessKey?: string; routes?: InternetRoutes },
  device: KeyPair,
  hello: Hello,
  address: string,
  route: RouteName = 'lan',
): SavedDesktop {
  return {
    deviceId: hello.device.id,
    name: hello.desktop || pairing.desktopName,
    addresses: pairing.addresses,
    port: pairing.port,
    desktopKey: toBase64(pairing.desktopKey),
    devicePublicKey: toBase64(device.publicKey),
    deviceSecretKey: toBase64(device.secretKey),
    pairedAt: Date.now(),
    lastAddress: address,
    // The hello is newer than the QR code.
    accessKey: hello.accessKey ?? pairing.accessKey,
    internet: hello.routes ?? pairing.routes ?? {},
    route,
  };
}

/**
 * The computer as its hello describes it: a newer access key and Internet
 * routes. Null when nothing changed, or when the computer (from before them)
 * says nothing about them.
 */
export function withHello(desktop: SavedDesktop, hello: Hello): SavedDesktop | null {
  const accessKey = hello.accessKey ?? desktop.accessKey;
  const internet = hello.routes ?? desktop.internet ?? {};
  if (accessKey === desktop.accessKey && JSON.stringify(internet) === JSON.stringify(desktop.internet ?? {})) return null;
  return { ...desktop, accessKey, internet };
}

export function linkOf(desktop: SavedDesktop): DesktopLink {
  // The address that worked last goes first.
  const addresses = desktop.lastAddress && desktop.addresses.includes(desktop.lastAddress)
    ? [desktop.lastAddress, ...desktop.addresses.filter((a) => a !== desktop.lastAddress)]
    : desktop.addresses;
  return {
    addresses, port: desktop.port, desktopKey: fromBase64(desktop.desktopKey),
    accessKey: desktop.accessKey, internet: desktop.internet, route: desktop.route,
  };
}

export function keyPairOf(desktop: SavedDesktop): KeyPair {
  return { publicKey: fromBase64(desktop.devicePublicKey), secretKey: fromBase64(desktop.deviceSecretKey) };
}
