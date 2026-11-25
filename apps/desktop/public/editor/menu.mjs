// A menu for the editor (its right-click menu and the status bar's choices),
// in the app's menu style (.ctx-menu in style.css), made here so that it works
// in every window that has an editor. Items: { label, hint, checked,
// disabled, run } or { sep: true }. Up, Down, Enter and Escape work in it.

let openMenu = null;

function closeEditorMenu() {
  if (!openMenu) return;
  const { menu, cleanup, onClose } = openMenu;
  openMenu = null;
  cleanup();
  menu.remove();
  if (onClose) onClose();
}

function placeMenu(menu, { x, y, anchor }) {
  const w = menu.offsetWidth;
  const h = menu.offsetHeight;
  let left = x ?? 8;
  let top = y ?? 8;
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    left = rect.left;
    top = rect.top - h - 4;
    if (top < 8) top = rect.bottom + 4;
  }
  if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
  if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

/** Show `items` at { x, y } (a right-click) or over/under `anchor`. `onClose` runs when it goes away. */
function showEditorMenu(items, position, { onClose = null } = {}) {
  closeEditorMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu cm-editor-menu';
  menu.setAttribute('role', 'menu');
  const rows = [];
  for (const item of items) {
    if (!item) continue;
    if (item.sep) {
      if (menu.lastChild && !menu.lastChild.classList.contains('ctx-sep')) {
        const sep = document.createElement('div');
        sep.className = 'ctx-sep';
        menu.appendChild(sep);
      }
      continue;
    }
    const row = document.createElement('div');
    row.className = `ctx-item${item.disabled ? ' disabled' : ''}`;
    row.setAttribute('role', 'menuitem');
    if (item.disabled) row.setAttribute('aria-disabled', 'true');
    const icon = document.createElement('span');
    icon.className = 'ctx-icon';
    // An element, so that the menu shows its icon column (style.css hides an empty one).
    if (item.checked) icon.innerHTML = '<span aria-hidden="true">✓</span>';
    const label = document.createElement('span');
    label.className = 'ctx-label';
    label.textContent = item.label;
    row.append(icon, label);
    if (item.hint) {
      const hint = document.createElement('span');
      hint.className = 'ctx-hint';
      hint.textContent = item.hint;
      row.appendChild(hint);
    }
    if (!item.disabled) {
      row.addEventListener('mousedown', e => e.preventDefault());
      row.addEventListener('click', (e) => { e.stopPropagation(); closeEditorMenu(); item.run(); });
      rows.push(row);
    }
    menu.appendChild(row);
  }
  if (menu.lastChild && menu.lastChild.classList.contains('ctx-sep')) menu.lastChild.remove();
  document.body.appendChild(menu);
  placeMenu(menu, position);

  let active = -1;
  const setActive = (i) => {
    active = (i + rows.length) % rows.length;
    rows.forEach((row, n) => row.classList.toggle('open', n === active));
    rows[active].scrollIntoView({ block: 'nearest' });
  };
  const onPointer = (e) => { if (!menu.contains(e.target)) closeEditorMenu(); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeEditorMenu(); }
    else if (e.key === 'ArrowDown' && rows.length) { e.preventDefault(); e.stopPropagation(); setActive(active + 1); }
    else if (e.key === 'ArrowUp' && rows.length) { e.preventDefault(); e.stopPropagation(); setActive(active - 1); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); e.stopPropagation(); rows[active].click(); }
  };
  const onBlur = () => closeEditorMenu();
  setTimeout(() => {
    if (!openMenu || openMenu.menu !== menu) return;
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
  }, 0);
  openMenu = {
    menu,
    onClose,
    cleanup() {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
    },
  };
  return menu;
}

export { showEditorMenu, closeEditorMenu };
