import { beforeEach, expect, test } from '@jest/globals';

import { SESSION_ORDERS, PIN_FILTERS, STATUS_FILTERS } from '../model';
import { DEFAULT_LIST_PREFS, listPrefsFrom, useSessionListPrefs } from '../list-prefs';

beforeEach(() => useSessionListPrefs.setState({ ...DEFAULT_LIST_PREFS }));

test('the list starts on All, All, most recent first, not grouped', () => {
  const { status, pinned, order, groupByFolders } = useSessionListPrefs.getState();
  expect({ status, pinned, order, groupByFolders }).toEqual({ status: 'all', pinned: 'all', order: 'recent', groupByFolders: false });
});

test('each choice is set on its own', () => {
  const store = useSessionListPrefs.getState();
  store.setStatus('needsInput');
  store.setPinned('pinned');
  store.setOrder('runningPinned');
  store.setGroupByFolders(true);
  const { status, pinned, order, groupByFolders } = useSessionListPrefs.getState();
  expect({ status, pinned, order, groupByFolders }).toEqual({ status: 'needsInput', pinned: 'pinned', order: 'runningPinned', groupByFolders: true });
});

test('the combos offer the labels of the spec', () => {
  expect(STATUS_FILTERS.map((f) => f.label)).toEqual(['All', 'Running', 'Needs input', 'Not running']);
  expect(PIN_FILTERS.map((f) => f.label)).toEqual(['All', 'Pinned', 'Not pinned']);
  expect(SESSION_ORDERS.map((o) => o.label)).toEqual(['Most recent first', 'Running & pinned first']);
});

test('saved choices come back, and a value no longer offered falls back to its default', () => {
  expect(listPrefsFrom({ status: 'running', pinned: 'notPinned', order: 'runningPinned', groupByFolders: true }))
    .toEqual({ status: 'running', pinned: 'notPinned', order: 'runningPinned', groupByFolders: true });
  expect(listPrefsFrom({ status: 'today', pinned: 3, groupByFolders: 'yes' })).toEqual(DEFAULT_LIST_PREFS);
  expect(listPrefsFrom(undefined)).toEqual(DEFAULT_LIST_PREFS);
});
