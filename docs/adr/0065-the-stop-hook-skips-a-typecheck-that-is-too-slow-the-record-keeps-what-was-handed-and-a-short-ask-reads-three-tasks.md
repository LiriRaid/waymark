# 0065 · The Stop hook skips a typecheck that is too slow, the record keeps what was handed, and a short ask reads three tasks

**Status:** accepted (2.0.21, in the making). Failure 8 (latency of the Stop), failure 20 (the procedure the hook did not hand) and check 10.3 of `docs/plans/2.0.21.md`, plus the three findings of the review of ADR 0062 to 0064.

## Decision

- **Latency of the Stop (failure 8).** Measured on 2026-11-18: the hook's own typecheck re-run is the dominant cost: `pnpm exec tsc --noEmit` took 8 s in the front-end repo and was killed at the 40 s limit in the API repo, while the slow Stop runs in `latency.log` are 4 to 16 s on small transcripts (the size of the session is not the cause). `cachedGate` (`testigos.mjs`) now keeps the time of each repo and command (`~/.waymark/.gate-time.json`, a day) and does not run the gate again (for a day) when it took `WAYMARK_SLOW_GATE_S` (default 10) seconds or more: it answers `{ ok: null, skipped: true, s }`, the stop hook asks the agent to run its own gate ("takes about N s, too slow for the hook to re-run"), and `W testigos` shows it as skipped, never as a failure. The first run in a repo is still made and measured; after a day it is measured again, so a slow cold-cache run does not keep it skipped.
- **What was handed (failure 20).** The packed state keeps, per task, the department routed at the first change (`first`, null when no route was readable yet) and each delivery with how it came (`edit` or `load`, `late`). The record carries them under `observed.procedure` (`firstEditDept`, `deliveries`), so the next reading can tell "nothing handed because no route yet" from "handed late".
- **Check 10.3.** A short ask (fewer than 10 words) was searched with the session's previous task beside it; it is now the session's last three (`RECENT_OF_SESSION`). The held-out evaluation of this repository went from 0.846 to 0.864 of 162 tasks; the hand-over's own precision moved from 0.702 to 0.697, and neither the threshold, the evaluation nor the data were touched.
- **Findings of the review.** The reminder of a change (ADR 0062) no longer lists verbs that name no change (`escribe`, `write`, `make`, `haz`, `hazlo`) and is given only at a task's first prompt; `hookCommand` lives once in `lib/paths.mjs`; a steering file the user edited is copied to `.waymark-bak` before the Kiro install rewrites it.

## Consequences

A repo whose typecheck is slow gets one slow Stop and then none for a day; the agent runs the gate itself, as the block already asked. The latency to re-measure after the reinstall is the Stop p95 (`W check`). Specs "8:", "10.3:", "20:" and "review:" in `tests/real-use-2021b.test.mjs` and `tests/procedure.test.mjs`.
