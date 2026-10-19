# 0041 · Qwen Code, Droid and Amp get an adapter, written from their documentation

**Status:** accepted (2.0.18, point 12). Amends ADR 0039 (which left the five agents without an adapter on purpose) and ADR 0022 (an adapter for a plugin format other than OpenCode's).

## Context

Check 9.1 (`every agent Waymark knows has an adapter`) was the one that kept criterion 9 below its target: Windsurf, Qwen Code, Droid, Amp and Crush were known, with documented hooks, and had no adapter. ADR 0039 rejected drafting them to turn the check green because no adapter would have run. The author asked on 2026-10-19, with the score at 98.6 %, to have them in this release. Reading the five documentation pages the same day showed that they are not alike:

- **Qwen Code and Droid** speak Claude Code's hook protocol (JSON on stdin with `hook_event_name`, `tool_name`, `tool_input`; `hookSpecificOutput`, `permissionDecision`, `decision: block`), with their own tool names and, for Droid, the events as the top-level keys of `hooks.json`.
- **Amp** has a TypeScript or JavaScript plugin with every event the chain needs (`session.start`, `agent.start`, `tool.call`, `tool.result`, `agent.end`), each with its own way of answering.
- **Windsurf** has no session start and no documented way to give the model context (a pre-hook can only exit 2 with stderr), and **Crush** has one event, `PreToolUse`: neither can carry a card, a task ID, a record or a Cierre.

## Decision

The choices are the user's (2026-10-19): the three that can carry the chain are written; Windsurf and Crush are not.

- **Journal adapters.** `qwen.mjs`, `droid.mjs` and `amp.mjs` journal each event in `~/.waymark/<agent>/<session>.jsonl` (`agents/journal.mjs`, as Kiro and Antigravity do) because no transcript of the three is described. The journal also holds a `reply` row, the text a stop hook carries.
- **What each judges.** All three lack the Cierre, the evidence and the choice window (`lacks`): Qwen's hooks and Amp's `agent.end` give the turn's last message, with no routing line to judge it by or to order it against the first change, and Droid's give no reply. The gate before the first change lets a change through there, as in Kiro. What they do enforce: the card and the reminder, the sensitive-path guard (a deny before a tool, reads included: *prevent* in the matrix), the commit trailer, the record, and the end-of-turn block. Qwen's `PreToolUse` takes context, so its pack goes before the tool; Droid's and Amp's goes with the result (Amp's waits in the plugin for the next prompt).
- **Registration.** Qwen: `~/.qwen/settings.json` under `hooks`. Droid: `~/.factory/hooks.json` with the events as top-level keys (`top: true` in `agents.json`). Amp: a plugin, `~/.config/amp/plugins/waymark.js`; `install-hooks` and `uninstall` handle every plugin agent (`PLUGINS`), not OpenCode only. Every command goes through `hook-run.cjs` (ADR 0040). The Amp plugin starts the hooks with `child_process` and `node`, because the plugin runs on Bun, whose `process.execPath` is not Node.
- **Judged by the same list.** Each has a driver in `tests/conformance/agents/` and passes the cases of the list that apply to what it can do; `tests/new-adapters.test.mjs` covers registration, uninstall, the payload mapping and Amp's plugin run against the real hooks.
- **Not drafted: Windsurf and Crush.** Check 9.1 stays at 11 of 13 and says why in the README. A draft from `adapter-new` would pass the list only by being Claude-shaped, which neither agent is.

## What it proves and what it does not

That the three adapters do what their documentation says, as far as the documentation and the conformance list go. Nothing has run in a live session of Qwen Code, Droid or Amp: each `adapters/<agent>.md` lists what the first live session must confirm (the names and fields of `tool_input` and `tool_response`, whether a plugin may spawn `node`, whether `additionalContext` arrives once, whether a `Stop` block's reason reaches the model). The undocumented parts are marked there and in the adapter's header, never filled in from memory.

## Alternatives considered

- **All five.** 13 of 13, and two adapters that only veto sensitive reads and changes, with no card, no Cierre and no record. Rejected for what it would say about Windsurf and Crush.
- **`adapter-new` drafts for all five.** Claude-shaped drafts that pass the list and speak to neither agent's real payloads. Rejected, as in ADR 0039.
- **Leave 9.1 red.** The earlier decision; reversed by the author for the three agents that can carry the chain.

## Consequences

- Criterion 9 reaches 98 % and the total 98.9 % on the records of 2026-10-19; the scorecard and its lock are untouched.
- Eleven adapters in the matrix; Windsurf and Crush are listed as agents Waymark knows with no adapter, with the reason.
- `adapter-new` and `any-agent` specs use Crush and Windsurf as the agents without an adapter.
- Hooks of the three agents are registered only by this version's `install-hooks`: nothing existing changes.
