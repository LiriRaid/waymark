# 0032 · The token levers of 2.0.18: measured first, kept only if the measure says so

**Status:** accepted (2.0.18, point 4)

## Context

ADR 0031 froze the thresholds of criterion 8 from a baseline: the fixed context at 11,000 characters, the per-prompt reminder at 220, and the routine share at 9 % (L2) and 6.5 % (L1). The plan lists five candidate levers and says each is kept only if the replay shows it saves what it costs, and that a saving is never claimed without the replay behind it. Before building any, each lever was measured against the author's own sessions.

## What was measured

| Lever | What the data says | Decision (the user's, 2026-10-17) |
|---|---|---|
| (a) fixed context and per-prompt text down to the caps | what Waymark injects is 0.86 % of a task; cutting it to the caps saves 435 cost units of 1.19 M per task (0.037 %) | **built** |
| (b) lazy loading of procedures and profiles | already true: `procedures.md` and the pack are handed at a task's first change, once per department and once per file, and a turn that changes nothing receives only the fixed context and the reminder; the one delivery of the largest procedures file costs under 1 % of a task | **kept as a regression check**, no code change |
| (c) cap on the output of `review` | 18 unpiped outputs in the author's sessions: median 290 characters, maximum 5.5 k; a cap would save under 0.1 % and hide part of the diff the agent reviews | **not built** |
| (d) a quota budget that warns before the window ends | changes a decision, not a token count: the replay cannot measure it | **not built** (offered; the user did not choose it) |
| (e) checkpoints for resuming | the context brake (300 k, ADR 0016) and the idle brake (100 k after 60 minutes, ADR 0018) already exist; a resume writes about 120 k tokens, the whole context again, and the work in progress line already rebuilds a new session | **nothing new** |

## Decision

**(a).** Every cut removes words, not rules, and the routing tests still guard every department. The fixed context went from 11,815 to 10,888 characters and the per-prompt reminder from 245 to 211:

- The context card: the learned lines are two of 110 characters instead of three of 150, the last close's lesson is clipped at 110 instead of 180, the heading of the learned block and the commands line are shorter. The card is capped, so it can only shrink.
- The per-prompt reminder: the rule line drops "owner", and the task line reads `ID: new <id>; follow-up <id>.` (the rule line already says that the Cierre carries the ID).
- The 17 skill descriptions went from 3,492 to 3,127 characters: the capability tags (`ui.build · `), the trigger words that repeat another skill's (`REST, GraphQL`, `SSR`, `RLS`, `OWASP`), and a few synonyms. The Spanish phrases a person says stay; `e2e`, `PR` and `tabla` were put back after the first pass.

**(b).** `tests/replay.test.mjs` fixes the regime: the injection stays under the frozen caps (read from the scorecard), the same recorded task replays cheaper than under the 2.0.17 sizes and stays under 1 % of its cost, a turn that changes nothing is handed no procedures and no pack, and every department's procedures file stays under 10 KB.

**The routine-share thresholds stay as frozen** (8.6 and 8.7), and the scorecard reports them red until a lever removes a routine response. The data explains why characters do not move them: the routine is 2 to 5.5 responses per task, each re-reading a context of 70 k to 300 k tokens, and the minimum an L2 task needs is the department's skill, the choice window and, where there is risk, the review: 3 of about 29 responses (10.3 %). Reaching 9 % takes one of those three, or the extra calls an agent chooses (`check`, `tasks`, `pack`, a read of the memory). The measure counts `verify`, `attest`, `sync` and `notes` as routine even where they are the work (the limit already written in ADR 0027 §1); correcting that needs a second version of `links` and a new baseline from the transcripts, and was not chosen.

## Results

Replay on the 16 recorded tasks, 2.0.17 against the tree now: injection 0.84 % → 0.81 % of a task, 1,190,644 → 1,190,209 cost units per task. Scorecard criterion 8: checks 8.2, 8.3 and 8.8 pass; 8.6 (11.5 % against 9 %) and 8.7 (7.6 % against 6.5 %) fail by exactly the distance a removed routine response would cover.

## Found on the way

`tests/hooks.test.mjs` ("tidy") carried a hard-coded date: its last step ran the command on the real clock against a line from 2026-10-03, so it passed until 2026-10-17, when that line turned 14 days old. It now builds a line dated today. A test whose outcome depends on the day it runs fails without anything having changed.

## Alternatives considered

- **Cap the output of `review`.** Rejected on its number: the median output is 290 characters.
- **Hand the department's `SKILL.md` with the procedures instead of a `Skill` call.** Would remove a routine response per task, but the department's brief shapes the choice window, which comes before the first change; delivering it later would arrive too late. Not done.
- **Raise the thresholds, or change how the routine is counted, to make 8.6 and 8.7 pass.** Moves the line after measuring it. Rejected; the failure is reported.
- **A quota budget (d).** Offered and not chosen; it stays a candidate.

## Consequences

- Waymark's own text is smaller and cannot grow past its caps without a failing check.
- Criterion 8 is not at its target. If the routine-share thresholds are still red at the close, the README says so as it is.
- The levers that would move 8.6 and 8.7 are behaviours (fewer routine responses), measured on real tasks, not on the replay.
