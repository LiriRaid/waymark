# 0024 · The context Waymark costs: the protocol by level, a card that asks nothing, a size report that measures it all

**Status:** accepted (2026-10-13). Every pick below is the user's (2026-10-12 · T13b, point 6 of the 2.0.3 plan). It continues the token work of `0015` and `0016`.

## Context
- **The whole protocol at every L2.** The block sent an L2 to `references/protocol.md` (11,286 characters). It held Entry, Exit, the L3 checkpoints, token economy, hand-offs and the two-strike rule. An L2 needs only the first two. Part of Entry and Exit repeated the block (the opening lines, the Cierre, the decision gate), and two lines contradicted it: "rewrite *Work in progress*", which the hook writes, and "read the registry" before the installed providers.
- **A card that asked a question.** With an open task in *Work in progress*, the card told the agent to ask, in its first reply, which tasks already worked. Every session in that project paid one extra question before the user's task. The path to `waymark.mjs` appeared up to four times, and the project root twice. Memories from before 2.0.3, titled with the request, showed the request instead of the lesson.
- **The size report saw half.** `size.mjs` counted the block, the card and the static reminder. It missed the skill descriptions the agent lists in every session, the task ID and git lines of the reminder, and the lines the session hook adds after the card's cap. It reported 8,114 characters per session; the real figure in this repo is 12,967.

## Decision
- **The protocol by level** in `references/protocol/`:
  - `l2.md`: Entry and Exit, without what the block says;
  - `l3.md`: plan as checkpoints and the L3 Exit;
  - `stuck.md`: the two-strike rule;
  - `handoff.md`: hand-offs between departments;
  - `tokens.md`: token economy.

  `protocol.md` stays as their index. The block sends an L2 to `l2.md`, an L3 also to `l3.md`, and a second failed attempt to `stuck.md`.
- **The card lists, `check` asks.** Open tasks are listed with `(W check asks the user which already work)`. `waymark.mjs check` has an `open:` line that asks in the choice window and closes them with `done`.
- **Each path once.** The card defines `W = node "<…>/waymark.mjs"` on its project memory line and uses `W` after that. A line added after the card says `W` only when the card defined it. The root appears once (`memory.md … and tasks.md next to it`).
- **Lessons, not requests.** A memory whose content opens with its Aprendido shows `<id> · <Aprendido>`, however it was titled.
- **`size.mjs` measures what enters.** Its groups:
  - session: the block, the card and the skill descriptions;
  - prompt: the reminder as the hook sends it to Claude Code;
  - outside cap: the check pointer, the held message at its cap, new agents, proposals, coexistence and the block Cursor gets in the card;
  - level: the protocol an L2 and an L3 read;
  - departments and tools, as before.

  The session hook builds those extra lines with the same functions (`EXTRA`).

## Consequences
- An L2 reads 3,761 characters of protocol instead of 11,286 (about 1,900 tokens less per task).
- The block changed, so every agent connected with the old block shows as not connected until it is reconnected. `check` offers it after the reinstall.
- The skill descriptions (4,888 characters here) are now the largest per-session item after the block. Trimming them is a separate change, measured by this report.
