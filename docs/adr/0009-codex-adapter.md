# 0009 · Codex adapter: the rollout as core lines, decisions asked in chat, steps an agent lacks

**Status:** accepted (2026-10-03, Waymark 2.0.0-dev, step 3b). Applies 0008 to Codex CLI. It adds two rules to the routine contract that hold for any agent.

## Context
Codex CLI 0.160 runs hooks with the same events and output shapes as Claude Code (learn.chatgpt.com/docs/hooks, checked 2026-10-03). It reads `~/.codex/hooks.json`. PreToolUse receives `tool_name` `Bash` or `apply_patch`, with the patch text in `tool_input.command`. Codex skips a new or changed hook until the user trusts it in `/hooks`. The docs call the transcript (rollout `.jsonl`) "not a stable interface". Three gaps showed up in the local rollouts (0.115–0.160) and in `codex features list`:
- Codex has no Skill tool: it reads `SKILL.md` files.
- Its choice window, `request_user_input`, exists only in Plan mode (`default_mode_request_user_input` is "under development", off). With the 0008 gate as it stood, Codex could never edit in its default mode.
- There is no `code-review` capability. The contract blocks L2+ code without it, so every Codex task would be blocked once and score Review ✘.

## Decision
**The adapter converts the rollout into the core's lines** (`scripts/agents/codex.mjs`). It reads the `item_completed` events, the stable part of the rollout. In the core's shape:
- `UserMessage` becomes a prompt and `AgentMessage` becomes assistant text.
- `CommandExecution` becomes `Bash`, with its exit code and output as the result.
- `FileChange` becomes one `Edit` per changed path.
- `McpToolCall` becomes `mcp__<server>__<tool>`, and `WebSearch` becomes `WebSearch`.
- `token_count` gives the usage per response, with cached input counted apart. `turn_context` gives the model, and `session_meta` the Codex version.

A read of `<dir>/<skill>/SKILL.md` counts as invoking that skill. Before an edit, `apply_patch` is mapped to the files named in its `*** Add/Update/Delete File:` and `*** Move to:` lines.

**A decision can be asked in the chat** (user's choice). `request_user_input` counts as the choice window, with the user's answers. When it is not available, a turn that ended with a question in the chat counts as one decision asked: the user's next message is the answer (`source: "chat"`, and the record keeps the question and the reply). The gate passes on it, and the Cierre quotes it as `del usuario ("…")`.

**A step the agent has no capability for does not apply** (user's choice). Each adapter lists the routine steps it lacks (`lacks`; Codex: `review`, until 0014 gave every agent `waymark.mjs review`). That step is recorded as `na: "<agent>"`: it neither blocks nor counts in the score. Each adapter also returns one line (`note`) that the reminder and the gate's message carry, saying how that agent does what the routine names in Claude terms. For Codex: read the skill's `SKILL.md`, re-route with a new routing line, and use `request_user_input` or the chat.

`install-hooks.mjs --agent codex` writes the four scripts with `--agent codex` to `~/.codex/hooks.json`: PreToolUse matcher `Bash|apply_patch`, and `commandWindows` equal to `command`. It then tells the user to trust them in `/hooks`.

## Alternatives considered
- **Require `request_user_input` through the under-development flag:** rejected by the user. It depends on a flag that can change or vanish.
- **A soft gate in Codex (deny once, then allow):** rejected. The agent could decide alone, the failure the gate exists for.
- **Write the Waymark block into `~/.codex/AGENTS.md`, or copy the skills into Codex:** rejected. That is a per-agent install, against 0008. The per-prompt reminder carries the absolute skills path instead.
- **Keep code-review mandatory in Codex, or count a review sub-agent:** rejected. The first scores every task ✘ for a missing capability. The second is unverified.

## Consequences
- Positive: Codex runs the same four hooks and the same contract, its tasks land in the same chain with `agent: "codex"`, and Claude sees them in `tasks.md`.
- Negative: the reader depends on the rollout format, which can change between Codex releases. The tests pin the shapes seen locally, and a missed shape degrades to fewer observed facts, never to a crash. A decision asked in chat is weaker evidence than a choice window (free text, no list of discarded options). Codex tasks are not code-reviewed.
- Follow-up: 3c, the cross-agent real test (Claude → Codex → Claude), which also checks that Codex writes the rollout before each hook fires.
