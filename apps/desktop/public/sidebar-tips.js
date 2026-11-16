// Tooltips for the tabs of the sidebar's strip: each says what its tab is. The
// Task Manager's and Stats' also hold a button that opens that page in a window
// of its own (main.js openToolWindow), next to the name; a click on the tab
// itself opens it in the main area, as before. The pointer can move from the
// tab onto its tooltip to reach that button: the tooltip waits a moment
// before it goes. Tabs carry data-tip (the name) and data-window (the window
// kind, when there is one). Uses escapeHtml (utils.js) and ICONS (icons.js).

(() => {
  const strip = document.getElementById('sidebar-tabs');
  if (!strip) return;
  const SHOW_AFTER_MS = 350;
  const HIDE_AFTER_MS = 200;

  const tip = document.createElement('div');
  tip.className = 'sidebar-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);

  let current = null;
  let showTimer = null;
  let hideTimer = null;

  function place(tab) {
    const rect = tab.getBoundingClientRect();
    const width = tip.offsetWidth;
    const left = Math.max(6, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 6));
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(rect.bottom + 6)}px`;
  }

  function show(tab) {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    current = tab;
    const label = tab.dataset.tip;
    const kind = tab.dataset.window;
    tip.classList.toggle('with-action', !!kind);
    tip.innerHTML = `<span class="sidebar-tip-label">${escapeHtml(label)}</span>` + (kind
      ? `<button type="button" class="sidebar-tip-window" title="Open in a window of its own" aria-label="Open ${escapeHtml(label)} in a window of its own">${ICONS.popOut(13)}</button>`
      : '');
    const button = tip.querySelector('.sidebar-tip-window');
    if (button) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        hide();
        window.api.openToolWindow(kind);
      });
    }
    tab.setAttribute('aria-describedby', 'sidebar-tip');
    tip.id = 'sidebar-tip';
    tip.hidden = false;
    place(tab);
  }

  function hide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    current?.removeAttribute('aria-describedby');
    current = null;
    tip.hidden = true;
  }

  function hideSoon() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, HIDE_AFTER_MS);
  }

  for (const tab of strip.querySelectorAll('.sidebar-tab[data-tip]')) {
    tab.addEventListener('mouseenter', () => {
      clearTimeout(hideTimer);
      if (current === tab) return;
      // Already reading tooltips along the strip: the next one shows at once.
      if (current) { show(tab); return; }
      clearTimeout(showTimer);
      showTimer = setTimeout(() => show(tab), SHOW_AFTER_MS);
    });
    tab.addEventListener('mouseleave', () => {
      clearTimeout(showTimer);
      if (current) hideSoon();
    });
    // The click opens the tab; its tooltip would only cover what opens.
    tab.addEventListener('click', hide);
    // Keyboard focus shows the name too (and reaches the window button with Tab).
    tab.addEventListener('focus', () => { if (tab.matches(':focus-visible')) show(tab); });
    tab.addEventListener('blur', (event) => { if (!tip.contains(event.relatedTarget)) hideSoon(); });
  }

  tip.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  tip.addEventListener('mouseleave', hideSoon);
  tip.addEventListener('focusout', (event) => { if (!tip.contains(event.relatedTarget) && event.relatedTarget !== current) hideSoon(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && current) hide(); });
  window.addEventListener('blur', hide);
  window.addEventListener('resize', hide);
})();
