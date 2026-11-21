const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  DONATE_AMOUNTS, DONATE_DEFAULT_AMOUNT, DONATE_EVERY_MS, DONATE_MAX_STEP_MS,
  donateUrl, donateLabel, donateState, donateBoxDue, addDonateUsage, closeDonateBox, markDonated,
} = require('../public/donate');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
/** `minutes` of use, counted a minute at a time as the apps do. */
const use = (state, minutes) => {
  let s = state;
  for (let i = 0; i < minutes; i++) s = addDonateUsage(s, MINUTE);
  return s;
};

test('the box offers five amounts and starts on 1.49', () => {
  assert.deepEqual([...DONATE_AMOUNTS], ['0.99', '1.49', '1.99', '4.99', '9.99']);
  assert.equal(DONATE_DEFAULT_AMOUNT, '1.49');
  assert.ok(DONATE_AMOUNTS.includes(DONATE_DEFAULT_AMOUNT));
});

test('each amount opens its PayPal page in euros', () => {
  assert.equal(donateUrl('1.49'), 'https://www.paypal.com/paypalme/vinf/1.49EUR');
  assert.equal(donateUrl('9.99'), 'https://www.paypal.com/paypalme/vinf/9.99EUR');
});

test('an amount the box does not offer falls back to the default one', () => {
  assert.equal(donateUrl('1000'), 'https://www.paypal.com/paypalme/vinf/1.49EUR');
  assert.equal(donateUrl(''), 'https://www.paypal.com/paypalme/vinf/1.49EUR');
  assert.equal(donateUrl(undefined), 'https://www.paypal.com/paypalme/vinf/1.49EUR');
});

test('the combo shows each amount in euros', () => {
  assert.equal(donateLabel('0.99'), '€0.99');
});

test('the box under the projects list shows after an hour of use, not before', () => {
  assert.equal(DONATE_EVERY_MS, HOUR);
  const fresh = donateState(null);
  assert.deepEqual(fresh, { usageMs: 0, showAtMs: HOUR, donated: false });
  assert.equal(donateBoxDue(fresh), false);
  assert.equal(donateBoxDue(use(fresh, 59)), false);
  assert.equal(donateBoxDue(use(fresh, 60)), true);
});

test('its X puts it away for another hour of use, every time', () => {
  let s = use(donateState(null), 75);
  assert.equal(donateBoxDue(s), true);
  s = closeDonateBox(s);
  assert.equal(donateBoxDue(s), false);
  s = use(s, 59);
  assert.equal(donateBoxDue(s), false);
  s = use(s, 1);
  assert.equal(donateBoxDue(s), true, 'back an hour after it was closed');
  s = use(closeDonateBox(s), 60);
  assert.equal(donateBoxDue(s), true, 'and again after the next hour');
});

test('once the user donated it never comes back', () => {
  let s = markDonated(use(donateState(null), 10));
  assert.equal(donateBoxDue(s), false);
  s = use(s, 10 * 60);
  assert.equal(donateBoxDue(s), false);
  assert.equal(donateBoxDue(closeDonateBox(s)), false);
});

test('a long step is a computer that slept, not use', () => {
  const s = addDonateUsage(donateState(null), 3 * HOUR);
  assert.equal(s.usageMs, DONATE_MAX_STEP_MS);
  assert.equal(donateBoxDue(s), false);
  assert.equal(addDonateUsage(s, -5 * MINUTE).usageMs, DONATE_MAX_STEP_MS);
  assert.equal(addDonateUsage(s, NaN).usageMs, DONATE_MAX_STEP_MS);
});

test('a saved state that is missing or broken starts over', () => {
  assert.deepEqual(donateState(undefined), donateState({}));
  assert.deepEqual(donateState('nonsense'), { usageMs: 0, showAtMs: HOUR, donated: false });
  assert.deepEqual(donateState({ usageMs: -1, showAtMs: 'x', donated: 'yes' }), { usageMs: 0, showAtMs: HOUR, donated: false });
  assert.deepEqual(donateState({ usageMs: 5, showAtMs: 7, donated: true }), { usageMs: 5, showAtMs: 7, donated: true });
});

test('the box sits below the projects list, outside it, and only the Projects tab shows it', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const list = html.indexOf('<div id="projects-content" style="display:none;"></div>');
  const box = html.indexOf('<div id="donate-bar" hidden></div>');
  assert.ok(list >= 0 && box > list, 'the box comes after the list, not inside it');
  assert.ok(html.indexOf('<script src="donate.js"></script>') < html.indexOf('<script src="donate-box.js"></script>'));
  assert.ok(html.indexOf('<script src="project-window.js"></script>') < html.indexOf('<script src="donate-box.js"></script>'));

  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(app, /donateBar\.hidden = tabName !== 'projects'/);
});

test('the global Settings end with the same box, without its X', () => {
  const panel = fs.readFileSync(path.join(__dirname, '../public/settings-panel.js'), 'utf8');
  assert.match(panel, /\$\{!isProject \? `<div class="settings-section">\s*<div class="settings-section-title">Support<\/div>/);
  assert.match(panel, /donateSlot\.appendChild\(window\.buildDonateBox\(\)\)/);
  assert.ok(panel.indexOf('id="sv-donate"') < panel.indexOf('class="settings-btn-row"'), 'the last section, before Cancel and Save');

  const box = fs.readFileSync(path.join(__dirname, '../public/donate-box.js'), 'utf8');
  assert.match(box, /buildDonateBox\(\{ closable: true \}\)/, 'only the sidebar box has the X');
});
