# Switchboard Evolution (mobile)

The phone companion of Switchboard Evolution, a fork of [Switchboard](https://github.com/doctly/switchboard): browse and manage your Claude Code, Codex and OpenCode sessions and projects from your phone.

The app talks directly to the Switchboard Evolution desktop app running on your computer, over your local network or your own [Tailscale](https://tailscale.com/) network. There is no cloud relay and no account: the phone and the computer only ever talk to each other, and every message between them is encrypted end to end.

> **Status:** early development. The remote-access server it needs is not in a Switchboard release yet.

## What it does today

- Pairs with a computer by scanning the QR code from Switchboard Evolution's **Mobile app access** dialog. It is a separate app from the earlier Switchboard Mobile: install it next to that one and pair again.
- Lists every session, grouped by folder, newest first, with its live state: working, waiting for you, unread, running. Unread and waiting-for-you are the same marks the desktop shows: opening a session on the phone reads it on the computer too.
- Searches what was said in your sessions, and filters to running, pinned or today's sessions.
- Opens a session as a **chat** (the conversation, with tool calls you can expand) or as a **live terminal** (xterm.js), with keys a phone keyboard lacks (Esc, Tab, arrows, Ctrl-C, Shift+Enter) and a line to type into.
- **Fit to phone** resizes the session's terminal to the phone while you look at it; the computer gets its own size back when you leave.
- Starts a new Claude, Codex, OpenCode or terminal session in a project, track or folder, with a first message and the same options as the desktop; resumes (with or without changed options) and forks (not OpenCode sessions yet).
- Renames, pins, moves to a project, marks as read or unread, archives or stops a session (long-press a row).
- Tells you, while the app is open, when another session needs you or finishes its turn.
- **Projects**: active, snoozed and done; a project's plan and todos to tick, add to and start a session on; its tracks, sessions, schedules (run now, pause, edit) and folders; snooze, finish, rename, add tracks and attach folders, in place or as a worktree (from the ⋯ of a project, or by long-pressing it in the list).
- **Files**: browse a project's folders with file-type icons, read and edit text and Markdown, look at images, and search and replace across a folder (query with match case, whole word and regular expression, files to include and exclude, results by file, replace one match, one file or all).
- **Git**: what changed in each repository, as a list or a tree, with diffs, and Merge Changes, Staged Changes and Changes with stage and unstage for a file, a hunk or the lines you pick; the **Git Graph** with branches, tags, stashes and uncommitted changes, each commit's files and diffs, and its actions (check out, merge, rebase, push, pull, fetch, branch, tag, cherry-pick, revert, reset, stash), asking first for the ones that lose work.
- **Worktrees**: every git worktree of a project's repositories, with their state and the sessions running in each; create one (new, existing or remote branch, or detached, with the local files to copy and the post-create command), start a session in it, attach or detach it, lock, move, repair, prune, remove it or all the merged ones, and change the worktree settings.
- **GitHub Actions** (Git → Actions): the workflows and their runs, filtered by status or with GitHub's qualifiers; a run's jobs as stages, annotations and artifacts; a job's steps and their logs as each step finishes; Run workflow, re-run, cancel, delete, review deployments; caches, runners and deployments. Through the computer's GitHub CLI.
- **Project settings**: the name, where sessions start, the attached folders with their branch and the worktree branch, the tracks with their start folder and CLI, and marking the project done (asking first about running work, schedules and worktrees), waking or removing it.
- **IDE diffs**: a change Claude proposes in a session started on the computer with IDE emulation, to accept or reject from the phone.
- Usage limits of Claude and Codex, and Claude's recent activity.
- Reconnects on its own when the computer comes back, picking each terminal up where it left off, and says why when it cannot.

The Git Graph and the Worktrees tab need a Switchboard build that has them.

## Use it with Expo Go

You need Switchboard Evolution with the remote-access server on the computer, and [Expo Go](https://expo.dev/go) for SDK 58 on the phone. The phone and the computer must be on the same network (or the same Tailscale tailnet).

1. Start the app's dev server on the computer:

   ```bash
   npm install
   npx expo start
   ```

2. Open it on the phone: scan the QR code in the terminal with the iPhone camera, or from Expo Go on Android.
3. In Switchboard Evolution on the computer, turn on the **Mobile app access** switch in the sidebar header. With no phone paired yet, it shows a pairing QR code.
4. In the app, tap **Scan the pairing code** and scan that QR code, then **Pair**.

In Expo Go, scan the pairing code from inside the app: the phone's own camera cannot open `switchboard-e://` links, because Expo Go does not register that scheme. A development build (`npx expo run:ios` / `npx expo run:android`) does.

The pairing code works once and expires after two minutes. To pair again, right-click the switch on the computer and choose **Pair a phone…**. To remove a phone, right-click the switch and choose **Phones and port…**.

## Install it on a phone

Expo Go is the quickest way to try the app. Releases are built from a tag (an Android APK and an iOS IPA in a draft GitHub release), or on your computer, for the stores or as an APK (`npm run build:apk`): see [docs/releasing.md](docs/releasing.md). To build it yourself instead:

- **iPhone, free Apple ID.** On a Mac with Xcode, plug the phone in and run `npx expo run:ios --device --configuration Release`. Xcode signs the app with your personal team (add your Apple ID in Xcode › Settings › Accounts and pick the team when asked). An app signed this way stops opening after 7 days: run the same command again to reinstall it.
- **iPhone, Apple Developer account.** Build with EAS and install through TestFlight: `npx eas-cli@latest build:configure`, then `npx eas-cli@latest build --platform ios` and `npx eas-cli@latest submit --platform ios`.
- **Android.** With Android Studio's SDK installed, `npx expo run:android --variant release` builds and installs a release APK on a phone connected over USB (with USB debugging on). To build an APK to share instead, use EAS: `npx eas-cli@latest build:configure`, set the profile's Android build type to an APK, then `npx eas-cli@latest build --platform android --profile preview`.

A build of its own registers the `switchboard-e://` scheme (a pasted `switchboard://` link from a computer before the rename still pairs), so the phone's camera can open a pairing QR code directly.

## How it works

- With the switch on, Switchboard Evolution listens on every network interface, on port 47100 by default. With the switch off, nothing listens.
- The pairing QR code carries the computer's addresses, its public key and a one-time code. The phone makes its own key pair, keeps the secret key in the iOS keychain or the Android keystore, and registers its public key on the computer.
- Each connection starts with a handshake in which both sides prove their keys, then uses fresh keys for that connection only (NaCl box, via [tweetnacl](https://github.com/dchest/tweetnacl-js)).
- One WebSocket carries requests, replies and live events. The phone can only call the methods the computer allows.

The protocol lives in one file shared with the desktop app, in `packages/shared` at the root of this repository; `npm run sync-shared` copies it, and the other shared modules, into `src/shared/vendor/`.

## Development

```bash
npm test              # Jest: the protocol client, pairing links, sessions, projects, Git, diffs, usage
npm run typecheck
npm run lint
npm run sync-shared   # copy the shared modules from ../../packages/shared
npm run build-terminal # rebuild the terminal page from @xterm/xterm (also runs after npm install)
node scripts/build-file-icons.mjs # rebuild the file icon subset from material-icon-theme
```

Add dependencies with `npx expo install <package>`, so their versions match the Expo SDK. Keep to modules Expo Go includes, so the app keeps running in Expo Go.

## License

MIT. See [LICENSE](LICENSE). The terminal's font, Adwaita Mono, is under the SIL Open Font License 1.1, and the file icons are a subset of the MIT-licensed Material Icon Theme; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
