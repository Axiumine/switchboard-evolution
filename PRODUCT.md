# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The desktop app (`apps/desktop`, Electron) is the primary surface and is built with web technology. The mobile app (`apps/mobile`, Expo / React Native for Android and iOS) is the companion; see Capabilities and Constraints for how it is designed.

## Users

Developers who run several coding agents at once (Claude Code, Codex, OpenCode) across many projects. Today that is the owner; the app is built to be published for developers like them, one person per installation, no team features.

They spend long stretches at the desktop with many agent sessions running in parallel, and keep watch from the phone when away from it: glance at what needs them, answer, nudge, review. Anyone who installs the app must understand it without being told how it works.

## Product Purpose

Switchboard Evolution is one board for all your coding agents across all your projects. Each project keeps its plan, todos, attached folders and Git next to the sessions that work on it; sessions keep running when the app restarts; the phone reaches the computer as a remote.

Success: at a glance the user knows which sessions need them and what each project is doing, and can act on it in a step or two, from the desk or the phone, without losing anything.

## Positioning

One board for all your coding agents (Claude Code, Codex, OpenCode) across all your projects: plan and todos per project, sessions that survive a restart, complete Git, the phone as a remote.

Product copy does not cite Switchboard: the name already says where the app comes from.

## Operating Context

- Desktop: macOS first, with Windows and Linux builds. Agent CLIs run in terminals (xterm) inside the app, kept alive by herdr-core across restarts.
- Projects are folders on disk with `CLAUDE.md`, `AGENTS.md`, `plan.md`, `plan-tracker.md`, `todos.md` and `memory.md`, written and read by the agents themselves. Claude Code and Codex transcripts stay in their own folders, OpenCode's sessions in its own database; the app reads them.
- Git is part of the daily loop: changes and staging (files, hunks, lines), history graph with actions, worktrees, pull requests (list, conversation with comments and reviews, commits, checks and their logs, diffs, merge, draft, change base, close, reopen) and GitHub Actions (workflows, runs and their jobs and logs, Run workflow, re-run, cancel, deployments to review, caches, runners).
- Phone: Android (including dual-screen devices) and iOS, paired to the computer with a QR code and connected over Tailscale. Used for short checks, answering an agent, small edits, staging, starting a session.
- Sessions last hours; many run at once; the interface is dense and lives open all day.

## Capabilities and Constraints

- The feature set is `docs/parity.md` (desktop and mobile). The new desktop interface replaces the current one only when every line there works again. The main-process logic is kept, not rewritten.
- Data: the app either uses a data folder of its own or links to Switchboard's (`~/.switchboard`), chosen in settings, with a repeatable "Import from Switchboard" in the independent mode (planned).
- Names that are data or protocol values stay as they are: `~/.switchboard`, `SWITCHBOARD_DATA_DIR`, the `'switchboard'` worktree kind, `usage.switchboard`, the `<!-- switchboard:managed -->` block, and `switchboard://` links, which the phone still accepts next to `switchboard-e://`.
- Terminology: a **Project** is the app's own entity (tracks, plan, todos, attached folders); a **Folder** is a working directory that has sessions (Claude Code calls it a project). The interface keeps the two apart.
- Themes: dark and light, following the system, with a manual override.
- Mobile: one visual language shared by Android and iOS, the same identity as the desktop, not per-platform styling; system navigation and gestures are respected; phone, tablet and dual-screen layouts.
- Undecided: the public repository's name and visibility, and the update feed.

## Brand Commitments

- Name: Switchboard Evolution. Technical name `switchboard-e` (packages, app ids, the `switchboard-e://` scheme).
- The visual identity is entirely new: logo and colors do not echo Switchboard's, so the two apps are never confused when both are installed. The current "V" icon (`apps/desktop/build/icon-source.jpeg`) is provisional and will be replaced.

## Evidence on Hand

- The working product: `apps/desktop`, `apps/mobile`, and the feature list in `docs/parity.md`.
- No users, testimonials, metrics or press exist yet. Do not invent them.
- The screenshots in `apps/desktop/build/*.png` show Switchboard's old interface; they are references for what exists, not brand assets.

## Product Principles

1. Attention first: whatever needs the user (a session waiting, a failed task, a conflict) surfaces before everything else.
2. Nothing is lost: sessions, plans and unsaved edits survive restarts, windows and devices.
3. Context next to the work: a project's plan, todos, folders and Git sit beside its sessions.
4. Explains itself: a developer who just installed it understands it without documentation.
5. One product on two screens: desktop and phone share names, states and identity.

## Accessibility & Inclusion

WCAG 2.1 AA contrast in both themes. The desktop stays fully usable from the keyboard, keeping its existing shortcuts; the phone keeps touch targets of at least 44 by 44 points.
