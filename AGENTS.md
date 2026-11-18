# Switchboard Evolution

Desktop and mobile apps for running and managing coding-agent sessions (Claude Code, Codex) across projects.

```
apps/desktop     Electron app (main process at the root of the folder, renderer in public/)
apps/mobile      Expo app, the desktop's companion over Tailscale (its own AGENTS.md has the Expo rules)
packages/shared  modules both apps use, copied into them by scripts/sync-shared.mjs
```

The desktop app started from Switchboard (doctly/switchboard), with its own features on top, and the mobile app from switchboard-mobile.

- Upstream `main` is recorded in the history as merged into `apps/desktop` (merge of e594fa9).
- `scripts/upstream-sync.sh` brings in later upstream commits with a subtree merge (`git merge -X subtree=apps/desktop`). The weekly `.github/workflows/upstream-sync.yml` runs it and opens a pull request, or an issue when there are conflicts.
- Changes for Doctly go as pull requests from the fork vivi7/switchboard, whose `main` stays identical to upstream; see the README, "Upstream".
- switchboard-mobile has no link in the history: its commits are carried over with `git am --directory=apps/mobile`.

## Rules

- Treat everything here as public. Never commit tailnet addresses, hostnames, tokens, pairing codes, real project names, paths of a real machine or other personal data, in code, tests or docs.
- The logic of the desktop app is proven and covered by its tests: move it and connect it differently, but keep its behaviour unless a change asks for it, and keep `apps/desktop/test` passing.
- Change the shared modules in `packages/shared`, then run `npm run sync-shared`. Never edit the copies in `apps/desktop/public/`, `apps/desktop/remote-protocol.js` or `apps/mobile/src/shared/vendor/`.
- Keep the mobile app's TypeScript types in step with the desktop's remote API (`apps/desktop/remote-api.js`) and the protocol version checked in the `hello` handshake.
- Some names are data or protocol values and stay as they are until a change moves them on purpose: the `~/.switchboard` data folder, `SWITCHBOARD_DATA_DIR`, the `'switchboard'` worktree kind, `usage.switchboard`, and the `<!-- switchboard:managed -->` block in project files. Pairing links use `switchboard-e://` (since 1.6.6); the phone app still reads the old `switchboard://` ones.
- Run the desktop against a data folder of its own, never the real one: `npm run electron-dev` in `apps/desktop` (it sets `SWITCHBOARD_DATA_DIR=~/.switchboard-dev`, which also keeps it apart from an installed Switchboard Evolution).

## Commands

At the root:

```bash
npm test             # shared copies up to date, desktop tests (node --test), mobile tests (jest)
npm run typecheck    # mobile
npm run lint         # mobile
npm run sync-shared  # copy packages/shared into both apps
```

Each app installs its own dependencies (`npm ci` in `apps/desktop` and in `apps/mobile`): electron-builder and the desktop's native modules, and Metro, each expect their own `node_modules`.

Run the tests, the typecheck and the lint before declaring a task done.
