# 0048 · A cut turn is not a failed task, and an agent that cannot carry the chain yet is coming soon

**Status:** accepted (2.0.19, point 12). Amends ADR 0044 (a parcial for a cause outside the work does not chain), ADR 0028 (check 9.1 counts what can be counted; the scorecard now names this ADR, whose lock replaces the one in 0038) and ADR 0041 (the reason Windsurf and Crush have no adapter is now data).

Scorecard-Lock: 13e8c912adba3b2c5618ae410365934142201813a7456b7acc6a9f5ec3bfc4d0

## Context

Real use of 2.0.18 ended turns the agent never chose to end. When the session's limit was reached mid-task, the work stood at 8 of 13 steps with red tests and uncommitted changes, the end-of-turn hook still demanded six items (the Cierre, the build, the review…), and nothing told the next agent or account where the work stood. A dropped connection or an overloaded provider cut turns the same way.

The harness leaves a mark of its own: the turn's last message is synthetic (no model wrote it) and carries `error: "rate_limit"` ("You've hit your session limit · resets …", also the spend and weekly limits) or `error: "server_error"` ("Connection lost mid-response", "529 Overloaded"). That message is data, not a model's words. The quota has a second shape, the one the real session of 2026-10-23 showed: in the middle of the turn a meta user message (`isMeta: true`, field `usageLimitNote`, text "[Usage limit reached; a short grace allowance remains, then this turn is cut off…") tells the model to wrap up, and the model goes on normally for a short grace with no synthetic message at the end. The first build recognised only the synthetic shape, so the real turn was blocked.

Separately, criterion 9 scored Windsurf and Crush as missing adapters. Neither can carry the chain today (ADR 0041): Windsurf has no session start and no documented way to give the model context, Crush has one event, `PreToolUse`. Counting them against Waymark said nothing about Waymark, and "no adapter" without a reason read as neglect.

## Decision

- **A cut turn blocks nothing and judges nothing.** When the turn's last message is the harness's `rate_limit` or `server_error` notice and the turn carries no Cierre, the end-of-turn hook asks for nothing, marks every applicable testigo not applicable (never ✘), and records the task `parcial` with cause `external` (`usage limit` or `provider`). The next prompt is a new task unless the user says it continues (ADR 0044). A turn that already carries its Cierre, a notice from an earlier turn, the same words in a model's reply, and any other API error are judged as before; a real red test with no notice still blocks. The grace notice in the current turn counts as the cut when the turn ends with no Cierre; when the model wrote its Cierre in the grace, that Cierre is judged and recorded as any other (a missing testigo stays a finding), but the hook never blocks: the quota left no room for more work.
- **The handoff is built by the hook.** The agent never wrote a Cierre, so the hook builds one from the turn: the ask (120 characters), the files changed (✔1) and what is left (▶2, finish, verify and close) and leaves it in `.waymark/next-prompt.md` (point 7: the card shows it to any agent or account, until the task it is about closes). The harness's notice is not copied: it can name a time and an account.
- **Coming soon is data.** `agents.json` gains `soon`: the technical reason an agent cannot carry the chain yet. The matrix in the README and INSTALL, `check` and `install-hooks` say "coming soon" with that reason and offer no adapter to draft; an unknown agent, or a known one with no reason to wait, is offered as before.
- **Check 9.1 counts what can be counted.** Its threshold is the same (1); the share is now the agents with an adapter over the agents that can technically have one, and an agent with a `soon` is listed apart. With none able there is no share, never 100 %. This is a change of the card, so it carries a new lock (above) and the card names this ADR.
- **The checks only the user can run** (a real L2 on Codex and on OpenCode, Gemini with a model reply, a real handoff Claude → another agent when the quota ends, the first live session of each agent with an adapter, a non-Anthropic model through OpenCode, the update notice on a real install) are listed in the README until each is done. They are not scored: nothing in a test can stand in for them.

## Alternatives considered

- **Judge the cut turn and mark the testigos ✘.** Punishes the agent for the quota and makes the incidents list suggest rules for a cause no rule can fix.
- **Draft Windsurf and Crush adapters to turn 9.1 green.** Rejected by ADR 0041: a draft would pass the list only by being Claude-shaped, which neither agent is.
- **Leave 9.1 as it was and explain it in prose.** The score would keep saying 11 of 13 for a reason that is not neglect.

## Consequences

- A cut turn leaves a record, a handoff and no false ✘; the incident and cost views keep telling the cause apart (`usage limit`, `provider`).
- Whether the Stop hook fires on the harness's limit message depends on the agent; the 2.0.18 logs show it did on Claude Code for the synthetic shape, and the transcript of 2026-10-23 for the grace notice (it fired and blocked there). For an agent whose hook does not fire, the turn stays open in `open.json` and is closed as interrupted by the session card (ADR 0015).
- The share can reach 1 only for agents that can have an adapter; a new agent with documented hooks and no `soon` lowers it until its adapter is written.
