// Copied from packages/shared/donate.js by scripts/sync-shared.mjs.
// Do not edit: change it in packages/shared and run npm run sync-shared.

// donate.js — the donation box: the amounts it offers, the PayPal page each
// one opens, and when the box shows at the foot of the projects list.
//
// The box in Settings is always there. The one under the projects list shows
// after an hour of use; its X puts it away for another hour of use, and once
// the user has donated (pressed Donate, here or in Settings) it never comes
// back. Each app keeps the state below and counts its own time of use.
//
// Shared with the phone app (scripts/sync-shared.mjs): no DOM, no Node.
(function (root) {
  const DONATE_AMOUNTS = ['0.99', '1.49', '1.99', '4.99', '9.99'];
  const DONATE_DEFAULT_AMOUNT = '1.49';
  const DONATE_CURRENCY = 'EUR';
  const PAYPAL_ME = 'https://www.paypal.com/paypalme/vinf/';

  /** The time of use between two showings of the box under the projects list. */
  const DONATE_EVERY_MS = 60 * 60 * 1000;
  /**
   * The most one step of use may add. The apps count in steps of a minute; a
   * longer one is a computer that slept or an app frozen in the background,
   * not use.
   */
  const DONATE_MAX_STEP_MS = 2 * 60 * 1000;

  /** The PayPal page for an amount; anything not offered falls back to the default one. */
  function donateUrl(amount) {
    const offered = DONATE_AMOUNTS.includes(String(amount)) ? String(amount) : DONATE_DEFAULT_AMOUNT;
    return PAYPAL_ME + offered + DONATE_CURRENCY;
  }

  /** How the combo shows an amount: "€1.49". */
  function donateLabel(amount) {
    return '€' + amount;
  }

  const count = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

  /**
   * The state as saved, made whole: the time of use so far, the time of use
   * at which the box shows (an hour in, at first) and whether the user donated.
   */
  function donateState(saved) {
    const s = saved && typeof saved === 'object' ? saved : {};
    return {
      usageMs: count(s.usageMs),
      showAtMs: count(s.showAtMs) || DONATE_EVERY_MS,
      donated: s.donated === true,
    };
  }

  /** Whether the box under the projects list shows. */
  function donateBoxDue(state) {
    const s = donateState(state);
    return !s.donated && s.usageMs >= s.showAtMs;
  }

  /** `ms` more of use, at most one step's worth. */
  function addDonateUsage(state, ms) {
    const s = donateState(state);
    return { ...s, usageMs: s.usageMs + Math.min(count(ms), DONATE_MAX_STEP_MS) };
  }

  /** The X: the box goes until another hour of use. */
  function closeDonateBox(state) {
    const s = donateState(state);
    return { ...s, showAtMs: s.usageMs + DONATE_EVERY_MS };
  }

  /** Donate was pressed: the box under the projects list does not come back. */
  function markDonated(state) {
    return { ...donateState(state), donated: true };
  }

  const api = {
    DONATE_AMOUNTS, DONATE_DEFAULT_AMOUNT, DONATE_CURRENCY, DONATE_EVERY_MS, DONATE_MAX_STEP_MS,
    donateUrl, donateLabel, donateState, donateBoxDue, addDonateUsage, closeDonateBox, markDonated,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Donate = api;
})(typeof window !== 'undefined' ? window : globalThis);
