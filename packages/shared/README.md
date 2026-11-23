# @switchboard-e/shared

Modules both apps use, written once here:

- `remote-protocol.js`: the phone handshake and encryption.
- `session-config.js`: the options of a new session.
- `plan-parser.js`: `plan-tracker.md` and `todos.md` as data.
- `snooze.js`: snooze times.
- `git-graph-layout.js`: the lanes of the Git graph.
- `git-diff-model.js`, `text-search.js`, `file-icons.js`: staging part of a diff, find and replace, file icons.
- `usage-chart.js`: the Task Manager's memory and disk rings and the status bar's RAM and disk line.
- `file-selection.js`: ticking files in the Files tab and trashing them together.
- `git-change-actions.js`: discarding changes and adding to `.gitignore` from the Git tab's Changes, with the dialog texts.
- `star-tints.js`: the color of each pinned session's star.
- `donate.js`: the amounts of the donation box and the PayPal page each one opens.
- `knowledge-model.js`: the Node Knowledge tab's view of codebase-memory-mcp's answers (tables, symbols, the trace tree and its layout, impact, architecture, comparison).

Each one runs as a classic browser script, a CommonJS module and an ES import, so for now the apps keep a copy:
the desktop in `public/` (and `remote-protocol.js` at its root), the mobile app in `src/shared/vendor/` with the
`.d.ts` files. Change them here, then run `npm run sync-shared` at the repository root; `npm run check-shared` fails
when a copy is out of date.
