// A page in a window of its own (task-manager.html, stats.html, a project's
// tab): the pin in its header keeps the window above the others, or lets it
// go behind them. main.js remembers the choice per window. Uses ICONS (icons.js).

/** Make `pin` (a button, or nothing) the pin of the window this page is in. */
function setupWindowPin(pin) {
  if (!pin) return;
  pin.innerHTML = ICONS.pin(14);
  const showPin = (onTop) => {
    pin.classList.toggle('on', !!onTop);
    pin.setAttribute('aria-pressed', String(!!onTop));
    pin.title = onTop ? 'Kept above other windows: click to let it go behind them' : 'Keep above other windows';
    pin.setAttribute('aria-label', pin.title);
  };
  window.api.getWindowOnTop().then(showPin).catch(() => {});
  pin.addEventListener('click', async () => {
    showPin(await window.api.setWindowOnTop(!pin.classList.contains('on')));
  });
}

setupWindowPin(document.getElementById('tool-window-pin'));
