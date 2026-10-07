# 0008 · One agent-agnostic core, a thin adapter per agent, hooks only for the chain

**Status:** accepted (2026-10-03, Waymark 2.0.0-dev, step 3). Narrows the hooks of 0001–0007 to the four links of the chain; the record format gains `agent` and question records.

## Context
Waymark is a supply chain of the agent's work: every task carries its ID, the user's decisions, evidence, gates, result and Aprendido in a hash-chained record. It is not an orchestrator or an ecosystem. It is installed once at user level, and every agent on the machine should run the same routine without a per-agent install, resuming where another agent stopped. By 2.0.0-dev the four hooks did much more than the chain. The session hook made six offers or syncs (migration, connect agents, skill sync, MCP fit, skill fit, coexistence detection) and handed over a pending prompt. The per-prompt hook ran a resume guard, a size notice and a daily network update check. The pre-tool hook carried four fragile-command checks and dead code. All four spoke Claude Code's output shapes directly. A Codex adapter on top of that would have copied every extra into a second agent.

## Decision
**The core is the chain.** The hook scripts (`session-hook`, `rule0-hook`, `tool-hook`, `stop-hook`), `provenance.mjs`, `transcript.mjs` and `routine.json` hold only the four links:
- SessionStart: the memory digest and the pointer to tasks.md.
- UserPromptSubmit: the task ID, open.json and the short reminder.
- PreToolUse: the decision gate only.
- Stop: the Cierre check, the record and tasks.md.

The rules the agent must obey stay injected (coexistence rules in `waymark-leads`, Environment).

**Everything else is an on-demand command.** `node <skills-dir>/waymark/scripts/waymark.mjs [check | sync | mcp-fit | skill-fit | migrate | connect | install-hooks]` covers it, and `check` (the default) only reports. It covers the update check, changed skills, MCP fit, skill fit, the pending migration, unconnected agents, a new or vanished framework, and the size and idle time of the latest session in the folder.

The session hook adds one line (about 30 tokens, no network) when the last check is older than 7 days, and at most once in 7 days. That line tells the agent to run `check` and offer what it reports. Three features are removed because they only work by intercepting a prompt or a tool call: the resume guard, the pending-prompt hand-over and the fragile-command checks. Their rules live as text in `protocol.md` and `dept-qa`.

**One adapter per agent.** Each adapter is a small module in `scripts/agents/<name>.mjs`. It reads the agent's transcript into the core's line shape (Claude Code's JSONL shape with canonical tool names: Edit/Write, Bash, AskUserQuestion, Skill). It maps the agent's pre-tool input to an edit or a shell command, and it formats each answer (context, deny, block, user notice). It also names the agent's user instructions file and session folder.

The hooks take `--agent <name>`, with `claude` as the default, so current installs keep working. A new agent adds one file and registers the same four scripts. `install-hooks.mjs` writes the registration (dry run by default; `--apply` makes a backup and replaces only Waymark's own entries).

**The record says who did the work.** Each record carries `agent`, and tasks.md shows it next to the ID, so a session in Claude sees "T4 · codex". A turn routed Q (analysis only) in a project with memory gets a chained record `{kind: "Q"}` with no task ID. It does not consume `T<n>` or change the follow-up offered. tasks.md shows only "Preguntas (Q) desde el último cierre: N".

## Alternatives considered
- **Keep the extras in the hooks and add Codex next to them:** rejected. Every agent would inherit the network check, the offers and Claude-only paths, and each hook would grow per agent.
- **Detect the agent from stdin or the transcript path instead of a flag:** rejected. Fragile when a format changes, and invisible in the registration.
- **One script per agent and event (`codex-stop.mjs`, …):** rejected. It duplicates the chain logic, which is exactly what must stay identical across agents.
- **Keep the resume guard as a documented exception:** rejected by the user. The command reports the session size instead, at the cost of no automatic stop when an idle session is resumed (measured once: 502k tokens for one line).
- **Give question records a task ID:** rejected. Every question would shift `T<n>` and take over the follow-up offered.

## Consequences
- Positive: four short hooks that read the same for every agent. An adapter is the only per-agent code. Claude sees tasks closed in Codex. Analysis-only work leaves a trace. Hook registration is a script instead of a manual merge.
- Negative: update notices and offers arrive only after `check` runs (at worst weekly, through the pointer line). Resuming a large idle session is no longer stopped. Shell slips (`node -e` with regex, `grep -r` through node_modules, `git stash`) are no longer denied, only documented.
- Follow-up: 3b, the Codex adapter (`agents/codex.mjs`: rollout reader, `apply_patch` → edits, `~/.codex/hooks.json` in `install-hooks.mjs`). 3c, the cross-agent real test (Claude → Codex → Claude).
