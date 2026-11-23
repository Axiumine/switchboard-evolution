# Switchboard Evolution interface parity list

This is the acceptance checklist for the React rewrite of the desktop renderer (`apps/desktop/public/*.js`, `index.html`, `style.css`). The main-process logic (`main.js`, `projects.js`, `git-*.js`, `remote-*.js` and the other root-level modules) stays. Before the new UI replaces the current one, every line below must work again. A line is done when a person can do what it says in the new UI, not when the old file is deleted.

The desktop app is a copy of the `master` branch of the Switchboard fork (upstream `main` plus the owner's own features), at app version 1.6.5, plus what 1.6.6 brought over from Switchboard master and switchboard-mobile (file-type icons, search and replace in the Files tab, Git staging; tagged (master) below). The mobile app (`apps/mobile`) is the companion over the remote-access API and is listed at the end, because the desktop must keep serving it.

## How to read it

- Each line is `- [ ] <what the user can do> — \`file.js\` (key function or DOM id)`. Tick the box when the line works in the new UI.
- `(master)` after the description: the feature exists only on `master`, not in upstream `main`. It was decided with `git diff main master`, `git show main:<path>` and `git grep <term> main` in the Switchboard checkout.
- `(master?)`: probably master only, but the check was not conclusive (see the open questions).
- No tag: the feature is on upstream `main` too. It may still differ in detail on master.
- File names are the current renderer files (relative to `apps/desktop/public/` unless they start at the root, like `main.js`). The function or id is where to start reading, not an API to keep.
- "Main process" lines name the IPC channel that must keep working. The full channel list is in the IPC section.
- Mobile lines have no tag: the mobile app is all the owner's.

---

# Desktop

## 1. Window shell and sidebar tab bar

- [ ] The window opens at its last size and position, falls back to a default when that position is off every screen, and never gets smaller than 800 by 500 — `main.js` (`createWindow`, setting `global.windowBounds`, saved on move and resize)
- [ ] The window title is the app's name (Switchboard Evolution) instead of the page title when the build has its own name (master) — `main.js` (`page-title-updated`)
- [ ] Cmd+R and Ctrl+Shift+R do not reload the page, while plain Ctrl+R still reaches the terminal for reverse search — `main.js` (`before-input-event`)
- [ ] Links clicked in the window, and `window.open` calls from terminal links, open in the system browser, never in a child window — `main.js` (`setWindowOpenHandler`, `will-navigate`, injected `window.open`)
- [ ] A second launch focuses the running instance instead of opening another — `main.js` (`requestSingleInstanceLock`, `second-instance`)
- [ ] The app menu has About, Hide, Hide Others, Unhide, Quit; an Edit menu (undo, redo, cut, copy, paste, select all); a View menu (dev tools, zoom reset/in/out, full screen) — `main.js` (`buildMenu`)
- [ ] "Quit and Stop All Sessions…" asks for confirmation and stops every running session before quitting; a plain Quit leaves herdr-core sessions running (master) — `main.js` (`quitStoppingSessions`)
- [ ] With remote access on, closing the window on macOS only hides it, and the sessions keep running (master) — `window-lifecycle.js` (`keepWindowOnClose`), event `window-visibility`
- [ ] Closing the main window closes the tool and project windows too, and stops sessions that are not in herdr-core (master) — `main.js` (`mainWindow.on('closed')`)
- [ ] The sidebar header shows one strip of icon tabs: Projects, Sessions, Plans, Files, Stats, Task Manager, Global settings; on upstream Plans, Agent Files and Stats sit behind a "More" button, and Files is called Agent Files (master) — `index.html` (`#sidebar-tabs`, `.sidebar-tab[data-tab]`)
- [ ] Clicking a tab switches the sidebar content (Sessions, Projects, Plans, Files, Stats list) and clears the search box — `app.js` (tab click handler, `activeTab`)
- [ ] The app reopens on the last of Sessions or Projects (other tabs are not remembered) — `app.js` (`rememberedTab`, `localStorage.lastTab`)
- [ ] Each tab shows a tooltip with its name; the Stats and Task Manager tooltips hold a pop-out button, and the pointer can travel from the tab onto the tooltip (master) — `sidebar-tips.js` (`data-tip`, `data-window`)
- [ ] The Task Manager and Global settings tabs light up while their page is on screen, however it was closed (master) — `app.js` (`lightWhileShown`)
- [ ] The Task Manager tab opens the Task Manager page in the main area, the gear tab opens Global settings (master) — `app.js` (`#task-manager-tab`, `#global-settings-btn`)
- [ ] A phone button in the strip opens the Mobile app access dialog and shows `connected/paired` when access is on (master) — `remote-access.js` (`#remote-access-devices-btn`, `.remote-access-count`)
- [ ] A dot on the expand button shows remote access is on while the sidebar is collapsed (master) — `remote-access.js` (`.remote-access-dot`)
- [ ] The sidebar collapses and expands with its two buttons — `app.js` (`#sidebar-collapse-btn`, `#sidebar-expand-btn`)
- [ ] Dragging the divider resizes the sidebar between 344 and 600 px (never narrower than the tab strip) and the width is saved — `app.js` (`#sidebar-resize-handle`, `SIDEBAR_MIN_WIDTH`, setting `global.sidebarWidth`)
- [ ] The main area shows exactly one page at a time (placeholder, terminal area, grid, plan viewer, Files tab's editor, stats, settings, Task Manager, transcript, project page) and opening one hides the others — `plans-memory-view.js` (`hideAllViewers`), `app.js`
- [ ] With nothing selected the main area says "Select a session from the sidebar to begin." — `index.html` (`#placeholder`)
- [ ] The sidebar list refreshes by itself when session files change on disk, debounced, and not while another tab is showing — `app.js` (`onProjectsChanged`, `loadProjects`)
- [ ] The window lays out in a project-window mode (no sidebar, no terminals) when opened with `?projectWindow=` (master) — `project-window.js` (`PROJECT_WINDOW`, `body.project-window`)

## 2. Projects tab: list, search, groups and drawer

- [ ] A "New project" button at the top of the list opens the New project dialog — `projects-view.js` (`#proj-new-btn`, `showNewProjectDialog`)
- [ ] Projects are listed under "Active", then a collapsible "Snoozed · n" shelf (ordered by wake time), then a collapsible "Done · n" — `projects-view.js` (`renderProjectList`, `#proj-sec-snoozed`, `#proj-sec-done`)
- [ ] Each project row shows a coloured initials mark, its name, a state dot (needs you, working, finished and not read, open, back from snooze), a running-task indicator and a running-session count — `projects-view.js` (`buildProjectRow`, `projectDotState`, `updateProjectTaskIndicator`)
- [ ] Each row's second line shows the numbers for plan (done/total), todos (open/total), tracks and sessions (master) — `projects-view.js` (`projectRowStats`, `projectSublineHtml`)
- [ ] Clicking a row opens the project page on its remembered tab — `projects-view.js` (`selectProject`)
- [ ] The chevron before a row opens a drawer under it with the project's sessions, and the drawer stays open across window reloads (master) — `projects-view.js` (`toggleProjectDrawer`, `buildProjectDrawer`, `projectsUi.expandedProjects`)
- [ ] The drawer groups sessions by Time (Now, Today, Yesterday, Earlier this week, Earlier this month, Older), Track or State (Needs input, Running, Idle), chosen with a combo beside the search box that applies to every project (master) — `projects-view.js` (`groupSessions`, `setSessionGroupMode`, `#projects-group-select`)
- [ ] A drawer group shows its first few sessions with "+ n older" or "+ n more" to expand the rest; Track view groups have a + to start a session in that track — `projects-view.js` (`buildSessionPaneList`, `PANE_GROUP_LIMIT`)
- [ ] The drawer has a + for a new session on its first line, and an archived section per project, closed until asked for (master) — `projects-view.js` (`pdrawer-new`, `buildArchivedSection`)
- [ ] A drawer row shows its track tag (or "Formerly: <track>" for a deleted track), schedule chip, CLI mark, time and message count, and an archive/unarchive or dismiss button on hover — `projects-view.js` (`buildSessionRow`)
- [ ] Clicking a session in a drawer opens it on the project's Session tab (master) — `projects-view.js` (`openSession`, `enterWorking`, `projectTabSession`)
- [ ] Cmd+Arrow and Cmd+Shift+[ ] walk the drawer's rows in the order shown (master) — `grid-view.js` (`sessionNavRows`), `projects-view.js` (`projectsTabNavRows`)
- [ ] A "No project · n" row at the foot lists sessions no project claims, grouped by folder, folders open or closed, stale folders folded (master) — `projects-view.js` (`sessionsWithoutProject`, `buildOtherSessionsDrawer`, `#proj-sec-other`)
- [ ] Right-click on a project opens its menu: Open overview, New session (CLI submenu), New track…, Rename…, Attach folder…, New scheduled task…, Settings, Open project folder, Snooze (presets and Pick a time…), Wake now, Snooze again, Stop all, Mark as done / Reopen project, Remove project… — `projects-view.js` (`projectMenuItems`, `snoozeMenuItems`, `stopAllMenuItems`)
- [ ] A snoozed project hides from Active until its wake time, comes back marked "back from snooze", and comes back at once when a session in it needs input; a project that needs input cannot be snoozed — `snooze.js` (shared), `projects-view.js` (`isProjectSnoozed`, `armProjectWakeTimer`, `snoozeProject`)
- [ ] Marking a project done or removing it first lists running sessions, tasks, schedules and worktrees and asks what to do about them — `projects-view.js` (`confirmMarkDone`, `confirmStopWork`, `removeProjectFlow`)
- [ ] Remove project… asks for the word delete to be typed (any case) before the Remove button works — `projects-view.js` (`confirmRemoveProject`, `isRemoveProjectWord`)
- [ ] Searching in the Projects tab finds projects by name and lists each matching session under its project row, in or out of a project (master) — `projects-view.js` (`projectSearchResults`, `buildSearchSessionRow`), `search-results.js`
- [ ] Each found project row and session row has an X that leaves it out of this search (master) — `projects-view.js` (`.proj-exclude-btn`, `.proj-search-exclude`), `app.js` (`leaveOutOfSearch`)
- [ ] While searching, drawers with matches open by themselves, and a chevron click overrides that for the length of the search (master) — `projects-view.js` (`searchDrawerOverride`)
- [ ] The empty list says "No projects yet…" or "No project matches." — `projects-view.js` (`#projects-empty`)
- [ ] A task-run indicator and the schedule clock appear on rows and headers that have running tasks or schedules — `projects-view.js` (`updateProjectTaskIndicators`), `schedules.js` (`decorateScheduleButton`)

## 3. New project dialog and project page header

- [ ] The New project dialog takes a name (placeholder "Website redesign"), a "Works in" list of folders (Add folder opens the folder browser), shows a live "What you get" preview, and creates the project — `projects-view.js` (`showNewProjectDialog`, `#np-name`, `#np-preview`)
- [ ] For each folder that is a git repository the dialog asks "In place or new worktree" and shows what will be created before it creates anything — `projects-view.js` (`askRepoMode`, `#np-folders`)
- [ ] When any folder works as a worktree, the dialog offers one worktree branch name (default from the project name), a "Same branch in every repo" switch, and tickable environment files (.env etc.) to copy into each new worktree, with Select all / Select none — `projects-view.js` (`#np-branch-name`, `#np-shared-branch`, `np-env-file`), `main.js` (`list-env-files`)
- [ ] "Create project" stays disabled until each repository has a mode, and shows "Creating worktrees…" while it runs; errors show in the dialog — `projects-view.js` (`createBtn`, `#np-error`)
- [ ] A new project is created in the projects folder from a template (one folder per template with `template.json`) — `projects.js` (`createProject`), `templates/`, `main.js` (`create-project`, `list-templates`)
- [ ] The project page header shows the mark, the name, a status chip (Snoozed, done) and state dot, one chip per attached folder (branch, mode, dirty marker) and a "+ folder" chip — `projects-view.js` (`renderOverview`, `folderChipHtml`, `#ws-add-folder`)
- [ ] The header has Tasks (the project's runnable tasks), Schedules, "New session" (CLI menu) and a ⋯ project menu — `projects-view.js` (`#ws-tasks`, `#ws-schedules`, `#ws-new`, `#ws-more`)
- [ ] The tab strip is Overview, Plan with a done/total count, Todos with the open count, Files, Git, Settings (the Session tab, shown only while a session is open in the project, is in section 5) — `projects-view.js` (`PROJECT_WORKSPACE_TABS`, `.ws-tab`, `#ws-tab-plan-meta`, `#ws-tab-todos-meta`)
- [ ] Overview, Plan, Todos, Files, Git and Settings each have a button beside the tab that opens that tab in a window of its own (master) — `projects-view.js` (`tabWithWindow`, `.ws-tab-window`)
- [ ] Choosing a folder to attach asks for in place or worktree (and a branch name when the project uses its own branch per repo), then attaches — `projects-view.js` (`attachFolderAsk`, `attachFolderFlow`, `askRepoMode`)
- [ ] Detaching a folder explains what stays on disk, offers to remove a worktree checkout and to force it, then detaches (master) — `projects-view.js` (`confirmDetachFolder`, `detachFolderFlow`)

## 4. Project page: Overview tab

- [ ] A "Tracks" column shows a card for General (sessions not in a track) and one per track; finished tracks go last and collapse to their heading until clicked — `projects-view.js` (`renderOverviewBody`, `buildTrackCard`, `doneCardsOpen`)
- [ ] A track card shows the state dot, name, start folder, CLI mark, a "New session" button and a ⋯ track menu — `projects-view.js` (`buildTrackCard`, `.tcard-new`, `.tcard-more`)
- [ ] A track card lists its sessions up to the visible-session limit, hover shows the last assistant message as a preview, and "+ n more" opens the full list in the sidebar drawer (master) — `projects-view.js` (`buildCardSessionRow`, `showSessionHoverPreview`, `showTrackInDrawer`)
- [ ] A track card has an "n archived" toggle that lists its archived sessions — `projects-view.js` (`tcard-archived`, `projectsUi.archivedOpen`)
- [ ] "New track" in the Tracks heading asks for a name and creates it — `projects-view.js` (`#ws-new-track`, `promptNewTrack`)
- [ ] The track menu (also on right-click): Resume latest, New session, New scheduled task…, Show all sessions, Rename…, Sessions start in (folder), CLI (ask, Claude, Codex, OpenCode), Mark as done / Reopen, Delete track… (which asks what to do with its sessions) — `projects-view.js` (`trackMenuItems`, `deleteTrackFlow`)
- [ ] A "Plan" card shows the progress bar, "n of m phases", the next phase, and opens plan.md or plan-tracker.md in the editor; without a tracker it says how to get one — `projects-view.js` (`renderSideCards`, `#ws-plan-open`, `#ws-plan-tracker`)
- [ ] A "Todos" card lists up to eight open todos with a checkbox to tick, double-click to edit in place, a Start button (session with the todo as first prompt), a "+ add" input, and a link to todos.md — `projects-view.js` (`renderSideCards`, `toggleFileLine`, `editItemInline`, `appendTodo`, `showStartItemMenu`)
- [ ] A "Recent Files" card lists recently added files of the project folder, opens one in the Files editor, and "All" jumps to the Files tab — `projects-view.js` (`loadRecentFiles`, `recentFilesHtml`, `#ws-recent-files-all`), `main.js` (`list-recent-project-files`)
- [ ] An "Attached Folders" card lists folders with mode text, an X to detach each (master) and a "+" to attach — `projects-view.js` (`renderSideCards`, `.ws-frow-x`, `#ws-folders-add`)
- [ ] An "Added Files" card accepts files dropped on it, copies them into `added-files/` in the project folder, lists them, and opens that folder — `projects-view.js` (`bindAddedFilesCard`, `#ws-added-files-drop`), `main.js` (`add-project-files`)
- [ ] The hint "Start a session from the header…" shows when a project has no tracks and no sessions — `projects-view.js` (`.ws-hint`)
- [ ] Project data is re-read when the project's files change on disk or a session ticks a plan item (event `project-plan-changed`) — `projects.js` (`initPlanWatch`), `preload.js` (`onProjectPlanChanged`)

## 5. Project page: Session tab (master)

- [ ] Opening a session from a project keeps the project header and tabs and shows the terminal under them on the Session tab (master) — `projects-view.js` (`enterWorking`, `leaveWorking`, `syncWorkingHeaderHeight`)
- [ ] The Session tab can hold a session's terminal, its transcript, or a task's log (master) — `projects-view.js` (`onSessionShown`, `onMessagesShown`, `onTaskLogShown`)
- [ ] Leaving the tab and coming back restores the same session; the Session tab shows a state dot (master) — `projects-view.js` (`rememberProjectSession`, `sessionTabState`)
- [ ] Session ids re-key correctly when a pending session gets its real id or a session is forked (master) — `projects-view.js` (`rekeyProjectSessionState`), `app.js` (`onSessionDetected`, `onSessionForked`)

## 6. Project page: Plan and Todos tabs

- [ ] The Plan tab shows phases from plan-tracker.md with their items, tick state, `n/m` counts and a "next" marker; the Todos tab shows the todos from todos.md — `projects-view.js` (`renderPlanTab`, `renderPhasesBody`, `renderTodosBody`, `buildPhaseRow`, `buildTodoRow`)
- [ ] Ticking a phase, an item or a todo writes the file; double-click edits the text in place (Enter saves, Escape cancels) — `projects-view.js` (`toggleFileLine`, `editItemInline`), `main.js` (`set-plan-item`, `edit-plan-item`)
- [ ] "Add a todo" and adding to the plan append a line — `projects-view.js` (`appendTodo`), `main.js` (`append-plan-item`)
- [ ] "Start" on a phase, an item or a todo opens a menu (Claude, Codex, OpenCode, or in a track) that starts a session with the item as its first prompt and links the session to it — `projects-view.js` (`showStartItemMenu`, `phasePrompt`, `todoPrompt`, `startItemRows`)
- [ ] An item shows "n sessions" linked to it (started or ticked by); a click opens the session or lists them — `projects-view.js` (`linkedBadge`), `main.js` (`get-project-plan`, table `plan_links`)
- [ ] Buttons open plan.md ("the plan as written") and plan-tracker.md ("the phases Switchboard reads") from the Plan tab, and todos.md from the Todos tab, in the editor; a toggle shows or hides the done todos — `projects-view.js` (`#plan-open-plan`, `#plan-open-tracker`, `#plan-open-todos`, `#plan-todo-done`, `planState.showDone`)
- [ ] A plan from Claude's plans folder can be adopted into a project as plan.md (replace asked when one exists) — `plans-memory-view.js` (`adoptPlanInto`), `main.js` (`adopt-plan`)

## 7. Project page: Files tab

- [ ] The Files tab has one tab for the project folder and one for each attached folder (master), each a tree beside an editor — `project-files-view.js` (`.ws-files-root` tabs, `roots`)
- [ ] The tree lists folders lazily, shows viewable and unviewable files, and has a refresh button and an "Open folder" button — `project-files-view.js` (`#ws-files-refresh`, `#ws-files-open`), `main.js` (`list-project-directory`)
- [ ] The explorer toolbar adds New File…, New Folder… and Collapse Folders buttons (master) — `project-files-view.js` (`ws-files-action`, `data-act="new-file"`, `"new-folder"`, `"collapse"`)
- [ ] Clicking a file opens it in the editor or preview (Markdown, HTML, JSON as a tree, images, PDF, PowerPoint); a file with no preview opens in its default app — `project-files-view.js` (`openFileInProjectEditor`), `file-actions.js` (`openUnsupportedFile`), `viewer-panel.js`
- [ ] The editor edits and saves files (Cmd+S) with unsaved edits surviving re-renders; CLAUDE.md and AGENTS.md of the project save through the brief so both files and worktree copies stay in step — `project-files-view.js`, `main.js` (`save-project-brief`, `read-project-file`)
- [ ] The tree/editor divider is draggable and keyboard resizable, and its width is remembered — `project-files-view.js` (`.ws-files-divider`)
- [ ] Right-click or the context-menu key on an entry: Open to the Side, Open With… (Switchboard Editor, Default Application, recent apps, Other Application…), Reveal in Finder, Open in Integrated Terminal, Select for Compare / Compare with Selected, Open Timeline, Cut, Copy, Paste, Copy Path, Copy Relative Path, Rename…, Delete, Duplicate, New File…, New Folder… (master) — `project-files-view.js` (`explorerMenuItems`)
- [ ] "Add file to Chat" and "Add file to New Chat" (Claude, Codex or OpenCode) put the file's path into a running or new session (master) — `project-files-view.js` (`addFileToChat`, `addFileToNewChat`)
- [ ] The explorer has VS Code style shortcuts on a focused row: Enter or F2 renames, Delete or Cmd+Backspace trashes, Cmd/Ctrl+X, C, V cut, copy, paste, Cmd+Alt+C copies the path, Cmd+Alt+R reveals, Ctrl+Enter opens to the side, arrows move and fold (master) — `project-files-view.js` (`onExplorerKey`)
- [ ] Rename, move to Trash and reveal work on files and folders, and open diffs or editors follow a rename or move — `file-actions.js` (`remapFileActionPath`), `project-files-view.js` (`explorerManage`), `main.js` (`manage-project-entry`)
- [ ] New file or folder accepts a path with slashes; duplicate and paste (copy or move) work within and across roots — `project-files-view.js` (`explorerNewEntry`, `explorerDuplicate`, `explorerPaste`), `main.js` (`create-project-entry`, `duplicate-project-entry`, `paste-project-entry`) (master)
- [ ] "Open Timeline" lists the commits that changed a file (with an "uncommitted" row), and each change opens a diff or the file at that version; the row menu has Open Changes, Open File at This Version, Show in Git Graph, Copy Commit ID, Copy Commit Message (master) — `project-files-view.js` (`openTimeline`, `openTimelineChange`, `openTimelineVersion`), `file-timeline.js`, `main.js` (`get-file-timeline`, `get-file-timeline-diff`, `get-file-at-commit`)
- [ ] "Select for Compare" then "Compare with Selected" shows a diff of two files in place of the editor (master) — `project-files-view.js` (`compareProjectFiles`, `filesCompareSource`)
- [ ] "Open to the Side" keeps a second editor beside the first (master) — `project-files-view.js` (`projectSideEditor`, `openFileToSide`)
- [ ] The viewer toolbar has Preview toggle, Wrap, Go to line (Cmd+G), Save, Copy path, Copy content, Open in default app, Close — `viewer-toolbar.js`, `viewer-panel.js`, `codemirror-setup.js`
- [ ] The viewer toolbar has Share (macOS share menu) and Reveal in Finder/Explorer buttons (master) — `viewer-toolbar.js` (`shareBtn`, `revealBtn`), `main.js` (`share-file`, `reveal-file`)
- [ ] Files and folders in the tree show file-type icons (Material Icon Theme) (master) — `file-icons.js`, `file-icon-theme.js`, `scripts/build-file-icons.mjs`
- [ ] A Search view in the Files tab finds text across the project (case, whole word, regular expression, include and exclude globs), lists matches by file, and opens a match at its line (master) — `project-files-search.js`, `text-search.js`, `project-search.js`, `workers/search-files.js`, `main.js` (`search-project-files`)
- [ ] The Search view replaces matches in one file or all files, with a preview, and keeps edits open in an editor safe (master) — `project-files-search.js`, `main.js` (`replace-in-project-files`)
- [ ] The editor has find and replace (Cmd+F, Cmd+Alt+F) with case, word and regular-expression options (master) — `codemirror-setup.js`
- [ ] The viewer reloads a file changed outside the editor and previews JSON/JSONC as a collapsible tree, Markdown, HTML, PDF, images and PowerPoint (`pptx-preview`) — `viewer-panel.js` (`watch-file`), `json-reader.js`, `pptx-preview.js`

## 8. Project page: Git tab, Changes

- [ ] The Git tab has a switch Changes | History | Worktrees | Pull Requests (master adds Worktrees and Pull Requests) and fills the whole width; Changes, History and Pull Requests share the chosen repository — `project-git-view.js` (`GIT_WORKSPACE_VIEWS`, `renderProjectGitWorkspace`, `setProjectGitView`)
- [ ] With several attached repositories a picker chooses one; a folder that is not a repository says so — `project-git-view.js` (`.git-repo-picker`, `paintGitRepository`)
- [ ] Changes shows the branch (or detached head), clean or "n changed files", ahead/behind, insertions and deletions, warnings, and the latest commit — `project-git-view.js` (`gitOverviewHtml`)
- [ ] The changed-file list can be a flat list or a tree (choice remembered); clicking a file shows its unified diff, with "Read only" labelling the tab — `project-git-view.js` (`gitViewToggleHtml`, `paintGitDiff`, `getProjectGitDiff`)
- [ ] Changed files are split into Staged and Unstaged; a file, a folder or all files can be staged or unstaged, and the diff shows the staged or unstaged side (master) — `project-git-view.js`, `main.js` (`stage-project-git-files`, `get-project-git-diff`)
- [ ] In a diff, single hunks or selected lines can be staged or unstaged; a diff that changed meanwhile is refused and reloaded (master) — `project-git-view.js`, `git-diff-model.js`, `git.js`, `main.js` (`stage-project-git-lines`)
- [ ] The Git lists show file-type icons like the Files tree (master) — `project-git-view.js`, `file-icons.js`
- [ ] The user's `color.ui` git setting never garbles the diff (master) — `git.js` (diff invocation), `main.js` (`get-project-git-diff`)

## 9. Project page: Git tab, History (Git Graph)

Upstream `main` has the read-only graph. Everything that changes a repository is master.

- [ ] History draws the commit graph with lane colours, a Graph / Description / Date / Author / Commit table, ref labels (branch, remote branch, tag, stash, HEAD), an uncommitted-changes row, and loads more commits on demand — `project-git-graph-view.js`, `git-graph-render.js`, `git-graph-layout.js`, `main.js` (`get-project-git-graph`)
- [ ] Columns can be resized and hidden from the header's right-click menu — `project-git-graph-view.js` (`gitGraphWireHeader`, `GG_COLUMNS`)
- [ ] A repository picker, a Branches dropdown (Branches and Tags tabs, filter, sort A→Z, Select All / Deselect All / Invert Selection) and Find (case option, "also open details") narrow what is drawn — `project-git-graph-view.js` (`gg-branches-*`, `#gg-find-btn`)
- [ ] The toolbar has Find, Repository Settings (master), Fetch from Remote(s) (master), Refresh, and "Open a Terminal for this Repository" (master) — `project-git-graph-view.js` (`#gg-settings-btn`, `#gg-fetch-btn`, `#gg-refresh-btn`, `#gg-terminal-btn`)
- [ ] Clicking a commit opens its details: hash, author, committer, date, parents, message, and the changed files as tree or list; Ctrl/Cmd+click a second commit compares them — `project-git-graph-view.js` (`gitGraphOpenDetails`, `gitGraphDetailsBodyHtml`), `main.js` (`get-git-graph-commit-detail`, `get-git-graph-compare-detail`)
- [ ] The commit details open under the clicked row or beside the graph (a setting), and re-centre when opened (master) — `project-git-graph-view.js` (`gitGraphMaybeAutoCenterDetails`), `git-graph-settings.js` (details location, auto-center)
- [ ] Details of a commit render issue links and Markdown in the message, and "Show signature status" (master) — `project-git-graph-view.js` (`gitGraphLinkifySubject`, `gitGraphLinkifyBody`)
- [ ] Details file rows: View Diff, View File at this Revision, View Diff with Working File (master), Open File (master), Mark as (Not) Reviewed with a code-review mode (master), Reset File to this Revision… (master), Copy Absolute/Relative File Path — `git-graph-menus.js` (file menu), `main.js` (`get-git-graph-file-diff-between`, `get-git-graph-file-at-revision`)
- [ ] Up and Down arrows move the selection through details; Escape closes find or details; Cmd/Ctrl+F finds; Cmd/Ctrl+H scrolls to HEAD (master); Cmd/Ctrl+S and Shift+S jump between stashes (master) — `project-git-graph-view.js` (`state.keydownHandler`)
- [ ] Double-click a commit opens "Checkout commit…", double-click a branch label checks the branch out (master) — `project-git-graph-view.js` (`gitGraphHandleDoubleClick`)
- [ ] Commit context menu: Add Tag…, Create Branch…, Checkout…, Cherry Pick…, Revert…, Drop…, Merge into current branch…, Rebase current branch on this Commit…, Reset current branch to this Commit…, Copy Commit Hash, Copy Commit Subject (the two copies are upstream) (master) — `git-graph-menus.js` (`gitGraphBuildCommitMenu`), `git-actions.js`
- [ ] Uncommitted row menu: Stash uncommitted changes…, Reset uncommitted changes…, Clean untracked files…, Open Source Control View (master) — `git-graph-menus.js`
- [ ] Local branch menu: Checkout, Rename…, Delete…, Merge…, Rebase…, Push Branch…, View Issue, Create Pull Request…, Create Archive, Select/Unselect in Branches Dropdown, Copy Branch Name (the copy is upstream) (master) — `git-graph-menus.js`
- [ ] Remote branch menu: Checkout…, Delete Remote Branch…, Fetch into local branch…, Merge…, Pull into current branch…, View Issue, Create Pull Request, Create Archive, Copy Branch Name (master) — `git-graph-menus.js`
- [ ] Tag menu: View Details (annotated), Delete Tag…, Push Tag…, Create Archive, Copy Tag Name (the copy is upstream) (master) — `git-graph-menus.js`, `main.js` (`get-git-graph-tag-details`)
- [ ] Stash menu: Apply…, Create Branch from Stash…, Pop…, Drop…, Copy Stash Name, Copy Stash Hash (master) — `git-graph-menus.js`
- [ ] Every action opens a dialog with the same options as VS Code Git Graph (for example rebase has "Launch Interactive Rebase in new Terminal", merge has squash and no-commit) and runs through one whitelisted dispatcher with a progress bar and Cancel (master) — `git-graph-dialogs.js` (`gitGraphOpenDialog`, 35 `gitGraphShow*Dialog` functions), `git-actions.js` (`ACTIONS`, 35 actions), `main.js` (`run-git-graph-action`, `cancel-git-graph-action`)
- [ ] Create Archive asks where to save through the native Save dialog (zip or tar) (master) — `main.js` (`save-git-graph-archive`)
- [ ] Remotes: add, edit and delete remotes, fetch one or all remotes, with optional prune (master) — `git-graph-dialogs.js` (`gitGraphShowAddRemoteDialog`, `...EditRemote...`, `...DeleteRemote...`, `...FetchRemote...`), `main.js` (`get-git-graph-remotes`)
- [ ] User Details dialog sets the repository's and the global git name and email (master) — `git-graph-dialogs.js` (`gitGraphShowUserDetailsDialog`), `main.js` (`get-git-graph-user-details`)
- [ ] Repository settings: custom display name; show remote branches, remote HEAD refs, stashes, tags, tag-only commits, uncommitted changes, untracked files; reflogs; first parent; mute non-ancestors and merges; commit order; sign commits and tags; on-open behaviour; fetch prune and avatars; issue linking and pull-request provider dialogs; export as JSON; trust prompt for a repo's own config file (master) — `git-graph-settings.js`, `git-graph-dialogs.js` (`gitGraphShowIssueLinkingDialog`, `gitGraphShowPullRequestConfigDialog`, `gitGraphShowTrustRepoConfigDialog`), `main.js` (`get-git-graph-repo-config`, `set-git-graph-repo-config`, `trust-git-graph-repo-config`, `export-git-graph-repo-config`)
- [ ] Global preferences: date format and type, graph style, uncommitted marker style, lane colours, columns, ref label alignment and combining, Markdown in messages, enhanced accessibility letters, details location, auto-centre, file list layout, compact folders, initial commit count, auto load more, fetch avatars by default, repository dropdown order (master) — `git-graph-settings.js`, `main.js` (`get-git-graph-global-preferences`, `set-git-graph-global-preferences`)
- [ ] Author avatars load through an SSRF-safe cache (Gravatar and host-specific providers), a self-hosted GitLab host needs a native confirmation naming the host, and the cache can be cleared (master?) — `git-graph-avatars.js`, `main.js` (`get-git-graph-avatar-url`, `confirm-git-graph-avatars-gitlab-host`, `clear-git-graph-avatar-cache`)
- [ ] The graph updates when a repository changes on disk or a phone ran an action (events `git-graph-repo-changed`, `git-graph-action-progress`) (master) — `preload.js` (`onGitGraphRepoChanged`, `onGitGraphActionProgress`), `broadcast.js`
- [ ] "Show in the Git Graph" links from the Files Timeline and the Worktrees tab select a commit or a repository in History (master) — `project-files-view.js` (`showCommitInGitGraph`), `project-worktrees-view.js`

## 10. Project page: Git tab, Worktrees (master)

- [ ] The Worktrees view lists each repository with its worktrees: branch, kind badge, "In project", Detached, Locked, Missing, Changes/Clean, ahead/behind, last commit time, running-session count (master) — `project-worktrees-view.js` (`renderProjectWorktreesTab`, `wtBadgesHtml`), `worktrees.js`, `main.js` (`get-project-worktrees`)
- [ ] A search box and a sort combo narrow and order the list, repositories fold, and a summary line counts them (master) — `project-worktrees-view.js` (`WT_SORT_ORDERS`, `wtSummaryText`)
- [ ] "New worktree" asks for repository, check out (new branch, existing branch, remote branch, detached), branch name, start point, folder (Choose…), local files to copy (with patterns), and "then open" (nothing, terminal, Claude, Codex) (master) — `project-worktrees-view.js` (`wtCreateDialog`), `main.js` (`worktree-create`, `suggest-worktree-path`, `list-worktree-branches`, `list-env-files`)
- [ ] The post-create setup command runs in the new worktree and its output shows in the page; a failure leaves the worktree and says so (master) — `main.js` (`worktree-run-post-create`), `project-worktrees-view.js` (`wtSetNotice`)
- [ ] A worktree's menu: New session (Claude, Codex, OpenCode, Terminal, or configure…), Open folder, Copy path, Show in the Git tab, Show in the Git Graph, Detach from or Attach to project, Lock…, Unlock, Move…, Repair, Remove… (master) — `project-worktrees-view.js` (`wtMenuItems`), `main.js` (`worktree-attach`, `worktree-detach`, `worktree-lock`, `worktree-unlock`, `worktree-move`, `worktree-repair`, `worktree-remove`)
- [ ] Remove… shows what runs before removing, can delete the branch too, and says when the branch stays (master) — `project-worktrees-view.js` (`wtRemoveDialog`), `main.js` (`worktree-remove`, `worktree-delete-branch`)
- [ ] "Remove merged…" lists worktrees whose branch is merged into a base, ticks which to remove and optionally deletes their branches (master) — `project-worktrees-view.js` (`wtMergedDialog`), `main.js` (`worktree-merged`)
- [ ] "Prune…" previews stale records, optionally detaches stale ones, then prunes; "Repair all" and "Repair a moved folder…" reconnect worktrees (master) — `project-worktrees-view.js` (`wtPruneDialog`, `wtRepair`, `wtRepairMoved`), `main.js` (`worktree-prune-preview`, `worktree-prune`)
- [ ] Worktree settings: folder template with `$BASE_PATH`, `$BASE_ROOT`, `$BASE_NAME`, `$REF_NAME`, `$INDEX`, `$PROJECT_ROOT`; copy patterns and ignores; command after creating; command before removing; what to open after creating (master) — `project-worktrees-view.js` (`wtSettingsDialog`), `main.js` (`get-worktree-settings`, `set-worktree-settings`)

## 10b. Project page: Git tab, Pull Requests (master)

- [ ] The Pull Requests view has one tab per repository, as History, and reads the pull requests of its GitHub remote through the GitHub CLI (`gh`): the one installed on the computer first, else the one in the app (`resources/bin`, from `scripts/after-pack-gh.js`); with more than one GitHub remote a Remote combo chooses which, remembered per repository — `project-pull-requests-view.js` (`renderProjectPullRequestsTab`, `prRemoteSelectHtml`), `pull-requests.js` (`resolveRepo`, `locateGh`), `main.js` (`get-pull-requests`)
- [ ] Every open pull request is listed, drafts too, newest first (by opening date), however many there are; each row shows its state, title, number, author, when, head → base, +/− and files, and badges for Draft, Conflicts, the review and the checks. The list asks GitHub only for what a row needs (the merge state and the counts come with one pull request's conversation), and a page GitHub gives up on (502, 504, a time-out) is asked again in pages of 50, then 25 (master) — `project-pull-requests-view.js` (`prRowHtml`, `prBadgesHtml`, `prMergeLists`), `pull-requests.js` (`listOpen`, `isGitHubTimeout`)
- [ ] The title is edited in place where GitHub lets the account change it: a pencil beside it (shown on hover and on an open row) turns it into a field and itself into Save; Enter saves, Escape puts it back, an empty title is refused, GitHub's refusal stays beside the field (master) — `project-pull-requests-view.js` (`prTitleEditHtml`, `prWireTitle`, `prSaveTitle`), `pull-request-edits.js` (kind `title`)
- [ ] A filter combo with Open, Draft, Closed and Merged (Open and Draft at first, at least one stays on, not saved); Closed and Merged join the list 10 at a time with "Load 10 more" and "N of M shown" (master) — `project-pull-requests-view.js` (`prOpenFilterMenu`, `prLoadPage`, `prFooterHtml`), `main.js` (`get-pull-requests-page`)
- [ ] An open row has four tabs with their counts, as GitHub's page: Conversation, Commits, Checks (a dot of the checks' state), Files changed; Conversation at first, then the last one chosen, remembered; Review changes at the right of an open one. Each tab reads its data when first shown (the conversation always, for the counts) and again after a minute, when the window comes back, after Refresh and after a change it touched; while the focus is in a field of the view nothing is painted again until it leaves, and every editor's draft stays (master) — `pull-request-detail-view.js` (`prdPaint`, `prdTabsHtml`, `prdLoad`, `prdEnsure`, `prFlushPending`), `pull-request-detail.js`, `main.js` (`get-pull-request-conversation`)
- [ ] Conversation: the description, then the timeline (comments, reviews with their decision, commits in a row grouped, events as sentences: renames, base changes, force pushes, labels, assignees, review requests, merge, close, reopen, draft, ready), "Load more"; GitHub's own HTML (bodyHTML) made safe with DOMPurify (http(s) and mailto links only, no scripts, frames, forms or inline styles; task lists shown, not ticked; links open in the browser). Each message: its author, role, when, "edited", its reactions (on and off, shown at once, taken back if GitHub refuses; + for the eight) and a ⋯ with Copy link, Quote reply, Edit, Hide (with a reason) or Unhide, Open on GitHub and Delete… (asked first), each where GitHub allows it. Review threads under their review: the file and line, the end of the diff hunk, the comments, Reply and Resolve or Unresolve; a resolved one starts closed. At the end, on an open one, a box with the checks, the review, conflicts and, when it is behind, Update with merge commit or with rebase; then a composer with Write and Preview (GitHub's own rendering), Cmd/Ctrl+Enter, Comment, Close with comment, Reopen with comment (master) — `pull-request-detail-view.js` (`prdConversationHtml`, `prdTimelineHtml`, `prdMessageHtml`, `prdThreadHtml`, `prdStatusBoxHtml`, `prdComposerHtml`, `prdMessageMenuItems`), `pull-request-markdown.js` (`prSafeHtml`, `prEditorHtml`, `prWireEditor`), `pull-request-edits.js`
- [ ] Beside the conversation (above it in a narrow window), the sidebar: Reviewers with the state of their latest review or "awaiting", Assignees, Labels in their colours; a gear where GitHub allows the change opens a filter with checkboxes from the repository's labels or assignable people, and closing it saves (reviewers as a whole set, team requests kept). Review changes: the text, then Comment, Approve or Request changes (the last two off on one's own pull request); a review left pending on GitHub is the one submitted (master) — `pull-request-detail-view.js` (`prdSidebarHtml`, `prdOpenSidePicker`, `prdReviewDialog`), `main.js` (`get-pull-request-candidates`, `edit-pull-request`)
- [ ] Commits by day, each with its check, author, when, its short hash (a click copies the full one) and its page on GitHub; a commit opens on its message and its files, as a tree or a list; GitHub lists at most 250 (master) — `pull-request-detail-view.js` (`prdCommitsHtml`, `prdPaintCommits`), `main.js` (`get-pull-request-commits`, `get-pull-request-commit-files`)
- [ ] Checks of the last commit, the latest of each (one commit can carry several runs of a workflow: a push, a reopen, a re-run), with a summary ("1 failing, 2 successful"), by workflow or app; each with its state, Required, its duration, Details (the browser); a finished GitHub Actions job also has Log (its end, at most about 2 MB, without colours or timestamps, groups, errors and warnings marked, opened at the bottom) and Re-run; each workflow with failures has Re-run failed jobs. While a check runs the tab is read again every 15 seconds (master) — `pull-request-detail-view.js` (`prdChecksHtml`, `prdLogHtml`, `prdPaintChecks`), `pull-request-detail.js` (`checks`, `jobLog`), `pull-request-edits.js` (kinds `rerun`, `rerun-job`)
- [ ] Files changed, as a tree at first (folders first, a chain of single folders on one row, a folder closes on a click) or as a list; every diff starts closed and a file opens its own. Four icons with tooltips: Expand all (every folder and diff), Collapse all (the diffs), View as tree, View as list, remembered for every pull request; binary and too large diffs say so. Each file has Viewed, as on GitHub ("N of M viewed"; a viewed file's diff closes; changed since viewed is marked) (master) — `project-pull-requests-view.js` (`prPaintFiles`, `prWireFiles`, `prFilesHtml`, `prFilesToolsHtml`, `prFileRows`), `main.js` (`get-pull-request-files`, `get-pull-request-viewed`)
- [ ] Before Merge, four icons with tooltips, on closed and merged pull requests too: Copy the address, Open here (a panel nearly as large as the window with the GitHub page in a `<webview>`: Back, Forward, Reload, the address, Copy, Open in a window, Open in the browser, Close; Escape closes it, a click outside does not), Open in a window of its own (the same page and toolbar with a pin; the same address brings its window forward; not opened again at the next start) and Open in the browser. The page has a session of its own (`persist:github-web`), so GitHub's sign-in stays from one start to the next; https only, no preload, a sandbox, links that ask for a new window go to the browser, a right click has Copy and Open in the browser (master) — `project-pull-requests-view.js` (`prLinkToolsHtml`, `prWireLinkTools`), `web-page-view.js` (`mountWebPage`, `openWebPagePanel`), `web-window.html`, `web-page.js` (`guardWebviewAttach`, `setupWebPages`), `main.js` (`openWebWindow`)
- [ ] Merge sits on an open row (off, with the reason, for a draft, conflicts, or an account that cannot write); its dialog offers the repository's merge methods and "Delete the branch after merging" (on GitHub only, never for a fork) and refuses when new commits arrived (master) — `project-pull-requests-view.js` (`prMergeBlock`, `prMergeDialog`), `pull-requests.js` (`actionArgs`), `main.js` (`run-pull-request-action`)
- [ ] The row's ⋯ has Convert to draft… or Ready for review…, Change base…, and Close pull request…; a closed one has Reopen pull request…; each asks first, with the focus on Cancel, and shows gh's error in the dialog when GitHub refuses. Change base lists the repository's branches (the default first, searched as one types, never the head or the current base) with GitHub's warning about the timeline (master) — `project-pull-requests-view.js` (`prRowMenuItems`, `prConfirmDialog`), `pull-request-detail-view.js` (`prChangeBaseDialog`, `prBaseChoices`), `main.js` (`get-pull-request-branches`)
- [ ] Without gh, signed out of GitHub, or without a GitHub remote the view says what to do, with Try again; the list is read again when shown after a minute, when the window comes back and after each action (master) — `project-pull-requests-view.js` (`prErrorHtml`, `prEnsureLoaded`)

## 10c. Project page: Node Knowledge tab (master)

- [ ] The tab sits after Git (and opens in a window of its own); its views are Overview, Search, Trace, Impact, Query, ADR, Coverage, Compare, Lens and Settings, with a folder picker for the project's attached folders — `project-knowledge-view.js` (`renderKnowledgeTab`, `knSubnavHtml`, `knViewRenderers`), `knowledge-model.js` (shared)
- [ ] Without codebase-memory-mcp it offers Download and install (the pinned release, checked against its checksums, installed by the new binary itself without agent configuration), Choose the program, Releases; an old one asks for an update; a folder without a graph asks to index it (Full, Moderate, Fast); a running job shows its state — `project-knowledge-view.js` (`knGateHtml`, `knSetupHtml`), `cbm-locator.js` (`locateCbm`, `downloadCbm`), `knowledge.js` (`status`, `index`, `downloadBinary`)
- [ ] Overview: each folder's card (nodes, links, when indexed, cross-repo links, files left out, Refresh) and the architecture (languages, packages, entry points, hotspots, routes, layers, boundaries, clusters, call cycles); a symbol opens in Files at its line — `renderKnowledgeOverview`, `knOpenInFiles`
- [ ] Search: Symbols (name, words, By meaning, kind, name regex, files) or Code (text or regex), paged; a symbol opens in a panel with its source, callers, callees and the outline of its file, Trace and Open in Files; an ambiguous name offers the candidates — `project-knowledge-explore.js` (`renderKnowledgeSearch`, `knOpenSymbolPanel`, `knRenderSymbol`)
- [ ] Trace: modes (calls, data flow, across services, topology, deploy, run), direction, tests; Graph (callers left, callees right, risk on each node's edge, + opens the next step, a node bar with Read code and Trace from here) or List by hop with the risk; Import runtime traces… from a JSON file — `renderKnowledgeTrace`, `knTraceGraphHtml`, `knExpandNode`, `main.js` (`knowledge-import-traces-file`)
- [ ] Impact: uncommitted changes, a branch against its base, or since a ref; Impact, Files only or Tests (experimental); steps and To the end; changed files, the symbols reached with the call they were reached by, the modules; Ask an agent… (CBM's change-review prompt) — `project-knowledge-analysis.js` (`renderKnowledgeImpact`, `knImpactArgs`), `project-knowledge-agents.js` (`knAskAgent`)
- [ ] Query: Cypher in an editor with Cypher highlighting, Code or Gaps, examples, saved queries (Save query, forget), the graph's kinds to insert, ⌘↵, results paged — `renderKnowledgeQuery`, `codemirror-setup.js` (`CODE_LANGUAGES`: Cypher)
- [ ] ADR: the folder's decision record in Markdown (DOMPurify), Start one from a template, Edit with a byte count (8,000) — `renderKnowledgeAdr`
- [ ] Coverage: Check files (paths), files read in part with their lines, could not read, skipped, left out on purpose (reasons, folders, totals), Ignore rules — `renderKnowledgeCoverage`, `knowledge-model.js` (`indexGaps`)
- [ ] Compare: two indexed folders, symbols and calls only in one or the other (project names taken off, partial when CBM cut its lists) — `renderKnowledgeCompare`, `knowledge-model.js` (`compareModel`)
- [ ] Lens: CBM's web view, with the app's accent colour in place of its green and LENS as its title (`knLensRecolor`, `KN_LENS_CSS`), in a `<webview>` of its own session (http on 127.0.0.1 only, no permission but the clipboard), one on the page's body laid over the view so a redraw does not reload it; Lens off or not answering say why — `project-knowledge-lens.js`, `web-page.js` (`isLensUrl`, `LENS_PARTITION`)
- [ ] Settings: Use the code graph (fresh indexes on git changes, a Code graph section in CLAUDE.md and AGENTS.md, CBM's MCP server for Claude and Codex sessions when the agent has none), Refresh automatically, How much to read, Link the repositories and Link now, Agents (its own or per session) and Tools in the sessions, per folder Share with the team, Ignore rules, Re-index, Delete graph…, the program and its session — `renderKnowledgeSettings`, `knowledge.js` (`briefSection`, `sessionLaunch`, `scheduleRefresh`), `projects.js` (`addBriefSection`), `harnesses/claude.js` (`mcpConfig`), `harnesses/codex.js` (`mcpServers`)
- [ ] Elsewhere: a Code graph card on the Overview (projects with the graph on), Symbols in Node Knowledge in the Files menu, Impact in the Git Changes heading and the History's commit and uncommitted menus, Impact in Node Knowledge for a worktree, Ask an agent… on the Overview; Settings › Node Knowledge (the program, CBM's own settings, Set up… for the agents after its --dry-run) — `project-knowledge-links.js`, `project-knowledge-settings.js`, `knowledge.js` (`installAgents`, `getConfig`, `setConfig`)

## 11. Project page: Settings tab

- [ ] Name is editable and saves on Enter or blur with a short "Saved" mark — `projects-view.js` (`renderSettings`, `#ws-set-name`, `flashSaved`)
- [ ] "Project folder" shows the path and opens it; "Sessions start in" picks the default start folder — `projects-view.js` (`#ws-set-open`, `buildCwdField`)
- [ ] Folders list with mode text, Open and Detach per folder, and "Attach folder…" — `projects-view.js` (`#ws-set-folders`, `#ws-set-attach`)
- [ ] Worktree branch name and the "Same in every repo" switch save at once — `projects-view.js` (`#ws-set-branch`, `#ws-set-shared`)
- [ ] Tracks list: rename in place, start folder, CLI (Ask each time, Claude, Codex, OpenCode), Done/Reopen, Delete; "New track" — `projects-view.js` (`buildTrackSettingsRow`, `#ws-set-new-track`)
- [ ] Footer: Wake now (when snoozed), Mark as done / Reopen project, Remove project… — `projects-view.js` (`#ws-set-wake`, `#ws-set-status`, `#ws-set-remove`)

## 12. Sessions tab

- [ ] Sessions are grouped by folder with a header (short path, full path as title, branch icon for a project worktree, "<project> · repos/x" for folders inside a project), collapsible, with older groups auto-collapsed after the session max age — `sidebar.js` (`renderProjects`, `processProjectSessions`, `projectRootLabel`)
- [ ] Claude worktrees under `.claude/worktrees/` nest under their parent folder with a Hide worktree button — `sidebar.js` (`worktreePattern`, `.worktree-hide-btn`)
- [ ] Each folder header has a project-task button, a schedule clock, Project settings (gear), Archive all sessions, and New session — `sidebar.js` (`createProjectTaskButton`, `.project-schedule-btn`, `.project-settings-btn`, `.project-archive-btn`, `.project-new-btn`)
- [ ] Sessions sharing a slug collapse into a group row with a count, state dot and archive-all button — `sidebar.js` (`buildSlugGroup`, `.slug-group-archive-btn`)
- [ ] Up to the "Max visible sessions" show per folder; the rest sit behind "+ n older" with an "Archive all older" button — `sidebar.js` (`buildSessionsList`, `.sessions-more-toggle`)
- [ ] A session row shows the star, CLI mark with running dot, title, time and message count, schedule chip, and hover buttons Archive, Fork, Mark as read/unread, Stop (or Dismiss), ⋯ — `sidebar.js` (`buildSessionItem`)
- [ ] Row states: running dot, "needs attention", "response ready" (unread) and busy spinner, from terminal signals — `app.js` (`setActivity`, `attentionSessions`, `responseReadySessions`, `sessionBusyState`)
- [ ] Unread and needs-you marks survive a restart and clear when the session is opened or marked read — `app.js` (`SESSION_NOTICES_KEY`, `saveSessionNotices`)
- [ ] Clicking a row opens or resumes the session; an archived session asks "Unarchive it and open it?" first — `app.js` (`openSession`, `unarchiveSessionBeforeOpen`)
- [ ] Double-click the title or ⋯ › Rename session edits the name inline (Enter saves, Escape cancels, same as AI title clears the custom name) — `sidebar.js` (`startRename`), `main.js` (`rename-session`)
- [ ] The star toggles pinned, and "Show pinned only" filters to starred — `sidebar.js` (`.session-pin`), `main.js` (`toggle-star`), `app.js` (`#star-toggle`)
- [ ] Archive and Unarchive a session (stopping it first if it runs), or all sessions of a folder, a slug group or the older ones, after confirmation — `sidebar.js`, `main.js` (`archive-session`, `stop-session`)
- [ ] Stop asks "Stop this session?"; Dismiss removes a row that never produced a transcript and is not running — `app.js` (`confirmAndStopSession`, `dismissSession`, `isDismissibleSession`)
- [ ] Fork starts a new session from this one on the same CLI, in the same folder (and the same project and track) — `dialogs.js` (`forkSession`), `sidebar.js` (`.session-fork-btn`)
- [ ] ⋯ menu: Resume with config… (when not running), Rename session, Copy session ID, View messages, Move to project…, Dismiss session — `sidebar.js` (`moreBtn.onclick`), `dialogs.js` (`showResumeSessionDialog`), `projects-view.js` (`showMovePopover`)
- [ ] Move to project files a session under a project or track, creates a track from here, or removes it from its project — `projects-view.js` (`sessionMoveItems`), `main.js` (`set-session-assignment`)
- [ ] Filters: Running only, Pinned only (these two exclude each other), Today only, Show archived; Re-sort re-orders by priority and time — `app.js` (`#running-toggle`, `#star-toggle`, `#today-toggle`, `#archive-toggle`, `#resort-btn`)
- [ ] The row order holds still under the pointer: opening a session does not move it, only a new session, a finished turn or a question does — `app.js` (`bumpSessionEvent`, `sessionEventTime`)
- [ ] Search box: debounced full-text search of what was said plus titles of rows the index has not seen (terminals, sessions without a transcript yet); Tt toggles titles only (remembered) and also matches folder names; × clears — `app.js` (search handler, `#search-titles-toggle`), `search-results.js`, `main.js` (`search`, `search-session-ids`)
- [ ] While searching, each row has an X that leaves it out of this search only (master) — `sidebar.js` (`.session-exclude-btn`), `app.js` (`leaveOutOfSearch`)
- [ ] A bar under the search shows "n sessions", "n left out" (click to bring them back) and "Stop n running" that stops the running sessions shown after one confirmation (master) — `app.js` (`updateSearchActions`, `stopSearchResults`, `#search-actions`), `search-results.js`
- [ ] "Add Folder" asks for a folder path (with a Browse button) and adds it to the list — `dialogs.js` (`showAddProjectDialog`), `main.js` (`browse-folder`, `add-project`)
- [ ] A folder is hidden from the list from its settings ("Hide Folder") or a worktree's X; session files are never deleted — `settings-panel.js` (`#sv-remove-btn`), `main.js` (`remove-project`)
- [ ] The list shows a loading status while the index builds — `app.js` (`#loading-status`, event `status-update`)

## 13. New session, resume, fork and schedules

- [ ] "+" on a folder or project opens a menu with one pair of rows per enabled CLI (run with defaults, "(Configure…)") and Terminal — `dialogs.js` (`showNewSessionPopover`), `projects-view.js` (`showNewSessionMenu`, `newSessionItems`)
- [ ] The configure dialog is titled "New <CLI> Session — <folder>" and has Start and Cancel; Cmd/Ctrl+Enter starts, Escape cancels — `dialogs.js` (`showNewSessionDialog`)
- [ ] Claude options: Permission mode (Default, Auto, Accept Edits, Plan Mode, Don't Ask, Bypass, Dangerous Skip), Worktree and Worktree name (new sessions only), Chrome, and behind "More options": Model, Effort, Allowed Tools, Custom Arguments, Additional System Prompt, Pre-launch Command, Additional Directories — `session-config.js` (`fieldsFor('claude')`), `session-config-form.js`
- [ ] Codex options: Sandbox (Default, Read Only, Workspace Write, Full Access), Approval (Default, On Request, Never), Bypass Approvals and Sandbox, behind "More options" Model (with the model catalog) and Reasoning Effort (levels the model does not support are disabled), plus Pre-launch Command and Additional Directories — `session-config.js` (`fieldsFor('codex')`), `session-config-form.js`, `main.js` (`get-codex-models`)
- [ ] OpenCode options: Auto-approve Permissions and Pre-launch Command, no Additional Directories — `session-config.js` (`fieldsFor('opencode')`)
- [ ] The form starts from the effective settings (app defaults, global, folder) and runtime-specific settings are used when resuming — `main.js` (`get-effective-settings`), `resolve-effective-settings.js`, `dialogs.js` (`resolveDefaultSessionOptions`)
- [ ] "Resume with config…" shows the same form (without new-only fields) titled "Resume <CLI> Session — <name>", with Enter to resume — `dialogs.js` (`showResumeSessionDialog`)
- [ ] A new session gets a temporary id; Codex replaces it with the real one when its transcript appears (OpenCode with the id it was started on, once it records the session), and the row, terminal and project state re-key — `app.js` (`launchNewSession`, `onSessionDetected`), `main.js` (`open-terminal`)
- [ ] A session started from a project, a track, a plan item or a schedule is filed there and shows in the project at once — `app.js` (`launchNewSession`), `projects-view.js` (`injectPendingIntoTree`, `launchTargetFor`)
- [ ] A raw terminal session can be started in any folder, is listed with a terminal mark, and is restored after a window reload with its history — `dialogs.js` (`launchTerminalSession`, `openRawTerminalSession`), `terminal-manager.js` (`persistTerminalSession`, `restoreTerminalHistory`)
- [ ] Folder and project scheduled tasks: a clock opens "New scheduled task" (or a list of existing ones with Edit…, Run now, Turn on/off, Delete…); the clock shows a count and is tinted or dimmed — `schedules.js` (`showFolderScheduleMenu`, `showProjectScheduleMenu`, `scheduleMenuItems`, `decorateScheduleButton`)
- [ ] The schedule dialog has Name, Track, When (Every 15 minutes, 30 minutes, hour, day, weekdays, week; at time or minute; weekday), Prompt, CLI, Session settings (folder defaults or Customize), On, and "Catch up on missed runs" — `schedules.js` (`showScheduleDialog`), `schedule-time.js` (`PRESETS`, `describeTiming`, `nextDueAt`)
- [ ] A due schedule starts a session at that moment while the app is open, filed in its project and track, with a schedule chip on the row; imported cron schedule files still fire — `schedules.js` (`launchScheduledSession`), `main.js` (event `schedule-due`, `resolve-schedule-launch`), `schedule-runner.js`
- [ ] Project tasks (from `.vscode/tasks.json`, inherited from parent folders) show in a popover with a state, Run, Stop, Restart, "View log" and "Stop all"; configuration errors show in the popover — `task-runner.js` (`showTaskPopover`, `renderTaskPopover`), `task-config.js`, `task-manager.js`
- [ ] A running task's output shows in the terminal area with a "Task" header, Restart and Stop buttons, and survives a reload — `task-runner.js` (`showTaskLog`, `restoreActiveTaskView`, `#terminal-restart-task-btn`), `main.js` (`task-input`, `task-resize`)

## 14. Terminals, grid view, links and search

- [ ] Each session has an xterm terminal (WebGL, unicode graphemes, 10,000 lines of scrollback, convertEol) that fits its container and keeps scroll position on resize — `terminal-manager.js` (`createTerminalEntry`, `safeFit`, `fitAndScroll`), `main.js` (`terminal-input`, `terminal-resize`)
- [ ] The terminal header shows the session name, the terminal's own title, the session id, the shell, a status text, and a Stop button — `app.js` (`updateTerminalHeader`, `updatePtyTitle`, `#terminal-header-*`, `#terminal-stop-btn`)
- [ ] A session that dies stays on screen behind a "session exited" banner so the error can be read; clicking the session again restarts it — `app.js` (`onProcessExited`)
- [ ] Terminal output is buffered per frame and held back inside synchronized-update blocks — `app.js` (`onTerminalData`), `terminal-manager.js` (`flushTerminalBuffer`)
- [ ] Cmd/Ctrl+F opens a find bar (previous, next, close, match decoration) in the terminal — `terminal-manager.js` (`.terminal-search-bar`, `SearchAddon`)
- [ ] Shift+Enter (and Ctrl+Enter off the Mac) types a newline; Space is sent directly; IME composition is respected; Ctrl+C copies when text is selected on Windows and Linux; Cmd+Left/Right jump to line start and end on the Mac — `terminal-manager.js` (`setupTerminalKeyBindings`)
- [ ] OSC 52 lets a program set the clipboard; OSC 7 sets the working directory; OSC 0 and OSC 9;4 drive the busy state; OSC 9 notifications mark "needs attention" or "idle" per CLI — `terminal-manager.js` (`decodeOsc52Payload`), `main.js` (`classifyNotification`), `app.js` (`onTerminalNotification`, `onCliBusyState`)
- [ ] Text selection works inside TUIs that grab the mouse (Option on the Mac, Shift elsewhere) — `terminal-manager.js` (`macOptionClickForcesSelection`)
- [ ] Dropping files on a terminal types their shell-escaped paths — `terminal-manager.js` (`setupDragAndDrop`)
- [ ] Web links open in the system browser; file paths in output (absolute, `~/`, relative, `file://`, editor URIs, `path:line:col`, Markdown targets) are underlined on hover with a tooltip, and a click opens the file in the side panel at the line; an ambiguous relative path asks "Open relative file from…" — `terminal-links.js`, `terminal-file-links.js`, `terminal-manager.js` (`linkActions.chooseFile`), `main.js` (`resolve-terminal-files`)
- [ ] The terminal theme is one of Switchboard, Ghostty, Tokyo Night, Catppuccin Mocha, Dracula, Nord, Solarized Dark and applies to open terminals at once — `terminal-themes.js`, `app.js` (`_applyTerminalTheme`)
- [ ] Terminal history is saved in the browser for restored terminals (bounded lines and characters) — `terminal-manager.js` (`TERMINAL_HISTORY_MAX_LINES`, `saveTerminalHistory`)
- [ ] Grid view ("Session overview" button or Cmd/Ctrl+Shift+G) shows every open session as a card with project headings, state dot, name, project, time, status, a Stop button, and a "n sessions" count; double-clicking a card header returns to the full terminal; the choice is remembered — `grid-view.js` (`showGridView`, `wrapInGridCard`, `toggleGridView`, `#grid-toggle-btn`)
- [ ] In the grid Cmd/Ctrl+Arrow moves focus to the nearest card in that direction; in single view Cmd+Arrow and Cmd+Shift+[ ] cycle through open sessions in the visible list order — `grid-view.js` (`navigateGrid`, `navigateSession`, `handleSessionNavKey`)
- [ ] The terminal engine runs sessions either in herdr-core (they keep running when the app quits and re-attach at the next start, a note says when a kept session lost its IDE server) or inside the app (master) — `hc-engine.js`, `main.js` (`get-terminal-engine`), `settings-panel.js` (`#sv-terminal-engine`)
- [ ] Sessions running at launch (also those kept in herdr-core, and scheduler-started ones) show as running within 30 seconds; the poll is 3 seconds while anything runs — `app.js` (`pollActiveSessions`, `POLL_FAST_MS`, `POLL_IDLE_MS`), `main.js` (`get-active-sessions`, `get-active-terminals`)

## 15. Transcript (JSONL) viewer and message search

- [ ] "View messages" (⋯ menu or a project menu) opens the session's transcript in the main area with the session name and id — `jsonl-viewer.js` (`showJsonlViewer`), `main.js` (`read-session-jsonl`)
- [ ] User and assistant messages render as Markdown text with inline images (click for full screen); thinking blocks are collapsible; turn durations and custom titles show as meta lines — `jsonl-viewer.js` (`renderJsonlEntry`, `makeCollapsible`)
- [ ] Tool calls show a coloured block with their summary and expandable input; their results render under them (output, screenshots, errors); IDE-emulation actions (open file, diff, selection) have their own rendering — `jsonl-viewer.js` (`renderToolUse`, `renderToolResult`, `renderMcpAction`)
- [ ] Local shell commands (caveat, input, stdout, stderr) merge into one block — `jsonl-viewer.js` (`mergeLocalCommandEntries`, `renderLocalCommand`)
- [ ] The viewer opens scrolled to the newest message; an empty transcript says "No messages found in this session." and errors are shown — `jsonl-viewer.js`
- [ ] A find bar (Cmd/Ctrl+F style, previous, next, close, count) searches the rendered messages — `message-search.js` (`createMessageSearch`)
- [ ] Opening a transcript highlights the session in the sidebar and in the project page — `jsonl-viewer.js`, `projects-view.js` (`onMessagesShown`)

## 16. Plans and Files tabs

- [ ] The Plans tab lists Claude's saved plans with title, file name and date; "No plans found" when empty — `plans-memory-view.js` (`renderPlans`, `buildPlanItem`), `main.js` (`get-plans`)
- [ ] Clicking a plan opens it in the viewer to read or edit and save (Cmd+S), with preview toggle and the other viewer buttons — `plans-memory-view.js` (`openPlan`), `main.js` (`read-plan`, `save-plan`)
- [ ] A plan has an "Adopt into a project as plan.md" button with a project menu (confirms before replacing an existing plan, offers to open the project) — `plans-memory-view.js` (`adoptPlanInto`)
- [ ] (master) Under the search box, Group (none, project, folder, date), Filter (a menu: project, folder, date of the last edit, session archived or not or gone; they combine, with counts and Clear filters) and Sort (last edited, oldest first, created: when the plan's first session started, title A–Z) apply to the plans and to what the search found, kept across restarts. Each plan is linked to its session by its slug, and through it to its folder and project; a row says where it belongs, groups close with a click, "No project" and "Unknown folder" come last — `plans-list.js`, `plans-memory-view.js` (`renderPlans`, `planFilterMenuItems`), `plans-source.js`, `main.js` (`get-plans`), `db.js` (`getSlugSessions`)
- [ ] The Files tab (Agent Files upstream) lists memory and instruction files in a Global group and one group per project, collapsible with a count; each file shows name, path and date — `files-view.js` (`renderFiles`, `buildMemoryGroup`, `buildFileItem`), `main.js` (`get-memories`)
- [ ] Clicking a file opens it in the viewer to edit and save; any kind the viewer previews (text, image, PDF, JSON tree), the others in their default app — `files-view.js` (`openFileHere`), `main.js` (`read-file-for-panel`, `save-memory`, `save-file-for-panel`)
- [ ] The search box filters plans, and the Files tab's agent and opened files (full text, titles only with Tt) on their tabs — `app.js` (search handler for `plans`, `memory`), `main.js` (`search`, types `memory` and `opened`)
- [ ] (master) Under the search box, a filter shows All files, Agent files or Opened files, kept across restarts — `files-list.js` (`buildFilesSections`, `loadFilesFilter`)
- [ ] (master) A file dragged from outside the app over the sidebar, on any tab, turns it into a drop zone: the upper half opens the file in the Files tab's editor (the sidebar moves to Files), the lower half in a window of its own with a keep-on-top pin; folders are turned away — `files-drop.js`, `files-view.js` (`openDroppedFiles`), `file-window.js`, `main.js` (`add-opened-files`, `open-file-window`)
- [ ] (master) Opened files are kept in an Opened group, most recent first; one taken off the list is forgotten, its pin too, and a pinned one asks for confirmation first; a file no longer there says "File not found" — `opened-files.js`, `files-view.js` (`removeFileFromList`), `main.js` (`get-opened-files`, `remove-opened-file`)
- [ ] (master) Any file of the tab can be pinned: a Pinned group at the top, in sight with every filter, ordered by dragging or with Move up / Move down in the row's menu — `files-view.js` (`bindPinnedDrag`, `showFileMenu`), `main.js` (`set-file-pinned`, `move-pinned-file`)

## 17. Stats

- [ ] Stats opens in the main area from its tab; the stats are refreshed through the CLI and a cached copy shows if that fails ("Stats refresh failed… Showing cached data.") — `stats-view.js` (`loadStats`), `stats-refresh.js`, `main.js` (`get-stats`, `refresh-stats`)
- [ ] "Claude Rate Limits" shows a bar per limit (Current session, Week all models, Sonnet, Opus, any new model) with percent and reset time and a refresh button — `stats-view.js` (`buildUsageSection`), `main.js` (`get-usage`), `claude-auth.js`
- [ ] "Codex Rate Limits" shows the same for Codex, including rate-limited and error notes — `stats-view.js`, `main.js` (`get-codex-usage`), `codex-auth.js`
- [ ] A summary shows total sessions, total messages, current streak and longest streak; a daily bar chart and an activity heatmap show the history — `stats-view.js` (`buildStatsSummary`, `buildDailyBarChart`, `buildHeatmap`, `calculateStreak`)
- [ ] Stats can also open in a window of its own with a refresh button and a pin — `stats-window.js`, `stats.html` (master)

## 18. Task Manager (master)

- [ ] The Task Manager page shows RAM installed, in use on the whole computer (split into this app and others), and used by the app and its sessions, with a meter each (master) — `process-viewer.js` (`summaryHtml`), `process-monitor.js`, `main.js` (`get-process-usage`)
- [ ] A disk card shows free space per disk (master) — `process-viewer.js` (`disksHtml`)
- [ ] A table lists each running session and task with its process count, CPU, RAM (sorted heaviest first, with a bar) and uptime, and a note on how memory is measured per platform (master) — `process-viewer.js` (`ownerHtml`, `measureNote`)
- [ ] A row expands to the processes inside (name, command, PID, CPU, RAM) with a Kill (SIGTERM, then Force kill when it persists) per process (master) — `process-viewer.js` (`data-action="toggle"`, `data-action="kill"`), `main.js` (`kill-owned-process`)
- [ ] Open shows the session or the task's output in the main window (master) — `process-viewer.js` (`data-action="open"`), `main.js` (`task-manager-open-owner`)
- [ ] Stop ends a session the way the sidebar does and then anything of its tree that outlived it; "Stopping…" then Force kill SIGKILLs the whole tree (master) — `process-viewer.js` (`data-action="stop"`, `"force"`), `main.js` (`stop-owner`, `force-stop-owner`)
- [ ] The page refreshes every few seconds while visible, has a Refresh button and Close, and a "Live · every Ns · time" status (master) — `process-viewer.js` (`#process-viewer-refresh`, `#process-viewer-status`, `visibilitychange`)
- [ ] The Task Manager can open in a window of its own with a pin that keeps it on top, its window position remembered per kind (master) — `task-manager-window.js`, `task-manager.html`, `tool-window.js` (`setupWindowPin`), `main.js` (`openToolWindow`, `set-window-on-top`)

## 19. Settings (global and per folder)

- [ ] Global settings open from the gear tab as "Global Settings — Global"; folder settings open from a folder's gear as "Folder Settings — <folder>" — `settings-panel.js` (`openSettingsViewer`)
- [ ] CLI Agents: one switch per CLI to scan for its sessions and offer it; at least one stays on and the last is locked with an explanation — `settings-panel.js` (`.sv-harness-toggle`, `syncHarnessLock`), `main.js` (`get-harnesses`)
- [ ] Claude CLI options (default permission mode, worktree, worktree name, Chrome, additional directories), Codex CLI options (sandbox, approval, model) and Session launch (pre-launch command); a folder shows "Use global default" per field — `settings-panel.js` (`#sv-perm-mode`, `#sv-worktree`, `#sv-chrome`, `#sv-add-dirs`, `#sv-codex-*`, `#sv-pre-launch`, `.use-global-cb`)
- [ ] Application: Terminal Theme, Accent Color (presets or any colour, shown at once in every window, `accentColor`; `accent.js`, `--accent` in the stylesheets), Shell Profile (auto or a detected profile; new sessions only), Max Visible Sessions, Session Max Age (days), Projects Folder, Project Templates (open the folder), IDE Emulation (new sessions only; a notice after changing) — `settings-panel.js`, `shell-profiles.js`, `main.js` (`get-shell-profiles`)
- [ ] Terminal Engine: herdr-core (keep running) or Inside the app, with a "Now: …" status line, taking effect at the next start (master) — `settings-panel.js` (`#sv-terminal-engine`, `#sv-terminal-engine-status`), `main.js` (`get-terminal-engine`)
- [ ] Updates: the current version, "Check for Updates" and an inline status — `settings-panel.js` (`#sv-check-updates-btn`), `main.js` (`updater-check`)
- [ ] Save writes the setting and shows "✓ Saved" then closes; Cancel closes without saving; "Hide Folder" hides a folder after confirmation — `settings-panel.js` (`#sv-save-btn`, `#sv-cancel-btn`, `#sv-remove-btn`), `main.js` (`set-setting`, `get-setting`, `delete-setting`)
- [ ] A change of Max Visible Sessions, Session Max Age or Terminal Theme takes effect without a restart — `app.js` (`_setVisibleSessionCount`, `_setSessionMaxAge`, `_applyTerminalTheme`)

## 20. IDE emulation side panel (files and diffs from sessions)

- [ ] When a session opens a file in its IDE, a side panel opens beside the terminal with that file as a tab and the "IDE Emulation" indicator — `file-panel.js` (`initFilePanel`), `mcp-bridge.js`, event `mcp-open-file`
- [ ] When a session proposes a change, a diff tab opens with Accept, Reject and Save-edited-and-accept, switchable between side-by-side and inline — `file-panel.js` (`handleDiffAction`, `diffToggleBtn`), `main.js` (`mcp-diff-response`)
- [ ] The first answer to a change wins: if a paired phone answered first, the window closes the tab and says so (master) — `file-panel.js` (`onMcpDiffResolved`, `handleDiffAction`), `mcp-bridge.js`
- [ ] A "Browse project files" toggle shows a project file tree with refresh and a context menu (open, reveal, copy path, rename, move to Trash) — `file-panel.js` (project browser), `file-actions.js` (`fileEntryMenuItems`), `main.js` (`list-project-directory`)
- [ ] The panel is resizable; tabs can be closed; open files follow renames — `file-panel.js` (`filePanelResizeHandle`, `rekeyFilePanelState`)
- [ ] Per-session panel state survives session id re-keys — `file-panel.js` (`filePanelState`)

## 21. Remote access (mobile app) (master)

- [ ] The Mobile app access dialog has an on/off switch that starts and stops the server and shows "On, port N, n devices connected", or the error ("Port N is already in use") (master) — `remote-access.js` (`describe`, `.remote-dialog-switch`), `main.js` (`remote-access-set-enabled`, `remote-access-status`)
- [ ] The switch stays on while its port is busy and retries (master) — `main.js`, `remote-server.js`
- [ ] A Port field with Save changes the port (default 47100) (master) — `remote-access.js` (`.remote-port-btn`), `main.js` (`remote-access-set-port`)
- [ ] "Add a device" turns access on if needed and shows a pairing QR code with a two-minute countdown, the computer's addresses and port, and any Internet routes; the code works once (master) — `remote-access.js` (`startPairing`, `pairingSection`), `remote-auth.js` (`PAIRING_TTL_MS`), `main.js` (`remote-access-start-pairing`, `remote-access-cancel-pairing`)
- [ ] The device list shows each paired device with connected or "last seen <time>" or "never connected" and an X to remove it after confirmation; a new device appearing closes the QR (master) — `remote-access.js` (`deviceRow`, `.remote-revoke-btn`), `main.js` (`remote-access-list-devices`, `remote-access-revoke-device`)
- [ ] "Access from the Internet" has Cloudflare (API token, domain, name) and ngrok (authtoken, optional domain) rows with state text (Not set up, Connecting…, address, error), Set up… / Change… / Remove… forms that keep typed values across repaints (master) — `remote-access.js` (`TUNNELS`, `tunnelRow`, `tunnelFormHtml`), `remote-tunnels.js`, `main.js` (`remote-tunnel-setup`, `remote-tunnel-remove`)
- [ ] Tunnel secrets are encrypted with the system keychain and only phones with the access key may connect through a tunnel (master) — `remote-tunnels.js`, `remote-server.js`, `main.js` (`safeStorage`)
- [ ] The window learns the remote-access status as it changes (event `remote-access-status`) (master) — `preload.js` (`onRemoteAccessStatus`)
- [ ] While remote access is on, a working session keeps the computer from idle sleep (app suspension is blocked only while a session is busy) (master) — `window-lifecycle.js` (`createPowerSaveGuard`), `main.js` (`powerSaveGuard`)
- [ ] A session open on a phone counts as seen: it clears unread and attention marks in the window, and marks set on the window or a phone show on both (master) — `session-notices.js`, `app.js` (`onRemoteViewing`, `onRemoteMarkRead`, `onWindowVisibility`, `publishSessionNotices`)
- [ ] Terminals attached by a phone get the output fan-out, and a phone can fit the terminal to its screen (master) — `terminal-fanout.js`, `main.js` (`attach-terminal`, `fit-terminal`)

## 22. Notifications, toasts, updates and What's New

- [ ] A session that needs permission shows an attention dot, and a finished turn on a session not being looked at shows "response ready"; the project dot and project row follow — `app.js` (`onTerminalNotification`), `projects-view.js` (`updateProjectStatusDots`)
- [ ] An update toast "New Version Ready vX" with Restart and Later appears when an update is downloaded (Later remembers the dismissed version) — `app.js` (`updaterHandler`, `#update-toast`), `main.js` (`updater-install`)
- [ ] The status bar shows update progress (Checking for updates…, Downloading vX…, Updating… n%, Up to date, Update check failed) — `app.js` (`setUpdaterStatus`, `#status-bar-updater`)
- [ ] Updates are checked five seconds after launch and every four hours, and skipped in builds without an update feed — `main.js` (`autoUpdater`)
- [ ] A "What's New" dialog (New Project View) with a screenshot carousel, arrows, dots and a caption shows once and can be dismissed for good; it does not appear in a project window — `whats-new.js`, `whats-new.css`
- [ ] Confirmations use native `confirm`/`alert` for archive, stop, hide folder and similar; typed-work dialogs ignore a click on the backdrop and close on Escape or Cancel — `projects-view.js` (`showPromptDialog`, dialog rule comment), `sidebar.js`

## 23. Separate tool and project windows (master)

- [ ] The Stats and Task Manager tab tooltips open that page in its own window; the window position and its on-top choice are remembered (master) — `sidebar-tips.js`, `main.js` (`openToolWindow`, `open-tool-window`, `saveToolWindowSettings`)
- [ ] A pin button in the window header keeps it above other windows or lets it go behind (master) — `tool-window.js` (`setupWindowPin`), `main.js` (`get-window-on-top`, `set-window-on-top`)
- [ ] A project tab (Overview, Plan, Todos, Files, Git, Settings) opens in a window of its own with a header that names the project and tab, and its own pin (master) — `projects-view.js` (`showProjectWindow`, `projectWindowHeaderHtml`), `project-window.js`, `main.js` (`open-project-window`)
- [ ] A session opened or started from a project window opens in the main window, which comes forward (master) — `project-window.js` (`PROJECT_WINDOW_RUN`), `main.js` (`project-window-run`), `app.js` (`onProjectWindowRun`)
- [ ] The Task Manager's Open from its own window shows the session or task output in the main window (master) — `task-manager-window.js`, `main.js` (`task-manager-open-owner`), `process-viewer.js` (`onTaskManagerOpenOwner`)
- [ ] The project window says "This project is not in Switchboard any more." when its project is gone (master) — `projects-view.js` (`showProjectWindow`)

## 24. Keyboard shortcuts

- [ ] Cmd/Ctrl+Shift+G toggles grid view, from anywhere including a focused terminal — `app.js`, `terminal-manager.js`, `grid-view.js`
- [ ] Cmd/Ctrl+Shift+[ and ] go to the previous and next open session; Cmd/Ctrl+Arrow does the same (left/right, up/down) and moves between cards in the grid; arrows typed in a text field or editor stay with the field — `grid-view.js` (`isSessionNavKey`, `handleSessionNavKey`, `isTextEditingTarget`)
- [ ] Cmd/Ctrl+F finds in a terminal, in the viewer and in the transcript; Cmd/Ctrl+G goes to a line; Cmd/Ctrl+S saves a file in the editor — `terminal-manager.js`, `codemirror-setup.js`, `message-search.js`
- [ ] Shift+Enter inserts a newline in the CLI (Ctrl+Enter on Windows and Linux) — `terminal-manager.js`
- [ ] Cmd/Ctrl+Enter starts the New session dialog; Enter resumes in the Resume dialog; Escape closes dialogs and menus — `dialogs.js`, `projects-view.js` (`onCtxKey`)
- [ ] Context menus open on right-click and on the context-menu key or Shift+F10, close on Escape and outside click, and support submenus — `projects-view.js` (`showContextMenu`, `buildMenu`, `onCtxPointerDown`)
- [ ] Files explorer shortcuts (listed in section 7) and Git Graph shortcuts (section 9) — `project-files-view.js`, `project-git-graph-view.js`
- [ ] Cmd/Ctrl+R reload is disabled app-wide (see section 1) — `main.js`

## 25. Status bar

- [ ] Left: "n running · n sessions · n folders · n projects" — `app.js` (`renderDefaultStatus`, `#status-bar-info`)
- [ ] An activity text shows indexing progress and "done" briefly — `app.js` (`onStatusUpdate`, `#status-bar-activity`)
- [ ] Quota gauges: one group per CLI (Claude, Codex) with a bar, label (5h, Week, model), percent and a tooltip with reset time, green/amber/red by usage, refreshed every five minutes and when a CLI is switched on or off; clicking opens Stats — `app.js` (`refreshQuotaGauge`, `buildQuotaGroup`, `#status-bar-quota`)
- [ ] Right: updater status text — `app.js` (`#status-bar-updater`)

---

# IPC and phone API

## Renderer to main: ipcMain handlers in `apps/desktop/main.js`

There are **225** handlers: 219 `ipcMain.handle` and 6 `ipcMain.on`. Upstream `main` has 98 of them; **127 are master only** (4 came with 1.6.6: staging, search and replace). A handler marked (master) is one of those. All of them are registered through `ipc-registry.js`, which lets the remote-access server call the same function with a null event. Events from main to the renderer are listed after the table.

| Area | Count | Channels |
|---|---|---|
| Folders and legacy list | 4 | `browse-folder`, `add-project`, `remove-project`, `get-projects` |
| Projects, tracks, templates | 12 | `get-project-tree`, `create-project`, `update-project`, `delete-project`, `attach-project-folder`, `detach-project-folder`, `set-session-assignment`, `create-track`, `update-track`, `delete-track`, `get-projects-root`, `list-templates` |
| Brief, plan, todos, added files | 10 | `save-project-brief`, `create-project-file`, `add-project-files`, `list-recent-project-files`, `get-project-plan`, `set-plan-item`, `append-plan-item`, `edit-plan-item`, `adopt-plan`, `list-env-files` |
| Schedules | 6 | `list-schedules`, `create-schedule`, `update-schedule`, `delete-schedule`, `resolve-schedule-launch`, `get-schedule-context` |
| Git Changes | 6 (2 master) | `get-project-git-status`, `get-project-git-info`, `get-project-git-diff`, `get-folder-git-status`; (master) `stage-project-git-files`, `stage-project-git-lines` |
| Git History (graph) | 20 (15 master) | `get-project-git-graph`, `get-git-graph-commit-detail`, `get-git-graph-compare-detail`, `get-git-graph-file-at-revision`, `get-git-graph-file-diff-between` (upstream); (master) `get-git-graph-repo-config`, `set-git-graph-repo-config`, `trust-git-graph-repo-config`, `confirm-git-graph-avatars-gitlab-host`, `export-git-graph-repo-config`, `get-git-graph-user-details`, `get-git-graph-global-preferences`, `set-git-graph-global-preferences`, `get-git-graph-remotes`, `get-git-graph-tag-details`, `get-git-graph-avatar-url`, `clear-git-graph-avatar-cache`, `run-git-graph-action`, `cancel-git-graph-action`, `save-git-graph-archive` |
| Git Worktrees | 18 (all master) | `get-project-worktrees`, `get-worktree-settings`, `set-worktree-settings`, `list-worktree-branches`, `suggest-worktree-path`, `worktree-create`, `worktree-run-post-create`, `worktree-remove`, `worktree-delete-branch`, `worktree-merged`, `worktree-lock`, `worktree-unlock`, `worktree-move`, `worktree-repair`, `worktree-prune-preview`, `worktree-prune`, `worktree-attach`, `worktree-detach` |
| Git Pull Requests | 14 (all master) | `get-pull-requests`, `get-pull-requests-page`, `get-pull-request-files`, `run-pull-request-action`, `get-pull-request-conversation`, `get-pull-request-commits`, `get-pull-request-commit-files`, `get-pull-request-checks`, `get-pull-request-job-log`, `get-pull-request-viewed`, `get-pull-request-branches`, `get-pull-request-candidates`, `render-pull-request-markdown`, `edit-pull-request` |
| Node Knowledge | 23 (all master) | `get-knowledge-status`, `get-knowledge-settings`, `set-knowledge-settings`, `knowledge-query`, `knowledge-compare`, `knowledge-prompt`, `knowledge-index`, `knowledge-index-all`, `knowledge-link-cross-repo`, `knowledge-delete-index`, `knowledge-adr`, `knowledge-ingest-traces`, `knowledge-import-traces-file`, `get-knowledge-config`, `set-knowledge-config`, `get-knowledge-global`, `set-knowledge-global`, `knowledge-pick-binary`, `knowledge-lens`, `knowledge-download-binary`, `knowledge-restart`, `get-knowledge-binary`, `knowledge-install-agents` (event `knowledge-changed`) |
| Files, viewer, IDE panel | 20 (10 master) | `mcp-diff-response`, `resolve-terminal-files`, `open-file-externally`, `read-file-for-panel`, `list-project-directory`, `manage-project-entry`, `read-project-file`, `save-file-for-panel`, `watch-file`, `unwatch-file` (upstream); (master) `share-file`, `create-project-entry`, `duplicate-project-entry`, `paste-project-entry`, `get-file-timeline`, `get-file-timeline-diff`, `get-file-at-commit`, `open-file-with-app`, `search-project-files`, `replace-in-project-files` |
| System helpers | 4 (1 master) | `open-external`, `open-path`, `clipboard-write-text`; (master) `reveal-file` |
| Plans and Files tab | 12 (6 master) | `get-plans`, `read-plan`, `save-plan`, `get-memories`, `read-memory`, `save-memory`; (master) `get-opened-files`, `add-opened-files`, `remove-opened-file`, `set-file-pinned`, `move-pinned-file`, `open-file-window` |
| Stats and usage | 4 | `get-stats`, `refresh-stats`, `get-usage`, `get-codex-usage` |
| Search | 2 | `search`, `search-session-ids` |
| Settings and CLIs | 8 (1 master) | `get-setting`, `set-setting`, `delete-setting`, `get-harnesses`, `get-codex-models`, `get-shell-profiles`, `get-effective-settings`; (master) `get-terminal-engine` |
| Project tasks | 9 (2 are `ipcMain.on`) | `list-project-tasks`, `list-tasks-for-projects`, `get-task-run`, `start-task`, `stop-task`, `stop-all-tasks`, `restart-task`, `task-input` (on), `task-resize` (on) |
| Sessions and terminals | 17 (5 master; 4 are `ipcMain.on`) | `get-active-sessions`, `get-active-terminals`, `stop-session`, `toggle-star`, `rename-session`, `archive-session`, `read-session-jsonl`, `get-session-last-message`, `open-terminal`, `terminal-input` (on), `terminal-resize` (on), `close-terminal` (on); (master) `read-session-entries`, `read-session-tail`, `get-session-states`, `session-notices` (on), `launch-session` |
| Task Manager and windows | 10 (all master) | `get-process-usage`, `stop-owner`, `kill-owned-process`, `force-stop-owner`, `task-manager-open-owner`, `open-tool-window`, `open-project-window`, `project-window-run`, `get-window-on-top`, `set-window-on-top` |
| Remote access | 9 (all master) | `remote-access-status`, `remote-access-set-enabled`, `remote-access-set-port`, `remote-access-start-pairing`, `remote-tunnel-setup`, `remote-tunnel-remove`, `remote-access-cancel-pairing`, `remote-access-list-devices`, `remote-access-revoke-device` |
| App and updater | 4 | `get-app-version`, `updater-check`, `updater-download`, `updater-install` |

Main to renderer events the new UI must subscribe to (names from `preload.js`): `terminal-data`, `session-detected`, `session-forked`, `process-exited`, `terminal-notification`, `cli-busy-state`, `harnesses-changed`, `projects-changed`, `project-plan-changed`, `project-tasks-changed`, `task-output`, `task-state-changed`, `status-update`, `schedule-due`, `file-changed`, `updater-event`, `mcp-open-diff`, `mcp-open-file`, `mcp-close-tab`, `mcp-close-all-diffs`, `mcp-diff-resolved`; and, master only, `git-graph-repo-changed`, `git-graph-action-progress`, `remote-access-status`, `window-visibility`, `remote-viewing`, `remote-mark-read`, `project-window-run`, `task-manager-open-owner`.

`preload.js` exposes all of this as `window.api.*`; a typed wrapper for the React app can be generated from it.

## Phone API: methods allowed in `apps/desktop/remote-api.js` (and the modules that add to it)

Remote access is a whitelist: **156 methods** (80 in `remote-api.js`, 20 in `remote-git-graph.js`, 19 in `remote-worktrees.js`, 14 in `remote-pull-requests.js`, 12 in `remote-knowledge.js`, 7 in `remote-tasks.js`, 4 in `remote-process-usage.js`), each with a check per parameter. The hello handshake sends the protocol version (1, `remote-protocol.js`) and the list of methods this desktop implements. Methods marked *local* have no IPC channel; they are implemented in `main.js` (`remoteLocalMethods`) or a `remote-*.js` module because they need to know which phone is calling. Everything here is master only.

| Phone methods | Feature on the desktop |
|---|---|
| `get-knowledge-status`, `get-knowledge-settings`, `set-knowledge-settings`, `knowledge-query` (read-only tools), `knowledge-compare`, `knowledge-prompt`, `knowledge-index`, `knowledge-index-all`, `knowledge-link-cross-repo`, `knowledge-delete-index`, `knowledge-adr`, `knowledge-ingest-traces` (data, not a file), event `knowledge-changed` (`remote-knowledge.js`); not the Lens, the program, CBM's settings or installer | Node Knowledge tab (section 10c) |
| `get-projects`, `get-active-sessions`, `get-active-terminals`, `get-session-states`, `get-harnesses`, `get-codex-models`, `get-effective-settings`, `get-session-last-message`, `read-session-entries`, `read-session-tail`, `search`, `search-session-ids` | Sessions tab list, state dots, New session form, search, transcript viewer (sections 12, 13, 15) |
| `toggle-star`, `rename-session`, `archive-session`, `stop-session`, `set-session-assignment`, `launch-session` | Star, rename, archive, stop, Move to project, and new, resume and fork (sections 12, 13) |
| `get-session-notices`, `mark-read`, `mark-unread`, `set-viewing` (local) | Unread and needs-you marks shared with the window (sections 12, 21) |
| `list-pending-diffs`, `mcp-diff-response` (local) | IDE emulation diffs answered from a phone (section 20) |
| `attach-terminal`, `detach-terminal`, `fit-terminal`, `unfit-terminal` (local), `terminal-input` | Terminal output and input on a phone (sections 14, 21) |
| `get-project-tree`, `get-projects-root`, `list-templates`, `create-project`, `update-project`, `delete-project`, `create-track`, `update-track`, `delete-track`, `attach-project-folder`, `detach-project-folder` | Projects list, New project, header, Settings tab, Overview tracks (sections 2, 3, 4, 11) |
| `list-folders`, `create-folder` (local) | A folder picker for new projects and attaching, with a New Folder button (sections 3, 21) |
| `get-project-plan`, `set-plan-item` (local), `edit-plan-item` (local), `append-plan-item`, `create-project-file`, `save-project-brief` | Plan and Todos tabs and the Plan and Todos cards (sections 4, 6) |
| `list-recent-project-files`, `list-project-directory`, `read-project-file`, `locate-file`, `read-project-file-chunk`, `upload-project-file-chunk`, `save-project-file`, `manage-project-entry`, `trash-project-entries`, `create-project-entry`, `duplicate-project-entry`, `paste-project-entry`, `get-file-timeline`, `get-file-timeline-diff`, `add-project-file-bytes`, `save-session-attachment`, `search-project-files`, `replace-in-project-files` (all local except `list-recent-project-files`) | Files tab explorer, viewer, download, upload, Timeline, Search and replace, Added Files, attachments to a chat (sections 4, 7) |
| `list-schedules`, `create-schedule`, `update-schedule`, `delete-schedule`, `resolve-schedule-launch`, `run-schedule` (local), `get-schedule-context` | Schedules (section 13) |
| `get-project-git-status`, `get-project-git-info`, `get-project-git-diff`, `stage-project-git-files`, `stage-project-git-lines` | Git Changes and staging (section 8) |
| `get-project-git-graph`, `get-git-graph-commit-detail`, `get-git-graph-compare-detail`, `get-git-graph-file-at-revision`, `get-git-graph-file-diff-between`, `get-git-graph-remotes`, `get-git-graph-tag-details`, `get-git-graph-user-details`, `get-git-graph-repo-config`, `get-git-graph-global-preferences`, `set-git-graph-repo-config`, `set-git-graph-global-preferences`, `trust-git-graph-repo-config`, `export-git-graph-repo-config`, `get-git-graph-avatar-url`, `clear-git-graph-avatar-cache`, `run-git-graph-action` (34 whitelisted actions, `PHONE_ACTIONS`), `cancel-git-graph-action`, `set-git-graph-avatars-gitlab-host`, `create-git-graph-archive` | Git History (section 9) |
| `get-project-worktrees`, `get-worktree-settings`, `set-worktree-settings`, `list-worktree-branches`, `suggest-worktree-path`, `worktree-create`, `worktree-run-post-create`, `worktree-remove`, `worktree-delete-branch`, `worktree-merged`, `worktree-lock`, `worktree-unlock`, `worktree-move`, `worktree-repair`, `worktree-prune-preview`, `worktree-prune`, `worktree-attach`, `worktree-detach`, `list-env-files` | Worktrees (section 10) |
| `get-pull-requests`, `get-pull-requests-page`, `get-pull-request-files`, `run-pull-request-action` (merge, draft, ready, close, reopen only) | Pull Requests (section 10b) |
| `get-pull-request-conversation`, `get-pull-request-commits`, `get-pull-request-commit-files`, `get-pull-request-checks`, `get-pull-request-job-log`, `get-pull-request-viewed`, `get-pull-request-branches`, `get-pull-request-candidates`, `render-pull-request-markdown` | An open pull request's tabs (section 10b) |
| `edit-pull-request` (the kinds of `pull-request-edits.js` only, checked against its own table) | Title, description, base, comments, threads, reactions, reviews, Update branch, Viewed, sidebar, re-runs (section 10b) |
| `list-project-tasks`, `get-task-run`, `start-task`, `stop-task`, `restart-task`, `stop-all-tasks`, `task-input` (local) | Project tasks popover and task log (section 13) |
| `get-process-usage`, `stop-owner`, `kill-owned-process`, `force-stop-owner` | Task Manager (section 18) |
| `get-usage`, `get-codex-usage`, `get-stats`, `get-app-version` | Stats and the version row (sections 17, 19) |

Phone events forwarded: `projects-changed`, `harnesses-changed`, `cli-busy-state`, `terminal-notification`, `process-exited`, `session-detected`, `session-forked`, `project-plan-changed`, `session-notices-changed`, `mcp-open-diff`, `mcp-close-tab`, `mcp-close-all-diffs`, `mcp-diff-resolved`, `task-output`, `task-state-changed`, `git-graph-repo-changed`, `git-graph-action-progress`. Terminal output goes only to the phones attached to that session.

Not exposed to phones on purpose: native dialogs, Finder and reveal, the clipboard, the updater, settings read and write, remote-access control, window and tool-window control, plans and the Files tab, `save-plan`, `save-memory`, `adopt-plan`, `add-project-files`, `get-memories`, the opened and pinned files, `open-file-window`.

---

# Mobile (`apps/mobile`, Expo Router in `src/app`)

The app opens on Sessions and has a bottom tab bar (Projects, Sessions, Stats, Task Manager, Settings) like the desktop strip. It redirects to the pairing screen when no computer is paired.

## `_layout.tsx` (root)

- [ ] Reconnects when the app comes back to the foreground and tells the desktop whether it is in the foreground — `_layout.tsx` (`AppState`, `useConnection`)
- [ ] An attention toast appears while the app is open when a session you are not looking at asks for you, finishes, or wants to change a file (tap opens it) — `components/AttentionToast.tsx`
- [ ] A connection banner shows "Connecting to the computer…" with Retry now and Pair again — `components/ConnectionBanner.tsx`
- [ ] Stack screens: Pair, Task, New session, Session, Project, Choose a folder, Files, File, Timeline, Change, Schedule, Git, Diff, Git Graph, New worktree, Remove worktree, Remove merged, Worktree settings, Worktree folder — `_layout.tsx`

## `pair.tsx` (Pair with a computer)

- [ ] Scan the pairing QR code with the camera — `pair.tsx` ("Scan the pairing code")
- [ ] Or paste a pairing link of the form `switchboard://pair?d=…` and "Use this link" — `pair.tsx`
- [ ] Name this phone, and choose the route to pair through (local network or Internet routes carried in the code) — `pair.tsx` (`RoutePicker`), `remote/pairing.ts`
- [ ] "Scan another code" restarts the scan; pairing checks the protocol version in the handshake — `pair.tsx`, `remote/client.ts`

## `(tabs)/index.tsx` (Sessions)

- [ ] Sessions grouped by folder in sections, with a refresh pull — `(tabs)/index.tsx` (`buildSections`)
- [ ] Filter chips All, Running, Pinned, Today — `(tabs)/index.tsx` (`FILTERS`)
- [ ] Search sessions on the computer by what was said plus titles; the X on a row leaves it out; a bar shows count, "n left out" (restore) and "Stop n running" — `useSessionSearch.ts`, `components/SearchStopBar.tsx`
- [ ] Row shows state (running, needs you, unread, review waiting) — `components/SessionRow.tsx`
- [ ] Tap opens the session (on its project's Session tab on a Surface Duo); long-press opens actions — `(tabs)/index.tsx`, `projects/open-session.ts`
- [ ] Session actions: Rename…, Pin/Unpin, Move to project…, Mark as read/unread, Stop (confirm), Archive/Unarchive (stops first), Remove from its project — `components/SessionActions.tsx`
- [ ] "New" button opens New session — `(tabs)/index.tsx`

## `(tabs)/projects.tsx` (Projects)

- [ ] Project list with Active, Snoozed and Done sections, "No project" folders, numbers on each row, drawers with sessions grouped by Time, Track or State (combo "Group each project's sessions by") — `(tabs)/projects.tsx`, `projects/list-ui.ts`, `projects/drawer.ts`
- [ ] Search projects by name and sessions by content or title, with leave-out and Stop — `(tabs)/projects.tsx`
- [ ] "New" creates a project from a name — `(tabs)/projects.tsx` (`TextPrompt`)
- [ ] Tap a project to open it; tap a session row to open it in its project; "More" and archived toggles per list — `(tabs)/projects.tsx`

## `project/[id]/index.tsx` (Project)

- [ ] Tabs Overview, Session (when a session is open), Plan with `done/total`, Todos with the open count, Files, Git, Settings; each is built on first visit and kept — `project/[id]/index.tsx`, `components/project/ProjectTabBar.tsx`
- [ ] Project ⋯ sheet: New session…, Rename…, New track…, Attach a folder…, Snooze… (presets) / Wake now, Mark as done / Reopen (asks about running work), Settings, Remove project… — `project/[id]/index.tsx` (`projectOptions`), `projects/flows.ts`
- [ ] Remove project… (sheet and Settings) asks for the word delete to be typed before Remove works — `components/project/RemoveProjectPrompt.tsx`, `projects/settings.ts` (`isRemoveProjectWord`)
- [ ] Overview: a section per track (⋯ sheet: New session here…, Rename…, Mark as done / Reopen, Delete track…), Other sessions, Schedules (New, and per schedule Run now, Edit…, Pause / Resume, Delete…), Files (project folder and each attached folder), Attach a folder… — `components/project/tabs/OverviewTab.tsx`
- [ ] Plan: phases and items with tick, long-press for "Start a session on this" and Edit…, "Add to the plan…"; Todos: the todos, the same way, with "Add a todo…" — `components/project/tabs/PlanTab.tsx` (`part`), `components/project/PlanSection.tsx`
- [ ] Files: tree per root with New file, New folder, Paste, Collapse folders, and per-entry Open, Open in Terminal, Add file to Chat / New Chat, Open Timeline, Cut, Copy, Paste, Copy Path, Copy Relative Path, Rename…, Duplicate, Download, Delete; per folder Upload Files… and Upload Photos… (several at once, Replace or Keep Both for names already there); Enable Selection in the folder's ⋯ for Download N Selected… (into a folder picked on the phone, ticked folders with what is in them) and Delete N Selected… — `components/project/tabs/FilesTab.tsx`, `files/download.ts`, `files/upload.ts`
- [ ] Git: Changes (branch, changes, latest commits), History (a Git Graph link per folder), Worktrees view, Pull Requests view ("PRs") — `components/project/tabs/GitTab.tsx`, `components/project/tabs/WorktreesTab.tsx`, `components/project/tabs/PullRequestsTab.tsx`
- [ ] Settings: Name, Project folder, Sessions start in, Folders (Show in Files, Copy path, Detach…), Worktree branch and "Same in every repo", Tracks (rename, folder, CLI, Done/Reopen, Delete…), Wake now, Mark as done, Remove project… — `components/project/tabs/SettingsTab.tsx`
- [ ] Session tab: Chat or Terminal view of the open session, with Split screen, and the project actions in its ⋯ — `components/project/tabs/SessionTab.tsx`, `session/[id].tsx`

## `session/[id].tsx` and the session components

- [ ] Chat view: Markdown messages, tool rows with diffs, commands, read results and approval state, thinking rows, images with a viewer, plan card ("Open plan", approval status), long-press to copy, file references that open the file — `components/ChatView.tsx`, `components/chat/*`
- [ ] Composer for chat: message field, attachments (photo library, camera, file) saved on the desktop, send, and "Tap ✕ to interrupt" — `components/composer/*`, `sessions/attachments.ts`
- [ ] Terminal view with a composer, special keys ("More keys"), and fit-to-phone — `components/TerminalView.tsx`, `components/composer/TerminalKeys.tsx`
- [ ] A session that is not running offers Resume, "Resume with options…" and Fork; a finished terminal says so — `components/session/NotRunningCard.tsx`
- [ ] Split screen puts chat on the left and terminal on the right; "One screen" returns — `session/[id].tsx`
- [ ] Session header with state and the Chat / Terminal switch — `components/session/SessionHeader.tsx`

## `new.tsx` (New session)

- [ ] Choose where (project, track, folder or worktree), the CLI (enabled CLIs and Terminal), an optional first message, and options (same fields as the desktop form) — `new.tsx`, `components/OptionsForm.tsx`, `sessions/options.ts`
- [ ] Resume and fork reuse this screen with resume options — `new.tsx`

## `schedule.tsx`

- [ ] Create or edit a schedule: name, prompt, every (15 min, 30 min, hourly, daily, weekdays, weekly), time or minute, weekday, track, CLI; a note says it runs while the desktop app is open — `schedule.tsx`

## `folders.tsx`, `files.tsx`, `file.tsx`, `timeline.tsx`, `file-diff.tsx`

- [ ] Folder picker on the computer to attach a folder (in place or as a new worktree with an optional branch), with "New folder" — `folders.tsx`
- [ ] Browse a folder, open a viewable file (text, Markdown, images), with a download bar for any file — `files.tsx`, `file.tsx`, `components/files/FileView.tsx`, `files/download.ts`
- [ ] Files and Git lists show file-type icons — `components/files/FileIcon.tsx`, `files/icon-theme.generated.ts`
- [ ] Search across the project's files with replace, from the Files tab — `components/files/SearchPanel.tsx`, `files/search.ts`, `components/project/tabs/FilesTab.tsx`
- [ ] Timeline of a file or folder, with a change opening a diff — `timeline.tsx`, `file-diff.tsx`

## `git.tsx`, `diff.tsx`, `graph.tsx`

- [ ] Git changes per repository with the Git Graph link, changed files that open a diff, and latest commits — `git.tsx`, `diff.tsx`
- [ ] Stage and unstage files, hunks and lines, split into Staged and Unstaged — `git.tsx`, `diff.tsx`, `git/staging.ts`, `git/stage-requests.ts`
- [ ] Git Graph: lanes and commits, tap a commit for details (`components/git/CommitDetails.tsx`) and actions, toolbar sheet (fetch all remotes, review changes) — `graph.tsx`, `git/graph.ts`
- [ ] Graph actions: stash push, discard changes, delete untracked files, stash apply/pop/new branch/drop, check out branch, merge, rebase, rename, delete, push, pull, delete remote branch, push or delete tag, check out commit, new branch or tag here, cherry-pick, revert, reset (keep or discard), drop commit — `git/actions.ts`

## `worktrees/*`

- [ ] Worktrees list per repository with New worktree, Remove merged, Prune, Folder actions, Worktree settings, per-worktree sheet (New session…, Show in Files, Show in Git, Show in the Git Graph, Attach/Detach, Lock…, Unlock, Move…, Repair, Remove…) — `components/project/tabs/WorktreesTab.tsx`
- [ ] New worktree (check out new, existing, remote or detached, folder, files to copy, then open), Remove worktree (with branch delete), Remove merged, Worktree settings, Worktree folder (move or repair a moved folder) — `worktrees/new.tsx`, `worktrees/remove.tsx`, `worktrees/merged.tsx`, `worktrees/settings.tsx`, `worktrees/folder.tsx`

## `pulls/*`

- [ ] Pull Requests view per repository (chips): every open one, drafts too, newest first; filter sheet Open, Draft, Closed, Merged with "Load 10 more" for closed and merged; Remote sheet with more than one GitHub remote; a row opens on its files, as a tree at first or as a list, every diff closed, with four icons (Expand all, Collapse all, View as tree, View as list) whose names a long press shows; before Merge four icons: Copy the address, Open here (a sheet with the GitHub page in a web view, with Back, Forward, Reload, the address, Copy, Open in a window, the browser and Close), Open in a window of its own (Android's windows in DeX or on a tablet, else full screen) and the browser inside the app (expo-web-browser), on closed and merged ones too; Merge (off with the reason) and ⋯ with Convert to draft or Ready for review, Change base (a desktop with `edit-pull-request`) and Close, Reopen on a closed one, each asked first; "Update Switchboard Evolution on the computer" when the desktop lacks it. With a desktop that has `get-pull-request-conversation` a row opens the pull request's screen instead of its files — `components/project/tabs/PullRequestsTab.tsx`, `components/pulls/PullRequestFiles.tsx`, `components/pulls/PullRequestWebPage.tsx`, `app/pulls/web.tsx`, `app/pulls/web-full.tsx`, `pulls/web.ts`, `pulls/model.ts`, `pulls/queries.ts`
- [ ] Merge pull request: merge method (only the repository's), Delete the branch after merging, warnings for checks and review, then a confirmation — `pulls/merge.tsx`
- [ ] A pull request's screen: the title (a pencil edits it where GitHub allows), number, author, branches, badges, Merge, Review and a ⋯ with Edit description, Change base, Draft or Ready, Close or Reopen, Copy the address and the browser; a notice line; four tabs with their counts (the last one chosen kept while the app runs): Conversation (the sidebar with Reviewers, Assignees, Labels and a gear to change them, the description and every message in Markdown with reactions and a ⋯ with Copy link, Quote reply, Edit, Hide or Unhide, Open on GitHub, Delete; review threads with the end of their hunk, Reply and Resolve; commits and events; Load more; the box with Update branch; Write a comment), Commits (by day, each opening on its message, its page and its files), Checks (by workflow, the latest of each, Details, the end of a finished job's log in a box that scrolls and opens at its end, Re-run, Re-run failed; read again every 15 seconds while one runs), Files changed (with Viewed); pull to read it all again — `app/pulls/[number].tsx`, `components/pulls/PullRequestDetail.tsx`, `components/pulls/PullRequestFiles.tsx`, `pulls/model.ts`, `pulls/queries.ts`
- [ ] Writing on a pull request: a comment (with Close or Reopen with comment where allowed), a reply, an edit of the description or of a comment, with Write and Preview, the text kept as a draft until sent; Change base (branches searched as one types, the default first, GitHub's warning before); Review (Comment, Approve, Request changes, the last two off on one's own); a sidebar section (checkboxes from the repository, saved together; the pull request's author is not offered as a reviewer) — `app/pulls/edit.tsx`, `app/pulls/base.tsx`, `app/pulls/review.tsx`, `app/pulls/side.tsx`

## Node Knowledge

- [ ] The Node Knowledge tab after Git when the computer offers `knowledge-query` (and in a window of its own): Overview (each folder with Index or Refresh, languages, hotspots, entry points, packages), Search (Symbols or Code, By meaning), Trace (a graph with react-native-svg that opens one node at a time, with Read code and Trace from here, or a list by hop; the modes in a sheet), Impact (Uncommitted, Branch vs base, Since a ref; tests), Query (examples and saved queries in a sheet, results sideways), ADR (Markdown, Start one, Edit with a byte count), Coverage, Compare (two folders), Settings (the switches, how much to read, tools in the sessions, per folder Share, Re-index, Delete graph…, Link now, the agents); no Lens — `components/project/tabs/KnowledgeTab.tsx`, `components/knowledge/views.tsx`, `components/knowledge/TraceGraph.tsx`, `knowledge/queries.ts`, `knowledge/model.ts`
- [ ] A symbol's screen: kind, file and lines, Called by and Calls (each name opens its own), the code with line numbers; an ambiguous name offers the candidates — `app/knowledge/symbol.tsx`

## `ide-diff.tsx`

- [ ] Review a change a session proposes to a file and Accept or Reject it; "Already answered" when the window or another phone answered first — `ide-diff.tsx`

## `task-log.tsx`

- [ ] See a project task's log with Stop and Restart — `task-log.tsx`

## `(tabs)/stats.tsx`

- [ ] Claude and Codex rate-limit bars with percent and reset, and Claude activity (messages per day) — `(tabs)/stats.tsx`

## `(tabs)/processes.tsx` (Task Manager)

- [ ] RAM by session or task, expandable to processes, with Open, Stop (confirm), Force kill, per-process Kill, refresh interval by platform, and a note when the desktop is too old — `(tabs)/processes.tsx`

## `(tabs)/settings.tsx`

- [ ] Shows the desktop's version, this phone's name on the computer, addresses and port, and the pairing date; Reconnect now, Pair again, Forget this computer (confirm) — `(tabs)/settings.tsx`

---

# Open questions

1. **Session snooze.** The brief lists "snooze" under the Sessions tab. In the code, snooze exists only for projects (menu, shelf, wake timer; `snooze.js`). No session-level snooze was found on desktop or mobile. Is project snooze the whole requirement?
2. **Where Plans, Agent Files and Stats live.** Upstream hides them behind a "More" button; master shows them as strip tabs. The list follows master. Keep the strip, or bring the More menu back?
3. **What's New dialog.** It still announces the old "New Project View" with screenshots of the pane layout that master replaced with the drawer and Session tab. Rewrite it, replace the images, or drop it?
4. **Slack link.** Upstream's "Join Slack" status-bar link is gone on master. Assumed intentional and not to return.
5. **Tab tooltips and pop-out.** Only Stats and Task Manager have pop-out buttons. Project windows are opened from the project's own tab buttons instead. Is that split the intended design?
6. **Session tab in a window of its own.** Project windows exclude the Session tab on purpose (terminals live in the main window). Confirm the rewrite keeps this.
7. **Folder settings versus project settings.** A folder's gear in the Sessions tab opens "Folder Settings"; a project has a separate Settings tab. Are both needed after the rewrite, and should the Sessions tab keep folder-level scheduling and task buttons?
8. **Claude worktrees in the Sessions tab.** Nested `.claude/worktrees/` groups and the new Worktrees tab both exist. Keep both?
9. **Terminal engine.** The renderer shows both engines (herdr-core and inside the app) and relies on main re-attaching sessions at start. Is herdr-core still the default for the rewrite, and is the "Now: …" status text required?
10. **Legacy folder flow.** "Add Folder" in the Sessions tab (path box and Browse) and `add-project`, `browse-folder` predate Projects. Needed, or covered by New project and Attach folder?
11. **Git Graph shortcuts.** Cmd/Ctrl+H and Cmd/Ctrl+S in History are page-local and could collide with global shortcuts in the new shell.
12. **Classification doubts, tagged `(master?)`.** The avatars line: `git-graph-avatars.js` is new on master, but `main` has some avatar-related text, so the split is not certain. Lines that mix upstream and master parts (for example the Git Graph menus, where the copy items exist on `main` and everything else is master) are tagged master with the upstream part named in the line.
13. **Master commits that cherry-pick upstream ones.** `git log main..master` lists some commits whose content is already on `main` (for example Custom Arguments, "Open in default app", the title-bar fix) because the histories diverged. They were decided by file contents, not by the log, and are untagged.
14. **Phone methods with no direct call in the mobile source.** A text search of `apps/mobile/src` found no call to: `add-project-file-bytes`, `clear-git-graph-avatar-cache`, `create-git-graph-archive`, `create-project-file`, `export-git-graph-repo-config`, `get-active-sessions`, `get-active-terminals`, `get-app-version`, `get-codex-models`, `get-git-graph-avatar-url`, `get-git-graph-file-at-revision`, `get-git-graph-repo-config`, `get-git-graph-tag-details`, `get-git-graph-user-details`, `get-projects-root`, `get-schedule-context`, `get-session-last-message`, `get-worktree-settings`, `list-recent-project-files`, `list-schedules`, `list-templates`, `resolve-schedule-launch`, `save-project-brief`, `set-git-graph-avatars-gitlab-host`, `set-git-graph-global-preferences`, `set-git-graph-repo-config`, `start-task`, `stop-all-tasks`, `task-input`, `trust-git-graph-repo-config`. Some may be called through computed names. They are still allowed on the desktop, so the rewrite must keep them working; decide whether the mobile app should use them.
15. **Mobile coverage of the desktop.** Mobile has no equivalent of: Git Graph repository settings and dialogs beyond the listed actions, Plans and Files tabs, grid view, tool windows, remote-access setup, global settings. Confirm these stay desktop-only.
16. **Transcript viewer on the phone.** The desktop's JSONL viewer and the mobile chat view render the same data differently (the desktop reads `read-session-jsonl`, the phone `read-session-entries` and `read-session-tail`). Confirm both must show tool results, images and plan cards at parity.
17. **Branding.** The window title uses the product name, while data names stay `switchboard` (data folder, `switchboard://` links, `SWITCHBOARD_*` variables). Confirm the new UI keeps showing "Switchboard" in the places that quote those names (for example "Switchboard" in settings text and the "not in Switchboard any more" note).
