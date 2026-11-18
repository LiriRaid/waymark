# 0063 · The Kiro adapter writes the workspace files the IDE reads, and uninstall removes them

**Status:** accepted (2.0.21, in the making). Failure 6 of `docs/plans/2.0.21.md`: the Kiro IDE (1.1.3) showed no `Waymark →` line and ran no Waymark hook. The live test in the IDE is the user's.

## Context

ADR 0022 wrote the Kiro adapter from the documentation of the CLI: global `~/.kiro/hooks/waymark.json` and `~/.kiro/steering/AGENTS.md`. The first live session (2026-10-30) showed that the IDE reads neither: it loads rules from the workspace's `.kiro/steering/*.md` and watches only `.kiro/hooks/**/*.kiro.hook`, JSON files with `enabled`, `name`, `description`, `version: "1"`, `when: {type}` and `then: {type: "runCommand", command, timeout}`. A `runCommand` hook gets only the environment variable `USER_PROMPT`: no JSON on stdin, so no session, no tool name, no result. A manual test copy of the steering file made the routing line show.

## Decision

- **`kiro-workspace.mjs`** writes, per workspace (`install-hooks.mjs --agent kiro --project <folder>`, a plan without `--apply`): `.kiro/hooks/waymark-prompt.kiro.hook` (`promptSubmit` → `rule0-hook.mjs --agent kiro --event UserPromptSubmit`), `.kiro/hooks/waymark-stop.kiro.hook` (`agentStop` → `stop-hook.mjs … --event Stop`), `.kiro/steering/waymark.md` (`inclusion: always`, the Rule 0 block) and the line `/.kiro/` in the clone's `.git/info/exclude`. No tool hooks: with no tool name they would journal nothing. The global file stays for the CLI.
- **The adapter without JSON:** `agents/kiro.mjs` takes the session from the workspace (a hash of the folder) when the payload has none, and the prompt from `USER_PROMPT` (it already did); the prompt and the stop of a workspace meet in one journal. `lib/stdin.mjs` stops waiting after 600 ms for a Kiro hook that sent nothing, so an IDE that leaves stdin open costs no 8 s.
- **Uninstall:** each folder written is registered in `~/.waymark/kiro-workspaces.json`; `uninstall.mjs` removes from each only what is Waymark's (a hook that runs its scripts, the steering file with its block, the exclude line) and forgets the folder. The user's own hooks and steering files stay.
- **Surfaces:** `agents.json` gets a `surface` per agent (which of app, IDE or CLI the hooks reach and what was tried live); `connect-agents` prints it and `install-hooks --agent kiro` says IDE and CLI read different files.

## Consequences

A Kiro IDE task can leave a record once the user runs the install in its folder and reopens it; what the IDE does with a hook's stdout and whether `agentStop` accepts a block are not shown in the code read and are the live check. Specs "6:" in `tests/real-use-2021b.test.mjs`.
