import { expect, jest, test } from '@jest/globals';

import { sessionMemory } from '@/shared/vendor/usage-chart';
import { memoryFigure } from '../session-memory';

// Hoisted above the imports by jest: the hook's module is read without a connection.
jest.mock('@/store/connection', () => ({ request: jest.fn(), useCapability: () => false, useConnection: () => false }));

const MB = 1024 * 1024;
const GB = 1024 * MB;

test('a row shows what its live session uses, amber from 1 GB and red from 2 GB, as on the desktop', () => {
  expect(memoryFigure(300 * MB)).toEqual({ bytes: 300 * MB, level: 'low' });
  expect(memoryFigure(1.5 * GB)?.level).toBe('mid');
  expect(memoryFigure(3 * GB)?.level).toBe('high');
});

test('a session that runs nothing shows no figure', () => {
  expect(memoryFigure(undefined)).toBeNull();
  expect(memoryFigure(0)).toBeNull();
  expect(memoryFigure(Number.NaN)).toBeNull();
});

test('a session\'s figure adds up its processes from the Task Manager\'s measurement', () => {
  const byId = sessionMemory({
    owners: [
      { kind: 'session', id: 'a', rssBytes: 100 * MB },
      { kind: 'session', id: 'a', rssBytes: 50 * MB },
      { kind: 'task', id: 'a', rssBytes: 999 * MB },
      { kind: 'session', id: 'b', rssBytes: 10 * MB },
    ],
  });
  expect(byId.get('a')).toBe(150 * MB);
  expect(byId.get('b')).toBe(10 * MB);
});
