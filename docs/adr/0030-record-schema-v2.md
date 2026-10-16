# 0030 · Record schema v2: the fields the hooks derive

**Status:** accepted (2.0.18, point 2)

## Context

Records are chained by hash and anchored in git, so a record cannot be edited after it is written and a field cannot change meaning. ADR 0027 named a "migration rule when v2 appears" and listed what a later reader (a verifier, the 3.0.0 dataset) lacks in a v1 record. The 2.0.18 plan needs five things the records did not carry: what kind of task it was, the ask as items, the options of each decision with their attributes, the tokens of each tool call, and whether the task redid work another had just done. All of them must be derived by the hooks from what the transcript and the chain hold, never typed by the agent.

## Decision

New records are `waymark.record/v2`. A v2 record holds everything a v1 record held, unchanged, plus these fields; a field with nothing to say is absent, not null. All of them come from `scripts/provenance/derive.mjs` (and `costByCall` in `transcript.mjs`).

| Field | Meaning | Derived from |
|---|---|---|
| `taskType` | `fix`, `feature`, `refactor`, `docs`, `test`, `config` or `question` | files first: no file changed, or a Q, is `question`; every file of one class (docs, test, config; a fixture under `tests/` is a test) gives that class. Otherwise the verb of the ask that comes first in the text (Spanish and English, accents removed): fix, refactor, feature. Nothing decides it: absent. A label that is a guess would feed the dataset. |
| `asked` | the items of the ask, when it was written as a numbered or bulleted list of two or more lines (at most 12 items of 160 characters) | the user's prompt. Point 10 fills it from the `Pedido` line as well; the field and the function (`askedItems`) are shared. |
| `decisions[].options` | each option of the choice window as `{ label, recommended, files, risk, estCost }` | `recommended` is the label ending in `(Recomendada)` or `(Recommended)`; `files`, `risk` and `estCost` are read from the option's description when it says them ("riesgo bajo", "costo: ~2 KB", "3 archivos"), else null. `chosen` and `discarded` keep their v1 meaning. |
| `reworks`, `reworkFiles` | the earlier tasks of the project that changed one of these files in the previous 7 days, and the files | the project's log (ids, dates, files); a question, the task itself and anything older than the window do not count. A follow-up of the same task counts: it is the signal that the earlier close was not complete. |
| `cost.byCall` | `[tool, link, input, cacheWrite, cacheRead, output]` for each tool call of the turn; `link` is `r` (routine) or `w` (work), the same rule as `evaluation.links` | the transcript. A response that issues several calls is one billed response: its tokens are split among its calls in equal parts, the remainder to the first ones, so the calls add up to the response and, with the replies, to `links`. Subagents are not in it, as in `links`. |
| `precedent` | the earlier task the hook handed over at the start | point 5; absent until then. |

`followUps(records, id)` (the letters of a task: `T15b`, `T15c`) is read from the records and never stored: a chained record cannot be edited when a later one continues it.

**Migration rule.** A field is added, never repurposed, removed or renamed; a change of meaning is v3 with its own ADR. A v1 record stays as written; a reader takes a missing field as "not derived then", never as zero. `verify` accepts v1 and v2 together (the chain does not depend on the shape), counts the shapes it finds (`record shapes: v1 ×15 · v2 ×3`) and warns, without failing, on a shape this release does not know (a newer Waymark wrote it). `replayV2(record, records)` shows any record as v2 with what can be derived from what it holds (`taskType`, `asked`, `reworks`, the options of a decision from its picked and discarded labels); it writes nothing, and what was never kept (the tokens per call, an option's description) stays absent.

The decisions of this point, taken by the user on 2026-10-16: files before verbs for `taskType`, with no label when nothing decides it; a 7-day window for rework; every call kept as a compact tuple (about 3 KB for an L3 task) rather than the dearest 25 or a total per tool; and the derivable part of `asked`, `options` and `precedent` filled now, not only reserved.

## Alternatives considered

- **Verbs first for `taskType`.** Covers more asks, but "arregla el README" would read as a fix, and a pasted prompt skews the label. Rejected.
- **Always a label (`feature` by default).** 100 % coverage by guessing. Rejected: the label feeds the 3.0.0 dataset.
- **Only the 25 dearest calls, or a total per tool.** A smaller record, but `waymark.mjs cost` (point 3) could not recompute a version's cost over every call. Rejected.
- **Only reserve the names of `asked`, `options` and `precedent`.** Less code, but the scorecard counts them at this point (checks 1.7 and 1.8) and a field nobody fills proves nothing. Rejected.
- **Store `followUps` on the earlier record.** Impossible: the record is chained. A computed view does it.

## Consequences

- Scorecard checks 1.3 to 1.9 pass; criterion 1 reaches 95.2 %, and what is left is check 1.10 (records that lost their note), which is not about the shape.
- The record grows by about 3 KB for an L3 task (the tuples) and a few hundred bytes for the options.
- `provenance.mjs` gains eleven public names and a module (`derive.mjs`); `tests/provenance-split.test.mjs` lists them.
- What this does not show: the options' `files`, `risk` and `estCost` are mostly null until point 10 asks the choice window to state them; `asked` is empty for an ask written as prose; `precedent` waits for point 5; and the tokens per call of the v1 records already written cannot be recovered.
