# Switchboard Evolution compared with Switchboard

`apps/desktop` started from [Switchboard](https://github.com/doctly/switchboard) by Doctly and still contains all of it: every upstream commit up to `e594fa9` (Switchboard 0.0.37) is in, as is or adapted, and the [Upstream sync](../.github/workflows/upstream-sync.yml) workflow brings in the later ones. This page lists what Switchboard Evolution adds on top, as of version 1.11.0 (November 2026).

## At a glance

| | |
|---|---|
| Features and fixes of its own | about 120 |
| Window ↔ main process channels (IPC) | 169, of which **71 exist only in Evolution** (upstream has 98) |
| Methods a phone can call | 130 (upstream has no phone access) |
| Desktop test files | over 100 (upstream has 50) |
| Mobile app | 27 screens, 47 test files |
| Offered upstream | 3 merged pull requests, 8 open (see [Upstream](../README.md#upstream)) |

To see the size of the difference today, from the root of this repository:

```bash
git diff --shortstat e594fa9 HEAD:apps/desktop
```

## The name

| When | Name | What happened |
|---|---|---|
| 30 Sep 2026 | (a branch of the fork) | First work: the full Git Graph inside a project tab. |
| 1–4 Nov | Fork 1.x | Phone access, Internet tunnels, a version of its own, kept in step with the mobile app. |
| 13 Nov | OmniboardV 1.5.0 to 1.6.5 | An app of its own: own name, app id and icon. It installs next to the official Switchboard. |
| 16 Nov | **Switchboard Evolution** 1.6.6 | The final name, and this monorepo with the desktop and the mobile app. |
| 20 Nov | Switchboard Evolution 1.7.0 | One version for the desktop and the phone app, and the repository goes public. |
| 20 Nov | Switchboard Evolution 1.8.0 | A Note for each project, text size in the editor, the RAM of each session on its row, and tabs in a project's window. |
| 21 Nov | Switchboard Evolution 1.9.0 | New icons for both apps: the computer's terminal with the phone in front of it. In the phone's Files tab, upload several files from the phone, and download several ticked files and folders at once. |
| 22 Nov | Switchboard Evolution 1.9.1 | OpenCode as the third CLI, beside Claude Code and Codex, on the desktop and the phone. A project's plan and its todos on two tabs of their own. |
| 22 Nov | Switchboard Evolution 1.10.0 | The sidebar's Agent Files tab becomes Files: drop any file on the sidebar to open it there or in a window of its own, and pin files at the top. |
| 23 Nov | Switchboard Evolution 1.11.0 | A Pull Requests view in the Git tab, on the desktop and the phone: every open pull request with its files and diffs, merge, draft, ready and close. The app carries the GitHub CLI for a computer without one. |

What "an app of its own" means:

- App id `io.github.vivi7.switchboard-e`, installed as `Switchboard Evolution.app`. Phones pair through the `switchboard-e://` scheme.
- It runs next to the official Switchboard. Both can be open at once and share `~/.switchboard` (projects, session index), while their window settings stay apart.
- It has no auto-update feed, so an official release never replaces it.
- Its version is its own (1.11.0, the same for the desktop and the phone app), far from upstream's 0.0.x. Upstream's build workflow exists only on `main`, so a tag on `master` never starts it.
- At its first start it copies OmniboardV's settings.

## What it adds, by area

### 1. The phone as a second seat (mobile app and remote access)

- A remote-access server with an encrypted protocol (tweetnacl). Pairing uses a QR code that works once and for two minutes. Paired devices are listed with their state and can be removed.
- The phone sees and drives terminals: it starts Claude, Codex or OpenCode sessions, types, fits the terminal to its screen, attaches files and photos, and reads the tail of a long conversation.
- Unread and needs-you marks are shared between window and phone. A session open on the phone counts as seen.
- Projects, plans, todos, schedules and files work from the phone: upload, rename, trash, a safe save that refuses if the file changed meanwhile, and download of any file.
- The Git Graph with all its actions, worktrees, pull requests, project tasks, the Task Manager, search and replace, and staging also work from the phone.
- IDE diffs can be answered from the phone. The first answer wins, and the window says the phone answered.
- Internet access goes through Cloudflare or ngrok tunnels, set up from the devices dialog. Secrets are encrypted with the system keychain, and only a phone holding the access key gets in through a tunnel.
- With remote access on, closing the window only hides it and sessions keep running. The computer stays awake while a session works.

### 2. Sessions that survive quitting

- The **herdr-core** terminal engine: sessions keep running when the app quits and re-attach at the next start. It is chosen in Settings ("Terminal Engine").
- "Quit and Stop All Sessions…" stops everything when you want to. A note says when a kept session lost its IDE server.
- The Claude session Switchboard Evolution was started from stays out of new sessions.

### 3. Git

- **History is a full Git Graph**, on par with the VS Code Git Graph extension:
  - menus for commits, local and remote branches, tags and stashes
  - checkout, cherry-pick, revert, drop, merge, rebase (interactive in a terminal too), reset, zip/tar archives
  - remotes (add, edit, delete, fetch with prune) and user details
  - repository settings and global preferences
  - avatars, issue links and Markdown in messages
  - commit details under the row or beside the graph, with a Code Review mode
  - every action runs through one whitelisted dispatcher, shows a spinner and can be retried after a failure
- **Compare 2–4 commits** step by step (A→B, B→C, …), in a popup or a window of its own, with a tree view and commit titles.
- **Staging** of files, folders, single hunks or chosen lines. A diff that changed meanwhile is refused and reloaded.
- One tab per repository of the project, in Changes and History, with the repository path under the tab.
- **Worktrees**:
  - a list with state, ahead/behind and running sessions
  - a guided New worktree (new, existing or remote branch, folder, local files to copy, a command after creating)
  - Lock, Move, Repair, Prune, "Remove merged…"
  - new sessions started right in a worktree
- **Pull Requests**, through the GitHub CLI (`gh`): the one installed on the computer, or the one every build carries when there is none:
  - one tab per repository; every open pull request, drafts too, newest first
  - a filter for Open, Draft, Closed and Merged; closed and merged ones 10 at a time
  - a row opens on its changed files and their diffs
  - Merge (the repository's merge methods, the branch deleted on GitHub if you want), Convert to draft, Ready for review and Close, each asked first; the local checkout is never touched

### 4. Files

- An explorer for the project folder and each attached folder:
  - VS Code-style actions and shortcuts: new, duplicate, copy, cut, paste, rename, trash, copy path
  - Open to the Side, Open With…, a file's commit Timeline, and comparing two files
  - "Add file to Chat" hands a file to a session
- File-type icons from Material Icon Theme, in the Git lists too.
- A project-wide **Search** view (case, whole word, regex, include and exclude globs). **Replace** works in one file or all files, with a preview, and keeps open editor edits safe.
- Find and replace in the editor (CodeMirror). The editor bundles only the languages it highlights: 1.67 MB down to 0.98 MB.
- Multi-select with one-step trash; Expand All and Collapse All.
- In the viewer toolbar: Share (the macOS share menu), Reveal in Finder, Open in default app, and A− / A+ for the text size of the editor and the Markdown preview (on the phone too).
- The sidebar's **Files** tab (Agent Files upstream): the agent files and any file dropped on the sidebar from any tab. The drop zone has two halves: open the file here, in the tab's editor, or in a window of its own. A filter shows All, Agent files or Opened files; any file can be pinned at the top, in an order changed by dragging, and stays in sight with every filter. An opened file can be taken off the list.

### 5. Projects and sessions

- Each project has a drawer with its sessions, grouped by time, track or state. A **Session** tab holds a terminal, a transcript or a task log under the project header.
- Numbers on each project row: plan done/total, open todos, tracks, sessions.
- Search in the Projects tab finds sessions too. A "No project" row gathers sessions no project claims. An X leaves a result out of the search, and "Stop n running" stops the sessions found.
- Rename from the session menu; a live terminal keeps its name and star across refreshes.
- Attached folders can be detached from the Overview card (with an offer to remove the worktree) and trusted for Claude Code once.
- At start, the project of the reopened session opens.
- A **Note** for each project (its `note.md`, made when first opened), from the project's header and menu: the file editor in a panel floating over the app, moved and resized, that opens again where it was left and saves itself as you type. It can move to a window of its own (on the phone: a DeX or tablet window).

### 6. Task Manager and resources

- A Task Manager with the RAM each session and task uses, and the processes inside them, with Kill and Force kill. Memory and disk rings show the space each project takes.
- RAM and disk in the status bar, turning amber and then red near their limits.
- Each live session's RAM on its row, under its star and archive button, amber from 1 GB and red from 2 GB as in the Task Manager.

### 7. Windows

- One strip of sidebar tabs: Projects, Sessions, Plans, Files, Stats, Task Manager, Settings.
- Stats and the Task Manager open in windows of their own, with a pin that keeps them on top.
- Every project tab (Overview, Plan, Todos, Files, Git, Settings) can open in a window of its own, whose header has the other tabs to move it to one of them (on the phone too). Open windows come back at the next start.

### 8. Under the hood

- One broadcaster for main-process events serves both the window and the phones.
- Indexing, transcript reading and file search run in workers, off the main thread.
- The auto-updater turns off in builds without an update feed. Settings migrate between app names.

## Coming next

A new interface (React, TypeScript, Vite), a new brand, light and dark themes, and a data folder of its own with an import from Switchboard. [parity.md](parity.md) lists the features, over 300, that the redesign must keep.

## Offered upstream

| Pull request | State | What it brings |
|---|---|---|
| [#98](https://github.com/doctly/switchboard/pull/98) | merged | List/tree toggle in the Git tab's Changes |
| [#99](https://github.com/doctly/switchboard/pull/99) | merged | Read-only repository history in the Git tab |
| [#109](https://github.com/doctly/switchboard/pull/109) | merged | The window no longer slides up under the title bar |
| [#105](https://github.com/doctly/switchboard/pull/105) | open | Reveal in Finder in the file viewer |
| [#106](https://github.com/doctly/switchboard/pull/106) | open | Rename in the session menu |
| [#107](https://github.com/doctly/switchboard/pull/107) | open | Worktrees tab |
| [#108](https://github.com/doctly/switchboard/pull/108) | open | Detach attached folders from the Overview card |
| [#110](https://github.com/doctly/switchboard/pull/110) | open | A commit's details under its row in History |
| [#111](https://github.com/doctly/switchboard/pull/111) | open | Keep the session Switchboard was started from out of new sessions |
| [#112](https://github.com/doctly/switchboard/pull/112) | open | Share button in the file viewer |
| [#113](https://github.com/doctly/switchboard/pull/113) | open | Task Manager with each session's RAM |

Not offered yet: phone access and the mobile app, herdr-core, the Git Graph actions, the Files explorer with search and replace, staging, commit compare, separate windows, the resource bar.
