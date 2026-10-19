# 0031 · Cost per version and level, the replay bench, and the thresholds of criterion 8

**Status:** accepted (2.0.18, point 3). Amends ADR 0028: the scorecard now names this ADR (`adr`), whose lock replaces the one in 0028.

Scorecard-Lock: 3a25447b20a76c3fadb3a7ae833bb9593b282ca84cbc3aadc111ab24b4c4ed3e

## Context

Criterion 8 (token efficiency, weight 15) had checks that could not be scored: the thresholds were `null` until a baseline existed, and two of the numbers did not exist. The plan says to measure first, freeze the thresholds from that baseline and only then optimise, so that a lever cannot move the line it is measured against. The author builds Waymark for people on small quotas, so the question this point answers is where a task's cost goes and which part of it Waymark controls.

## Decision

**`waymark.mjs cost`** (`scripts/cost.mjs`) reads the project's records and, where the agent's transcript is still on the machine, its sessions. For each Waymark version and level it prints the tasks, tokens per task (mean and median), responses, the share of routine, work and reply, the subagent share and the measured share of the 5-hour window. It also prints the fixed context and the per-prompt reminder in characters, the first context of a session and the size of a resume (a response after a pause longer than the prompt cache that writes at least half of the context again). The routine, work and reply shares are shown in **cost units**: each token weighted by its published price ratio (input 1, cache write 1.25, cache read 0.1, output 5), next to raw tokens. Raw tokens are about 90 % cache read, so a raw share overstates links that merely re-read a long context. The units are a weighting to compare links, not a quota; the quota share is what the status line measured. A level Q or L0 writes no evaluation, so it has no tokens to report and is listed as not recorded.

**The replay bench** (`bench/replay.mjs`) takes the recorded tasks and recomputes what Waymark's own injection would have cost under the sizes of another version (a tag, extracted to a temporary worktree and deleted, or the working tree). Waymark injects its fixed context once per session and a reminder at each prompt, and both stay in the context, so every later response re-reads them. A task recorded under version A is replayed under B by swapping A's injection for B's; the responses, the work and the recorded routine are the same. It does not replay the agent's behaviour: a lever that removes a response or a routine call is invisible to it and is measured on real tasks. It assumes one prompt per task (a record does not keep the prompt count, so the reminder's term is a lower bound).

**Thresholds frozen** (the user's choice, 2026-10-16), from this baseline and before any lever of point 4:

| Check | Measure | Baseline | Frozen threshold |
|---|---|---|---|
| 8.2 | fixed context (instructions block + context card + skill descriptions), characters | 11,815 | ≤ 11,000 (−7 %) |
| 8.3 | per-prompt reminder, characters | 245 | ≤ 220 (−10 %) |
| 8.6 | routine share of the last 10 L2 tasks, cost units | 11.5 % | ≤ 9 % (−22 %) |
| 8.7 | routine share of the last 5 L1 tasks, cost units | 7.6 % | ≤ 6.5 % (−14 %) |

Check 8.7 changes its definition: it was "the tokens of a small task (L1)". A task's total tokens are set by how long its session is, not by Waymark (8.28 M tokens for two L1 tasks), so a threshold on them would have been arbitrary. The measure is now the routine share of L1, the same quantity as 8.6, which a lever can move. The measures read a rolling window so a lever shows in the tasks that follow it and the history does not hold it back.

## What the baseline shows

Measured on the 16 recorded tasks with an evaluation (all under 2.0.16: 2 L1, 10 L2, 4 L3), by cost units:

| Level | Responses per task | Routine / work / reply | Routine responses |
|---|---|---|---|
| L1 | 26 | 7.6 % / 86.7 % / 5.7 % | 2 |
| L2 | 29.4 | 11.5 % / 83.4 % / 5.0 % | 3.5 |
| L3 | 42.5 | 13.2 % / 82.0 % / 4.8 % | 5.5 |

- **What Waymark injects is about 0.9 % of a task's cost** (replay bench: 0.86 % under 2.0.16, 2.0.17 and the tree as it is). A session's first context is 74 k tokens, of which Waymark's fixed text is about 3 k. Shaving characters moves the cost very little; the sizes are frozen as a cap so they do not grow, not because they are where the cost is.
- **What Waymark controls is the number of routine responses**: 2 to 5.5 per task, each re-reading a context of 70 k to 300 k tokens. That is where the routine share comes from, and it is what points 4 and 5 can lower.
- **A resume is costly**: 120 k tokens written (median of 4), about the whole context again, against 1 k for a response that only adds a turn to a cache that held.
- The subagent share is 0 % in these records; the measured share of the 5-hour window exists for one task only (24 % for an L3 task), so a figure per level is not claimed.

## Limits, in these words

16 tasks of one project, one Waymark version and one model: the shares are the author's, not a population's, and the levels have unequal samples (2 L1). The bench holds behaviour fixed; the weights are price ratios, not the author's quota. Versions other than 2.0.16 have no recorded tasks yet, so the bench's comparison between versions shows the injection delta only (about 0.01 % of a task between 2.0.16 and now). Q and L0 are not measured.

## Alternatives considered

- **Raw tokens only.** What the API reports, but a long conversation makes every link look expensive. Rejected for cost units next to tokens.
- **Quota weights fitted to the author's pairs.** Reflects the plan, but seven pairs and two models make the fit unstable, so the thresholds would move. Rejected.
- **Version sizes written in a table.** No git needed, but a written number can diverge from the code. Rejected for the tag.
- **Total tokens as the L1 threshold.** Kept the plan's wording, but not controllable. Rejected for the routine share.
- **Cost of Q turns read from transcripts.** Covers Q, but only where the transcript is on the machine and with a fragile path. Not done; a separate point if wanted.

## Consequences

- Checks 8.2, 8.3, 8.6 and 8.7 score against their thresholds; today they fail by exactly the distance the levers of point 4 have to cover. Checks 8.4 and 8.5 pass.
- Points 4 and 5 are judged on these numbers: the fixed context must not exceed 11,000 characters and the routine shares must fall to 9 % (L2) and 6.5 % (L1).
- The amendment is the only way these four numbers change: a new ADR with a new lock.
