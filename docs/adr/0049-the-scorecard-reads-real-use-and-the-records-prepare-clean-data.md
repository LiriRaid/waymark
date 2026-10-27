# 0049 · The scorecard reads real use, and the records prepare clean data

**Status:** accepted (2.0.19, point 13). Amends ADR 0028 (three checks and a pooled view of real use; the scorecard now names this ADR, whose lock replaces the one in 0048), ADR 0027 (the record fields it listed as missing are derived where a hook or a reader can see them) and ADR 0031 (`cost` knows the model).

Scorecard-Lock: dbebabae73cc15a030ceb5884852be7b44026170cea5af4eb5c5466e58091137

## Context

The 2.0.18 scorecard scored criterion 13 (a task done completely and as asked) at 100 % while 35 of 98 real tasks had closed `parcial`, and criterion 9 (agnostic) at 98 % with no task closed by any agent but one. It read only the repository where it ran, and its checks were about the existence of mechanisms, not about what happened when people used them. The real-use cycle of 2.0.18 was read by hand from the records of three projects; the same numbers must come from the tool.

Two more gaps showed in that reading. A task's cost depends on the model (Opus and Sonnet differed: 11.9M against 7.6M tokens per task) and `cost` did not say which one, nor that a session changed model in the middle (the first response after `/model` re-writes the whole cache, which the routine link then counted as its own). And the author's plan for machine learning (decision 17 of the plan: it learns from patterns, never from cases, and every person shares their own patterns) needs data that is clean before any model exists.

## Decision

- **Three checks see real use.** `13.6` the share of the last 30 tasks that closed `parcial`, at most 20 %; `9.9` the number of different agents that closed them, at least 2 (one agent shows its count, never 100 %); `8.9` the median tokens of a task, **pending**: its threshold is frozen in the next release from this release's baseline, as ADR 0031 did for the others. The weights do not move. Nothing outside these checks changed, so the card carries a new lock (above).
- **A version answers for the records it wrote.** The checks read from the records (field share, parcial share, agents, tokens…) count only the tasks whose writer version (`inputs.waymark`) is the version measured; a record with no version stays. During the build of 2.0.19 the hooks that ran were the installed 2.0.18, whose notification turns left records with no Cierre (point 3i). Those records keep failing 1.2 until the version is raised at the Close, and then the check reads "unmeasured" until 2.0.19 has closed real tasks. No record is edited and no threshold moves.
- **`scorecard --projects [paths]`** pools the last 30 tasks of each project the user names: the share of `parcial`, the agents, the median tokens, the three checks over the pool. With no paths it reads the Path column of `~/.waymark/projects.md`, which is private; nothing of a project goes into the repository. A project with no task is not measured (never 0 % or 100 %), a path that does not exist is named, one agent is said as one agent. The parcial share leaves out a `parcial` for an external cause (the quota or the provider cut the turn: it says nothing of the work), on both sides; the report shows beside it the share that closed with testigos unresolved, as a line, not a check (no lock of its own).
- **The model is in the record and in `cost`.** The record keeps the models the turn's responses came from, in order (`models`) and whether they changed (`modelChanged`), read from the transcript. `cost` groups by model as well as by version and level; tasks with a model change are shown apart and are left out of the routine share, because the cache rewrite after the change is not the routine's.
- **`waymark.mjs report` writes an anonymous summary of the user's own patterns, for them to read before sharing.** Counts and shapes only: the kinds of testigo that failed, level, kind of department, buckets of duration and tokens, outcome, stack family, agent and model family. Never a prompt, a path, a file name, code, a project name or an address; a canary test pins that. Waymark never sends it: the user chooses to (the `pattern-report` issue form is the channel).
- **The fields ADR 0027 listed as missing are derived, never typed, and never repurposed.** The options' attributes are already fields (`decisions[].options`, ADR 0030); the cost per tool call is `cost.byCall`; the later verdict is derived when the records are read, from signals a hook can see (a follow-up `T<n>b` of the same task, `reworks`, a `git revert` of the task's commits) and is left out when none exists; the project's kind is a label (stack family and size bucket) stored in new records. Old records are never rewritten (they are chained).

## Alternatives considered

- **A file of its own for the projects list.** One more private file to keep next to `projects.md`, which already indexes them.
- **A threshold for the median tokens now.** There is no baseline of a stable version yet; a number invented here would be wrong in one direction or the other.
- **Storing the verdict in the record.** A chained record cannot be edited when the user later reverts the work; the verdict is read from what happened after.
- **A report that includes the task text "anonymised".** Anonymising prose is not safe; the report has no prose.

## Consequences

- Criterion 9 reads below its target while every task is closed by one agent, and criterion 13 reads the share of `parcial` as it is: both say what the 2.0.18 numbers hid. The README lists every criterion below its target as it is.
- The median-tokens check is `pending` until 2.0.20 freezes it.
- A session that changes model keeps its cost in the record but out of the routine share, so a lever on the routine is not judged by a model switch.

## Result at the close of 2.0.19

`waymark.mjs scorecard` on the finished work (2026-10-26, lock ok, VERSION 2.0.19): **95.2 %**, against the 98.1 % of 2.0.18 and the release target of 95. The checks read from the records count only the tasks the 2.0.19 hooks wrote (four so far, all run on the installed 2.0.19-dev), so the drop is the new checks reading what the old ones hid, not a regression of what was built.

| Criterion | % | Target | What is below |
|---|---|---|---|
| 1 Provenance of each task | 100 | 98 | |
| 2 Tamper evidence | 100 | 96 | |
| 3 Authenticity | 100 | 95 | |
| 4 Independent verification | 100 | 98 | |
| 5 Enforcement | 98.6 | 93 | 5.1: the recent tasks passed 0.875 of their testigos (≥ 0.95) |
| 6 Inputs and dependencies pinned | 100 | 95 | |
| 7 Distribution of the records | 100 | 95 | |
| 8 Token efficiency | 81.3 | 96 | 8.7: the routine share of the last 5 L1 tasks is 0.188 (≤ 0.065); 8.9: the median tokens, 18.2 M, pending; 8.2 and 8.3: 11,005 and 225 characters (≤ 11,000 and ≤ 220) with the work in progress on the card |
| 9 Agnostic and adaptive | 94.4 | 96 | 9.9: one agent closed the recent tasks (≥ 2) |
| 10 Reuse of earlier evidence | 97.4 | 93 | 10.3: precision@3 0.722 (≥ 0.85) |
| 11 No hallucination, good decisions | 97.1 | 95 | 11.2: 0.813 of cited facts backed (≥ 0.95) |
| 12 Self-generating | 100 | 93 | |
| 13 Task done completely and as asked | 86.6 | 93 | 13.6: the four 2.0.19 tasks closed parcial (≤ 0.2): their Cierre did not answer the options chosen in the window |

Criteria 8, 9 and 13 are below their targets and the README says so. The scorecard test no longer judges the measures read from the task records (real use, which every task changes): the scorecard does, against their thresholds. `scorecard --projects` over the other projects is the author's to run, since the list is private.
