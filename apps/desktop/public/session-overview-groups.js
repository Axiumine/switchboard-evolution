// --- Session Overview: the groups' + and ⋯ ---
// When the Session Overview (session-overview.js) groups its cards by folder or
// by project, each group's header gets a + (a new session in that group) and a
// ⋯ (the group's menu); a right click on the header opens the same menu as ⋯.
// Groups of the other kinds (CLI, kind, pinned, status, period, "No project",
// and the single group of no grouping) get neither.
//
//   folder (a worktree too)  + the New session popover of the folder
//                            ⋯ New session… (the same popover), Run project
//                              task / Set up project tasks (the task popover,
//                              under the ⋯), the folder's scheduled tasks or
//                              New scheduled task…, Folder settings, Archive
//                              all sessions… (asks first); for a worktree also
//                              Hide worktree (asks first)
//   project                  + the project's New session menu
//                            ⋯ the project's right-click menu, New session included
//
// A session started from them shows on the page, in its group, in focus: the
// page adopts the sessions that start while it is open (session-overview.js,
// showSession), and the session's folder or project is its group's.
//
// session-overview.js calls decorateOverviewGroupHeader on every draw of a
// group's header, through a typeof guard.
//
// Depends on: overviewHeaderButton, OV_WORKTREE_PATH (session-overview.js);
// overviewFolderFor (session-overview-panel.js); findProject, showTaskPopover,
// runningTaskCount (task-runner.js); showNewSessionPopover (dialogs.js);
// archiveFolderSessions, hideWorktree (sidebar.js); schedulesForFolder,
// scheduleMenuItems, showScheduleDialog (schedules.js); findTreeProject,
// newSessionItems, projectMenuItems, showContextMenu, PICONS (projects-view.js);
// openSettingsViewer (settings-panel.js); ICONS (icons.js). Nothing here runs
// before the page draws.

// A header -> the group it was drawn for last: a header outlives a draw, its group does not.
const ovGroupOfHeader = new WeakMap();

/** Folder groups with a folder, and project groups, have a + and a ⋯. */
function overviewGroupHasActions(group) {
  if (group?.kind === 'folder') return !!group.path;
  if (group?.kind === 'project') return !!group.projectId;
  return false;
}

/** A folder group's entry in the Sessions lists (its tasks too), or one made up for it. */
function overviewGroupFolder(group) {
  return (typeof findProject === 'function' && findProject(group.path)) || overviewFolderFor(group.path);
}

/**
 * A folder's New session popover (dialogs.js), kept on screen: it hangs from
 * its anchor's left edge, and a header's + and ⋯ are at the page's right edge.
 * It is laid out again once main has listed the CLIs, so it is watched.
 */
function showOverviewGroupPopover(folder, anchor) {
  showNewSessionPopover(folder, anchor);
  const popover = typeof document !== 'undefined' ? document.querySelector('.new-session-popover') : null;
  if (!popover) return;
  const keepOnScreen = () => {
    const max = window.innerWidth - popover.offsetWidth - 8;
    if (parseFloat(popover.style.left) > max) popover.style.left = `${Math.max(8, max)}px`;
  };
  keepOnScreen();
  new MutationObserver(keepOnScreen).observe(popover, { childList: true, attributes: true, attributeFilter: ['style'] });
}

/** The + of a group: a new session in its folder, or in its project. */
function overviewGroupNew(group, anchor) {
  if (!overviewGroupHasActions(group)) return;
  if (group.kind === 'folder') {
    showOverviewGroupPopover(overviewGroupFolder(group), anchor);
    return;
  }
  const project = findTreeProject(group.projectId);
  if (project) showContextMenu(newSessionItems(project), { anchor });
}

/** The ⋯ of a group (and its right click). `anchor` is the ⋯, which the popovers its items open hang from. */
function overviewGroupMenuItems(group, anchor) {
  if (!overviewGroupHasActions(group)) return [];
  if (group.kind === 'project') {
    const project = findTreeProject(group.projectId);
    return project ? projectMenuItems(project) : [];
  }
  const path = group.path;
  const folder = overviewGroupFolder(group);
  const tasksRunning = typeof runningTaskCount === 'function' ? runningTaskCount(folder) : 0;
  const schedules = schedulesForFolder(path);
  const items = [
    { label: 'New session…', icon: PICONS.plus(14), onClick: () => showOverviewGroupPopover(folder, anchor) },
    {
      label: folder.hasTaskFile || folder.taskError ? 'Run project task' : 'Set up project tasks',
      icon: PICONS.play(14),
      hint: tasksRunning ? `${tasksRunning} running` : '',
      onClick: () => showTaskPopover(folder, anchor),
    },
    // As the Sessions list's clock: none yet goes straight to the dialog.
    schedules.length
      ? { label: 'Scheduled tasks', icon: PICONS.clock(14), hint: String(schedules.length), submenu: scheduleMenuItems(schedules, { cwd: path }) }
      : { label: 'New scheduled task…', icon: PICONS.clock(14), onClick: () => showScheduleDialog({ cwd: path }) },
    { label: 'Folder settings', icon: ICONS.gear(14), onClick: () => openSettingsViewer('project', path) },
    { sep: true },
    { label: 'Archive all sessions…', icon: ICONS.archive(14), onClick: () => archiveFolderSessions(path) },
  ];
  if (OV_WORKTREE_PATH.test(path)) items.push({ label: 'Hide worktree', icon: PICONS.x(14), onClick: () => hideWorktree(path) });
  return items;
}

/** Give a group's header its + and ⋯ (once), shown for the groups that have them. */
function decorateOverviewGroupHeader(header, group) {
  ovGroupOfHeader.set(header, group);
  let actions = header.querySelector('.ov-group-actions');
  if (!actions) {
    const groupNow = () => ovGroupOfHeader.get(header);
    actions = document.createElement('span');
    actions.className = 'ov-group-actions';
    const add = overviewHeaderButton('ov-group-btn ov-group-new', 'New session', PICONS.plus(12), button => overviewGroupNew(groupNow(), button));
    const more = overviewHeaderButton('ov-group-btn ov-group-more', 'More', PICONS.dots(12), button => {
      showContextMenu(overviewGroupMenuItems(groupNow(), button), { anchor: button });
    });
    actions.append(add, more);
    header.appendChild(actions);
    header.addEventListener('contextmenu', e => {
      const items = overviewGroupMenuItems(groupNow(), more);
      if (!items.length) return;
      e.preventDefault();
      showContextMenu(items, { x: e.clientX, y: e.clientY });
    });
  }
  actions.hidden = !overviewGroupHasActions(group);
}
