# @switchboard-e/shared

Modules both apps use, written once here:

- `remote-protocol.js`: the phone handshake and encryption.
- `session-config.js`: the options of a new session.
- `plan-parser.js`: `plan-tracker.md` and `todos.md` as data.
- `snooze.js`: snooze times.
- `git-graph-layout.js`: the lanes of the Git graph.

Each one runs as a classic browser script, a CommonJS module and an ES import, so for now the apps keep a copy:
the desktop in `public/` (and `remote-protocol.js` at its root), the mobile app in `src/shared/vendor/` with the
`.d.ts` files. Change them here, then run `npm run sync-shared` at the repository root; `npm run check-shared` fails
when a copy is out of date.
