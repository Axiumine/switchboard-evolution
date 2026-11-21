import { beforeEach, expect, test } from '@jest/globals';

import { donateBoxDue, donateUrl, DONATE_AMOUNTS, DONATE_DEFAULT_AMOUNT } from '@/shared/vendor/donate';

import { useDonate } from '../donate';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const due = () => donateBoxDue(useDonate.getState());
const use = (minutes: number) => {
  for (let i = 0; i < minutes; i++) useDonate.getState().addUsage(MINUTE);
};

beforeEach(() => useDonate.setState({ usageMs: 0, showAtMs: HOUR, donated: false }));

test('the box offers the desktop amounts, starting on 1.49, each on its PayPal page', () => {
  expect([...DONATE_AMOUNTS]).toEqual(['0.99', '1.49', '1.99', '4.99', '9.99']);
  expect(DONATE_DEFAULT_AMOUNT).toBe('1.49');
  expect(donateUrl('4.99')).toBe('https://www.paypal.com/paypalme/vinf/4.99EUR');
});

test('the box under the projects list comes after an hour in the foreground', () => {
  use(59);
  expect(due()).toBe(false);
  use(1);
  expect(due()).toBe(true);
});

test('its X puts it away for another hour of use', () => {
  use(60);
  useDonate.getState().close();
  expect(due()).toBe(false);
  use(59);
  expect(due()).toBe(false);
  use(1);
  expect(due()).toBe(true);
});

test('once Donate was pressed it does not come back', () => {
  use(60);
  useDonate.getState().recordDonation();
  expect(due()).toBe(false);
  use(5 * 60);
  expect(due()).toBe(false);
});

test('a long time away is not use', () => {
  useDonate.getState().addUsage(3 * HOUR);
  expect(useDonate.getState().usageMs).toBeLessThan(HOUR);
  expect(due()).toBe(false);
});
