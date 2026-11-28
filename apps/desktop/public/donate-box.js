// donate-box.js — the donation box; donate.js has the amounts, the PayPal
// pages and when it shows. One box is pinned at the foot of the Projects tab
// (#donate-bar, which app.js shows with that tab): it comes after an hour of
// use, its X puts it away for another hour, and it does not come back once
// Donate was pressed. The same box, without the X, ends the global Settings
// (settings-panel.js calls buildDonateBox).
(function () {
  if (typeof Donate === 'undefined') return;

  const STORAGE_KEY = 'donateBox';
  const STEP_MS = 60 * 1000;

  function loadState() {
    try { return Donate.donateState(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')); }
    catch { return Donate.donateState(null); }
  }
  let state = loadState();

  const bar = document.getElementById('donate-bar');
  function refreshBar() {
    if (bar) bar.classList.toggle('due', Donate.donateBoxDue(state));
  }
  // Each change starts from what is saved, so a project window's Donate does
  // not undo the time the main window counted meanwhile.
  function change(step) {
    state = step(loadState());
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
    refreshBar();
  }

  const HEART = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.9 4.5 6.6 4.5c2.1 0 3.6 1.1 4.4 2.6.8-1.5 2.3-2.6 4.4-2.6 3.7 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z"/></svg>';
  const CROSS = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  /** A donation box; `closable` adds the X of the one under the projects list. */
  function buildDonateBox({ closable = false } = {}) {
    const box = document.createElement('div');
    box.className = 'donate-box';
    box.innerHTML = `
      ${closable ? `<button type="button" class="donate-close" title="Close" aria-label="Close">${CROSS}</button>` : ''}
      <div class="donate-copy">
        <span class="donate-title">Enjoying Switchboard Evolution?</span>
        <span class="donate-sub">Support the work done so far with a donation.</span>
      </div>
      <div class="donate-row">
        <select class="donate-amount session-filter-select" title="Donation amount" aria-label="Donation amount"></select>
        <button type="button" class="donate-btn">${HEART}<span>Donate</span></button>
      </div>`;

    const select = box.querySelector('.donate-amount');
    for (const amount of Donate.DONATE_AMOUNTS) {
      const option = document.createElement('option');
      option.value = amount;
      option.textContent = Donate.donateLabel(amount);
      select.appendChild(option);
    }
    select.value = Donate.DONATE_DEFAULT_AMOUNT;

    box.querySelector('.donate-btn').addEventListener('click', () => {
      window.api.openExternal(Donate.donateUrl(select.value));
      change(Donate.markDonated);
    });
    if (closable) box.querySelector('.donate-close').addEventListener('click', () => change(Donate.closeDonateBox));
    return box;
  }

  if (bar) {
    bar.appendChild(buildDonateBox({ closable: true }));
    refreshBar();
  }

  // The time of use is the main window's, while it is not minimized. A
  // project window or a session window has no sidebar and does not count.
  const mainWindow = (typeof PROJECT_WINDOW === 'undefined' || !PROJECT_WINDOW)
    && (typeof SESSION_WINDOW === 'undefined' || !SESSION_WINDOW);
  if (mainWindow) {
    let last = Date.now();
    setInterval(() => {
      const now = Date.now();
      const step = now - last;
      last = now;
      if (!document.hidden) change(saved => Donate.addDonateUsage(saved, step));
    }, STEP_MS);
  }

  window.buildDonateBox = buildDonateBox;
})();
