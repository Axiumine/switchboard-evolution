import { describe, expect, it } from '@jest/globals';

import { routesOffered, routeTargets, type DesktopLink } from '../client';

const desktopKey = new Uint8Array(32);
const lan: DesktopLink = { addresses: ['192.168.1.20', 'mac.local', 'fe80::1'], port: 47100, desktopKey };

describe('routeTargets', () => {
  it('tries every local address, the last one that worked first', () => {
    expect(routeTargets(lan, 'mac.local').map((t) => t.url)).toEqual([
      'ws://mac.local:47100/remote',
      'ws://192.168.1.20:47100/remote',
      'ws://[fe80::1]:47100/remote',
    ]);
  });

  it('carries the access key on the local network too, once the computer has one', () => {
    const [first] = routeTargets({ ...lan, accessKey: 'key-1' });
    expect(first.url).toBe('ws://192.168.1.20:47100/remote?k=key-1');
    expect(first.label).toBe('192.168.1.20');
  });

  it('goes through Cloudflare alone when that is the way chosen', () => {
    const targets = routeTargets({ ...lan, accessKey: 'key-1', internet: { cloudflare: 'wss://sb.example.com' }, route: 'cloudflare' });
    expect(targets).toEqual([{ url: 'wss://sb.example.com/remote?k=key-1', label: 'sb.example.com' }]);
  });

  it('asks ngrok to skip its warning page', () => {
    const [target] = routeTargets({ ...lan, accessKey: 'key-1', internet: { ngrok: 'wss://abc.ngrok-free.app' }, route: 'ngrok' });
    expect(target.url).toBe('wss://abc.ngrok-free.app/remote?k=key-1');
    expect(target.headers).toEqual({ 'ngrok-skip-browser-warning': '1' });
  });

  it('has nothing to try for a way the computer no longer offers', () => {
    expect(routeTargets({ ...lan, internet: {}, route: 'ngrok' })).toEqual([]);
  });
});

describe('routesOffered', () => {
  it('is the local network alone for a computer without Internet routes', () => {
    expect(routesOffered(undefined)).toEqual(['lan']);
    expect(routesOffered({})).toEqual(['lan']);
  });

  it('adds each Internet route the computer has', () => {
    expect(routesOffered({ ngrok: 'wss://a.ngrok-free.app', cloudflare: 'wss://sb.example.com' })).toEqual(['lan', 'cloudflare', 'ngrok']);
  });

  it('keeps the way in use when the computer no longer offers it', () => {
    expect(routesOffered({}, 'ngrok')).toEqual(['lan', 'ngrok']);
  });
});
