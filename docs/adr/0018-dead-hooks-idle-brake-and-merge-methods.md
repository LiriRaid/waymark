# 0018 · Dead hooks reported, an idle brake, merges that keep the notes

**Status:** accepted (2026-10-12, Waymark 2.0.1). Every pick below is the user's (2026-10-12 · T2). It amends 0016 (the context brake) and 0017.

## Context
- **A dead hook is silent.** After the skills moved to `~/.agents/skills`, every hook exited without running for a day (0017, follow-up). Three tasks lost their record, and nothing told the user. When every hook is dead, nothing automatic runs: not the card, not the reminder, not the weekly pointer to `check`.
- **Resuming an idle session costs the most.** The first message to this session after 4.7 days idle re-wrote 431,902 tokens of cache (`cache_creation_input_tokens`), about 9% of the quota. The prompt cache lasts about an hour, so any large session resumed after that pays a full re-write. The size brake (300k) works once per session, so it never fired again here.
- **Squash and rebase merges orphan the notes.** A task's record rides as a git note on its commit. A squash or rebase merge on GitHub creates new commits, so the notes stay on commits that `main` no longer has. The Waymark repo allowed both methods.

## Decision
- **Hook probe.** Each hook answers `{"waymark_probe": true}` with `{"waymark_probe":"ok"}` before doing anything. `install-hooks.registered()` lists the Waymark commands each agent has: the settings files of Claude Code, Codex and Gemini CLI, and the OpenCode plugin's scripts folder. `waymark.mjs check` runs each command as the agent would, in a temporary folder, and reports the ones that do not answer, with the command to re-register them.
- **When every hook is dead.** The instructions block says: no card and no per-prompt hook line → the hooks are not running; tell the user and run `check`. That text is the only part of Waymark that still reaches the agent.
- **Idle brake.** A message to a session past `IDLE_TOKENS` (100k) whose last response is more than `IDLE_MINUTES` (60) old is stopped before the model, the same way as the size brake: 0 tokens, the message kept in `.waymark/next-prompt.md`, a resend continues. It fires once per idle stretch, keyed by the time of the last response. The size brake stays at 300k, once per session.
- **Merges.** `check` reads the project's GitHub repo, read-only through `gh api`, when it holds task notes. If the repo allows squash or rebase merges, `check` says so and gives the command that allows only merge commits. That is the user's setting, so it is applied only on their yes. INSTALL tells the user to merge with a merge commit.

## Consequences
- `check` costs about 16 short node runs when four agents are set up. It runs on demand, never in a hook.
- A hook from an older Waymark, one that does not know the probe, is reported as not answering until the install is updated.
- Resuming a large session after an hour costs one held message. Resending it in the same session, or opening a new one, is the user's call.
