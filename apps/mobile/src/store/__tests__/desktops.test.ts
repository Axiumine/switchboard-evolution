import { describe, expect, it } from '@jest/globals';

import { desktopFromPairing, linkOf, withHello, type SavedDesktop } from '../desktops';

const keyPair = { publicKey: new Uint8Array(32).fill(1), secretKey: new Uint8Array(32).fill(2) };
const hello = { v: 1, appVersion: '1.1.0', desktop: 'Studio Mac', device: { id: 'dev-1', name: 'Duo' }, methods: [] };
const pairing = { desktopName: 'Mac', addresses: ['192.168.1.20'], port: 47100, desktopKey: new Uint8Array(32).fill(3) };

describe('saved computers and their ways in', () => {
  it('keep the access key, the Internet routes and the way chosen at pairing', () => {
    const saved = desktopFromPairing(
      { ...pairing, accessKey: 'key-1', routes: { cloudflare: 'wss://sb.example.com' } }, keyPair, hello, 'sb.example.com', 'cloudflare',
    );
    expect(saved.accessKey).toBe('key-1');
    expect(saved.internet).toEqual({ cloudflare: 'wss://sb.example.com' });
    expect(saved.route).toBe('cloudflare');
    const link = linkOf(saved);
    expect(link.route).toBe('cloudflare');
    expect(link.accessKey).toBe('key-1');
    expect(link.internet).toEqual({ cloudflare: 'wss://sb.example.com' });
  });

  it('learn a newer key and routes from the hello, and say when nothing changed', () => {
    const saved: SavedDesktop = desktopFromPairing(pairing, keyPair, hello, '192.168.1.20', 'lan');
    const updated = withHello(saved, { ...hello, accessKey: 'key-2', routes: { ngrok: 'wss://abc.ngrok-free.app' } });
    expect(updated?.accessKey).toBe('key-2');
    expect(updated?.internet).toEqual({ ngrok: 'wss://abc.ngrok-free.app' });
    expect(withHello(updated!, { ...hello, accessKey: 'key-2', routes: { ngrok: 'wss://abc.ngrok-free.app' } })).toBeNull();
  });

  it('keep what they know when a hello from an older computer says nothing', () => {
    const saved = desktopFromPairing({ ...pairing, accessKey: 'key-1', routes: { cloudflare: 'wss://sb.example.com' } }, keyPair, hello, 'x', 'lan');
    expect(withHello(saved, hello)).toBeNull();
  });
});
