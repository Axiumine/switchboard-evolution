import { describe, expect, it, jest } from '@jest/globals';
import { AppState } from 'react-native';

import * as keepAlive from '../../../modules/switchboard-keepalive';
import { startNotifications } from '../controller';
import * as presenter from '../presenter';

// The controller against a connection, a system and a service of the test's own.

let mockHear: (event: string, args: any[]) => void = () => {};
let mockState: any = { desktop: null, status: { state: 'closed' }, viewing: null };
const mockSubscribers: ((state: any, previous: any) => void)[] = [];
const mockRequest = jest.fn<(method: string) => Promise<any>>();

jest.mock('@/remote/random', () => ({}));
jest.mock('@/remote/query', () => ({ queryClient: { getQueryData: () => [] } }));
jest.mock('@/store/prefs', () => ({ loadPrefs: () => ({}), savePrefs: () => {} }));
jest.mock('@/store/connection', () => ({
  onDesktopEvent: (listener: any) => { mockHear = listener; return () => {}; },
  request: (method: string) => mockRequest(method),
  hasCapability: (status: any, method: string) => !!status.hello?.methods.includes(method),
  useConnection: { getState: () => mockState, subscribe: (listener: any) => { mockSubscribers.push(listener); return () => {}; } },
}));
jest.mock('../presenter', () => ({
  setUpNotifications: jest.fn(async () => {}),
  notificationsAllowed: jest.fn(async () => true),
  present: jest.fn(async () => {}),
  dismiss: jest.fn(async () => {}),
  shownAlerts: jest.fn(async () => new Map()),
}));
jest.mock('../../../modules/switchboard-keepalive', () => ({
  keepAliveAvailable: true,
  registerKeepAliveWork: jest.fn(),
  startKeepAlive: jest.fn(() => true),
  stopKeepAlive: jest.fn(),
  updateKeepAlive: jest.fn(),
}));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
function change(patch: object) {
  const previous = mockState;
  mockState = { ...mockState, ...patch };
  for (const listener of mockSubscribers) listener(mockState, previous);
}
const online = { state: 'online', hello: { methods: ['get-session-alerts'] } };
const alert = { sessionId: 's1', kind: 'finished' as const, title: 'Fix', body: 'Finished', at: 1 };

describe('the phone\'s notifications', () => {
  it('follow the computer\'s alerts and hold the connection', async () => {
    Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => 'active' });
    mockRequest.mockResolvedValue([]);
    startNotifications();
    change({ desktop: { deviceId: 'd', name: 'Studio' } });
    await settle();
    expect(keepAlive.startKeepAlive).toHaveBeenCalledWith('Connecting to Studio…');
    change({ status: online });
    await settle();
    expect(keepAlive.updateKeepAlive).toHaveBeenCalledWith('Connected to Studio');

    mockHear('session-alert', [alert]);
    expect(presenter.present).toHaveBeenCalledWith(alert);
    // The events behind the alert are the computer's business.
    mockHear('terminal-notification', ['s2', 'needs you', 'attention']);
    expect(presenter.present).toHaveBeenCalledTimes(1);
    mockHear('session-alert-cleared', ['s1']);
    expect(presenter.dismiss).toHaveBeenCalledWith('s1');

    // The session on the screen gets none.
    change({ viewing: 's3' });
    mockHear('session-alert', [{ ...alert, sessionId: 's3' }]);
    expect(presenter.present).toHaveBeenCalledTimes(1);

    change({ desktop: null, status: { state: 'closed' }, viewing: null });
    await settle();
    expect(keepAlive.stopKeepAlive).toHaveBeenCalled();
  });
});
