import { describe, expect, it } from '@jest/globals';

import type { ConnectionStatus, Hello } from '@/remote/client';
import { hasCapability } from '../connection';

const hello: Hello = { v: 1, appVersion: '1.0.0', desktop: 'Test computer', device: { id: 'd1', name: 'Phone' }, methods: ['get-projects', 'read-file'] };
const online: ConnectionStatus = { state: 'online', address: 'test-address', hello };

describe('hasCapability', () => {
  it('is false when the computer is not reachable', () => {
    expect(hasCapability({ state: 'connecting' }, 'read-file')).toBe(false);
    expect(hasCapability({ state: 'offline', retryInMs: 1000, error: 'down' }, 'read-file')).toBe(false);
    expect(hasCapability({ state: 'closed' }, 'read-file')).toBe(false);
  });

  it('is true when online and the method is offered', () => {
    expect(hasCapability(online, 'read-file')).toBe(true);
  });

  it('is false when online without the method', () => {
    expect(hasCapability(online, 'write-file')).toBe(false);
  });
});
