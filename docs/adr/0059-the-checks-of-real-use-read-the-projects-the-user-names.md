# 0059 · The checks of real use read the projects the user names

**Status:** accepted (2.0.21, in the making). Extends ADR 0049 (the scorecard reads real use) from the `--projects` report to the total of the card.

## Context

The total of the scorecard read only the repository it ran in. Three weeks of real use of 2.0.20 happened in another project: 247 tasks (Claude Code 212, Codex 33, OpenCode 2) that the card never saw. It said 98.5 % with 9.9 (two agents) red, because this repository's own tasks are all Claude Code. `scorecard --projects` already pooled the projects listed in `~/.waymark/projects.md`, but only as a separate report.

## Decision

Five checks read the projects the user names (the Path column of `~/.waymark/projects.md`; a path that is not there, the root itself and a repeated path count once or not at all): 13.6 (`records.parcialShare`), 9.9 (`records.agentSpread`), 8.9 (`records.medianTokens`), 8.6 and 8.7 (`cost.routineShareL2`, `cost.routineShareL1`). The rest of the card (the chain, the size, the signature, the quality of the records, the precedent) still reads this repository only.

- The tasks are those of the measured version in each project (`BUILD_START` and `VERSION` are not touched by this ADR), ordered by date across projects.
- 13.6 and 8.9 read the last 30 tasks of all the projects together; 8.6 the last 10 L2 and 8.7 the last 5 L1 of the same set.
- **9.9 reads every task of the measured release, not the last 30.** In the data of 2026-11-18 the last 30 tasks of all the projects are Claude Code only; Codex appears from the last 59. A second agent is a property of the release, not of the last few days. `docs/scorecard.json` still says "recent tasks" for 9.9; its text is locked with the check and is not changed here.

## Consequences

- Measured on 2026-11-18 over the five listed projects: total 99.7 % (98.5 % before); 9.9 = 3 agents, 8.6 green, 8.7 = 0.076 against 0.065, and 10.3 (precision@3, this repository) at 0.849 against 0.85.
- The card now depends on a file of the user's machine: with no `projects.md` it reads this repository as before.
- A project the user lists adds its tasks to the release's numbers; a project whose tasks are poor lowers them. That is the point of reading real use.
- Specs: `tests/projects-total.test.mjs`.
