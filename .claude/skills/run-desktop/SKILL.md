---
name: run-desktop
description: Launch and drive the desktop app (apps/desktop, Electron) to see a change working, click through it, read its state and take screenshots, against the dev data folder. Use when asked to run, start, try or screenshot the desktop app, or to check a desktop change in the real app rather than in the tests.
---

# Run and drive the desktop app

`drive.sh` starts `driver.mjs` in tmux: a REPL that launches the Electron app
with Playwright and takes one command per line. The app always runs against
`~/.switchboard-dev` (or `SWITCHBOARD_DATA_DIR`), as `npm run electron-dev`
does, never against the real data folder.

Needs: `npm ci` done in `apps/desktop`, `tmux`, `node`. The first `start`
installs `playwright-core` in `~/.cache/switchboard-desktop-driver`, outside
the repository (it is not a dependency of the app). On Linux without a
display it runs under `xvfb-run` (install xvfb and Chromium's libraries).

```bash
D=.claude/skills/run-desktop/drive.sh   # from the repository root
$D start                               # driver ready
$D send launch                         # the app's window, sidebar loaded
$D send dismiss                        # a fresh data folder shows "What's new"
$D send "tab memory"                   # sidebar tabs: projects, sessions, plans, memory (Files), stats
$D send "ss files-tab"                 # prints the PNG's path: read it to look
$D send 'eval activeTab'               # any expression, await allowed, JSON back
$D stop
```

## Commands

| Command | Does |
|---|---|
| `launch` | start the app, wait for the sidebar |
| `dismiss` | close the "What's new" dialog |
| `tab <name>` | click a sidebar tab by its `data-tab` |
| `wins` / `use <n>` | list the windows / act on window n (0 is the main one) |
| `ss [name]` | screenshot of the current window, in `$($D where)/shots` |
| `click <selector>` | click through the DOM |
| `eval <expression>` | evaluate in the current window; the renderer's scripts are classic scripts, so their globals (`activeTab`, `cachedOpenedFiles`, `openFileHere`…) are reachable |
| `dialogs accept\|dismiss` | answer to `alert`/`confirm`/`prompt`; each is printed |
| `wait <ms>` | pause |
| `quit` | close the app (`stop` does it too) |

The main process's output and every window's console go to
`$($D where)/app.log`: look there after something fails.

## Gotchas

- **Look at the screenshots.** A command that answers OK proves little; the PNG shows the page.
- **Dialogs are dismissed by default.** Playwright would dismiss them silently, so `confirm()` answers false. The driver prints each one; send `dialogs accept` before an action whose confirmation must pass.
- **Real data shows up.** The Files tab and the Plans tab read `~/.claude` of the machine, so screenshots can show real project names and paths. Keep them local: never commit or publish them (the repository is public).
- **A drop from outside the app cannot be synthesised fully.** A `File` made in the page has no path on disk (`window.api.getPathForFile` gives `''`). To see the sidebar's drop zone, dispatch drag events with a `DataTransfer` holding a `File`; to test what a drop does, call the function the drop calls:
  ```bash
  $D send 'eval (() => { const dt = new DataTransfer(); dt.items.add(new File(["x"], "demo.txt")); const s = document.getElementById("sidebar"), r = s.getBoundingClientRect(); for (const t of ["dragenter", "dragover"]) s.dispatchEvent(new DragEvent(t, { dataTransfer: dt, clientX: r.left + 80, clientY: r.top + 200, bubbles: true, cancelable: true })); return !document.getElementById("sidebar-drop-overlay").hidden; })()'
  $D send "eval openDroppedFiles(['/tmp/demo/notes.md'], 'here')"   # or 'window'
  ```
  A real drag from Finder still needs a person (or computer use).
- **Windows opened later** (a file's window, Stats, a project tab) show up in `wins`; `use` them, and `use 0` to come back.
- **Leave the dev data as you found it.** Undo what a test added (opened files, pins, filters) before `stop`, or say what is left.
