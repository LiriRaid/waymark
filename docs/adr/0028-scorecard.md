# 0028 · The scorecard: what "95 %" means, computed by checks

**Status:** accepted (2.0.18, point 0)

Scorecard-Lock: bc73d04ac8362d3bdfba76795e3ef20ae7e877c15b1571ccfd271f71bc4537bd

## Context

Every review of Waymark found more to improve because "100 %" was never written down: each pass used different evidence and found different gaps. The author's goals are several, not one: a supply chain of the agent's work (provenance, tamper evidence, authenticity, verification, enforcement, pinned inputs, distribution) and a way of working that spends fewer tokens, is agnostic of agent, stack and project, adapts when the work moves to another agent, reuses the evidence of a similar earlier task, does not hallucinate, puts good decisions in front of the user, generates what it needs, and finishes a task completely and as asked. The plan for 2.0.18 (`docs/plans/2.0.18.md`) fixes the weights; this ADR fixes how they are measured.

## Decision

`docs/scorecard.json` is the definition: 13 criteria with a weight each (they add to 100) and 81 checks. A check is deterministic and is one of: `exists` (files or folders), `contains` (every pattern is in some of the files), `absent` (no file matches), `run` (a command exits 0) or `measure` (a named number computed from the project's records or the sources, compared with a threshold). A check scores 1 or 0, or a ratio against its threshold capped at 1. A criterion is the mean of its checks (every check weighs the same inside its criterion); the total is the sum of weight × criterion and is never rounded up. A check that is not built yet scores 0 and names the plan point that adds it (`point`; 0 means it holds today), so the baseline counts what exists and the work of the release is exactly the checks that fail. A threshold of `null` is frozen later, from the baseline and in the choice window (points 3, 5 and 10), and scores 0 as `pending` until then. A measure that cannot be computed yet scores 0 as `unmeasured`.

`waymark.mjs scorecard [--json] [--min <total>]` (`scripts/scorecard.mjs`, run from the repository root) prints each criterion with its failed checks and the total. The scorecard is locked: `Scorecard-Lock` above is the sha256 of `scorecard.json` without its `adr` and `about` fields, with keys sorted; `tests/scorecard.test.mjs` fails when the file and the lock differ, when the weights do not add to 100, or when a check names a measure that does not exist. A weight, a criterion, a check or a threshold changes only with a new ADR that carries the new lock and is named in `adr`; `scorecard` prints `lock MISMATCH` otherwise.

Names the checks look for, fixed here so the points that follow build to them: record schema `waymark.record/v2`; fields `taskType`, `cost.byCall` (`byCall`), `followUps`, `reworkFiles`, `asked` (written as `asked: askedItems(…)`), `options[].{files, risk, estCost, recommended}`, `precedent`; functions `signAnchor`, `signAttestation`, `detectGuarded`, `optionsLint`, `askedItems`, `askedGaps`; the preference line `Notes push:`; the command names `cost`, `adapter-new`, `stack-new`; the files `scripts/gate-tests.mjs`, `.github/workflows/verify.yml`, `bench/replay.mjs`, `bench/reference.mjs`, `skills/waymark/skills.lock`, `skills/waymark/scripts/precedent.mjs`, `tests/conformance/cases.json`, and `~/.waymark/reference-repos.json` (outside the repository).

## Baseline (measured by the checks, 2026-10-16, version 2.0.17)

| # | Criterion | Weight | Measured | Target |
|---|---|---|---|---|
| 1 | Provenance of each task | 8 | 24.5 % | 98 |
| 2 | Tamper evidence | 8 | 50.0 % | 96 |
| 3 | Authenticity | 8 | 28.5 % | 95 |
| 4 | Independent verification | 5 | 33.3 % | 98 |
| 5 | Enforcement | 8 | 33.3 % | 93 |
| 6 | Inputs and dependencies pinned | 5 | 33.3 % | 95 |
| 7 | Distribution of the records | 3 | 66.6 % | 95 |
| 8 | Token efficiency | 15 | 12.5 % | 96 |
| 9 | Agnostic and adaptive | 12 | 45.1 % | 96 |
| 10 | Reuse of earlier evidence | 8 | 16.6 % | 93 |
| 11 | No hallucination, good decisions | 8 | 60.0 % | 95 |
| 12 | Self-generating | 6 | 40.0 % | 93 |
| 13 | Task done completely and as asked | 6 | 20.0 % | 93 |

The total is **33.2 %**, not the ≈63 % the plan estimated. The estimates were a judgment of how good each area is; the checks count what is built and proven, so everything the release still has to add is a failing check by construction. The table in this ADR replaces the plan's estimates; the plan's targets stay.

## What writing the checks found

- The sensitive-path guard already denies a shell command whose arguments name a protected path (ADR 0027 §8), so plan point 9(a) is partly done: what is missing is a test per reader (`type`, `Get-Content`, `head`, `tail`, `less`), which check 5.3 asks for.
- Five agents with documented hooks have no adapter (`windsurf`, `qwen`, `droid`, `amp`, `crush`): check 9.1 scores 8 of 13. Closing it belongs to point 11 (`adapter-new` and the conformance suite) or to a later ADR that relaxes the threshold; it is not decided here.
- Of the last 30 task records, 17 lost their detail: the log line is there, chained and anchored, but the git note that holds the request, decisions, evidence and gates cannot be read (`(its git note is missing: a rebase or amend?)` in `tasks`). The chain still verifies; the detail does not exist. Check 1.10 scores 13 of 30 (0.433). The fields the other record checks read are measured on the tasks that kept their detail, which all pass.
- Token cost of a task, the routine share and the cost of a small task are `unmeasured`: `waymark.mjs cost` is point 3.

## Alternatives considered

- **Checks added per point, no ADR needed.** Less work now, but the baseline would measure only what exists and the target could drift again. Rejected: the point of this release is that it cannot move.
- **A weight per check.** Finer, but 80 more numbers to fix and defend, and easier to move without noticing. Rejected for one mean per criterion.
- **Weights as the author's estimates only.** What every earlier pass did. Rejected: no check, no number.

## Consequences

- Every later point states the checks it makes pass; `scorecard` after each point must not fall.
- Check 3.1 reads the signature of the latest release tag, not of the manifest: the manifest is regenerated (and so unsigned) at every point that adds a file, so its signature is verified once, at the release, by `verify --install --require-signature` (plan point 12).
- Thresholds frozen later (points 3, 5 and 10) need an amendment ADR with a new lock; that is the only way a number in `scorecard.json` changes.
- What a check cannot show (learning over months, many models, many users) stays outside the score and is listed in the README as not measured.
- The scorecard runs on the author's records (`.waymark/` of this repository); on a clean clone the record measures are `unmeasured`.

## Result at 2.0.18 (point 12, 2026-10-19)

`waymark.mjs scorecard` on the finished work, lock ok, on the author's records. The table of this ADR is the one that counts, and no row was rounded up. The records-based figures (rows 1, 8 and 11) move with every task recorded after this paragraph was written.

| # | Criterion | Weight | Baseline | Result | Target | Met |
|---|---|---|---|---|---|---|
| 1 | Provenance of each task | 8 | 24.5 % | 96.6 % | 98 | no |
| 2 | Tamper evidence | 8 | 50.0 % | 100 % | 96 | yes |
| 3 | Authenticity | 8 | 28.5 % | 100 % | 95 | yes |
| 4 | Independent verification | 5 | 33.3 % | 100 % | 98 | yes |
| 5 | Enforcement | 8 | 33.3 % | 100 % | 93 | yes |
| 6 | Inputs and dependencies pinned | 5 | 33.3 % | 100 % | 95 | yes |
| 7 | Distribution of the records | 3 | 66.6 % | 100 % | 95 | yes |
| 8 | Token efficiency | 15 | 12.5 % | 96.7 % | 96 | yes |
| 9 | Agnostic and adaptive | 12 | 45.1 % | 98 % | 96 | yes |
| 10 | Reuse of earlier evidence | 8 | 16.6 % | 100 % | 93 | yes |
| 11 | No hallucination, good decisions | 8 | 60.0 % | 99.8 % | 95 | yes |
| 12 | Self-generating | 6 | 40.0 % | 100 % | 93 | yes |
| 13 | Task done completely and as asked | 6 | 20.0 % | 100 % | 93 | yes |

The total went from **33.2 %** to **98.9 %** when point 12 closed, and reads **98.1 %** at the close of the release (2026-10-19), after the tasks of the last day were recorded; the release target was 95. Two criteria end below their own target, and two checks still fail inside criteria that meet theirs:

- **1.10** (records whose git note can be read: 0.633, needs 0.95). Ten tasks (2026-10-16 T19 to 2026-10-18 T1) have a commit and no record because the end-of-turn hook did not run: the author's Node was left on version 14, which cannot parse it, and nothing said so (ADR 0040, which closes that gap with a launcher). The chain verifies; the detail does not exist and is not rebuilt, because a record made afterwards is not what the hook observed. The share rises with the tasks recorded from now on.
- **8.2, 8.6 and 8.7** (criterion 8 at 91.3 %, target 96). The fixed context is 11,036 characters against 11,000: the session card lists the tasks still open, so it grows until they are closed. The routine share is 9.2 % of the last 10 L2 tasks against at most 9 %, and 19.7 % of the last 5 L1 tasks against at most 6.5 %: the short release steps of the last day (a push, a signature, a tag) were mostly choice windows, Cierres and the hook's returns. Reaching the thresholds takes a routine response removed, which the replay cannot show; they stay frozen as ADR 0031 set them, and nearly every task they read ran on the installed 2.0.16.
- **9.1** (11 of 13 known agents have an adapter). Qwen Code, Droid and Amp got theirs in this point (ADR 0041), written from their documentation and judged by the conformance list, with none of them run in a live session. Windsurf and Crush have none: Windsurf has no session start and no way to hand the model context, and Crush has one event, before a tool, so neither could carry a record, a Cierre or a card. ADR 0039 rejected redefining the check.
- **11.2** (cited facts backed by a call: 0.927, needs 0.95). Read from the latest task records; it moves with them.

Notes were pushed once by the author's yes (criterion 7), and `verify --remote` matched 105 anchors; ADR 0042 later took them off the public remote, and check 7.1 now counts notes waiting only in a project that said yes. The release steps that need the author's key (the signed manifest, the signed `v2.0.18` tag, `verify --install --require-signature`) were run by the author after the last commit, since the guard keeps the agent away from `~/.ssh`; check 3.1 reads the latest release tag, so it holds from the signed tag on.
