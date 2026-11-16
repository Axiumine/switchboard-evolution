@AGENTS.md

# Switchboard Evolution mobile

Companion app for the Switchboard Evolution desktop app (`../desktop`, an Electron app). It talks to the desktop's remote-access API over the user's Tailscale network. Since 1.6.6 it is named Switchboard Evolution with its own ids (io.github.vivi7.switchboard_e on Android, io.github.vivi7.switchboard-e on iOS) and the `switchboard-e://` scheme; its new look comes with phase 71 of the plan.

- Treat this code as public. Never commit tailnet addresses, hostnames, tokens, pairing codes or other personal data. The desktop address only ever comes from the pairing QR code at runtime.
- The wire protocol is defined by the desktop side (`remote-api.js` in `../desktop`). Keep the TypeScript types in this app in step with it, and check the protocol version in the `hello` handshake.
- Modules shared with the desktop (`remote-protocol.js`, `session-config.js`, `plan-parser.js`, `snooze.js`, `git-graph-layout.js` and their `.d.ts`) live in `../../packages/shared`; `npm run sync-shared` copies them into `src/shared/vendor/`. Do not edit the copies by hand.
- Run `npm run typecheck` and `npm run lint` before declaring a task done.
