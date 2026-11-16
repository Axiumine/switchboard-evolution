# Switchboard Evolution

Desktop and mobile apps for running and managing coding-agent sessions (Claude Code, Codex) across projects: projects with their plans and todos, sessions that survive a restart, Git with its graph and worktrees, a task manager, and a phone app that reaches the computer over Tailscale.

- `apps/desktop`: the Electron app for macOS, Windows and Linux.
- `apps/mobile`: the Expo app for Android and iOS.
- `packages/shared`: code both apps use.

Switchboard Evolution (switchboard-e; called OmniboardV until 1.6.5) is being redesigned: new brand, new interface, dark and light themes, and its own data folder with an import from Switchboard. Until then the apps look and behave as before.

## Origin

The desktop app is derived from [Switchboard](https://github.com/doctly/switchboard) by Doctly (MIT), with features of its own added on top. See `LICENSE`.
