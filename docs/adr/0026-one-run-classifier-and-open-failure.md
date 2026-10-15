# 0026 · One classifier for what a command runs, and an open failure when the hook cannot tell

**Status:** accepted (2026-10-15 · T4, the user's picks: points 1–3 of the 2.0.15 plan, real transcripts for the corpus, this ADR). It continues `0020` (testigo integrity) and `0025` (an Evidencia backed by a check).

## Context
- **Every release since 2.0.7 patched a different testigo for a false ✘ or ⚠.** Review (2.0.7), Evidencia (2.0.9, 2.0.10), the spec red first (2.0.11), the build per repo (2.0.13), the gate cell, lint warnings and the clean copy (2.0.14). Each patch added a regex over a command's text inside `cierreGaps`, and the next command shape slipped past it.
- **The nearest case:** YaloAtiendo 2026-10-15 · T1 closed 11/12 because its last «gate» was a PowerShell script run from a scratch folder (`$T = "…\Temp\claude\…"`, `Push-Location $T; pnpm exec eslint …`). The hook saw `eslint` and counted a gate that was not the task's.
- **No safety net.** `tests/false-fails.test.mjs` had nine hand-made cases and none came from a transcript.

## Decision
- **A regression corpus first.** `tests/corpus/*.json` holds real turns (YaloAtiendo T1, five waymark turns with a false ⚠), trimmed to what the testigos read, plus the synthetic command shapes in `tests/corpus.test.mjs`. `tests/corpus.test.mjs` replays each through `cierreGaps`. A case that fails today is marked `redUntil` and runs as a todo, never hidden.
- **One module reads commands: `scripts/runs.mjs`.** `shellSkeleton`, `shellRuns`, `mutatesFiles` and `changesProject` moved there from `provenance.mjs` (which re-exports them). It adds the clean-copy detection (`copyPaths`, `inCopy`) and `commandKind(command, copies)`, which answers the one question the testigos ask: `copy`, `unknown`, `build`, `gate`, `test` or `aux`. The stop hook, the tool hook and `learn.mjs` import from it.
- **Open failure.** The hook blocks or lowers the result only on evidence it can read: the tool's output or the exit of the task's own gate. A gate or test run whose place it cannot tell is `apart`:
  - in a clean copy (`git worktree add …` or a later call naming its path), or from a temp/scratch folder (`cd`/`Push-Location` to it, a variable resolved from its assignment in the same command): `copy`;
  - from a variable nothing in the command assigns: `unknown`.

  An `apart` run is recorded on the gate (`apart: true`), is never the judged gate or a red test, and never produces «a command after the last change failed».
- **Evidencia reads what a person writes** (the cited fact is looked up in more forms, still a ⚠ and never a block): a command with its quoted path, a short phrase whose words one call holds together (tool name, input, output), `84/84` from «tests 84 … pass 84», a file name whose stem a call printed, and a result stored as JSON with its quotes escaped.
- **`cierreGaps` split (plan point 4, behavior-preserving).** The turn is observed once (`observeTurn`, `observeBuild`, `observeEvidence`), then each testigo is a function of what was observed: `decisionWitness`, `gateWitness`, `cierreWitness`, `procedureWitness` and the `WITNESS` table (one function per id: evidence, memory, review, build, docs, spec, red, preexisting, trailer, secrets, chain). `composeSteps` applies `routine.json` (which testigos apply at the level, `when`, `enforce`); `cierreGaps` only composes. The 306 tests and the corpus did not change.

## Alternatives considered
- **Keep patching each testigo.** Rejected: it is what produced eight releases of false fails.
- **Make every unclassified command block until the agent says what it was.** Rejected: it moves the false ✘ to the agent's time, the failure this ADR removes.
- **Parse PowerShell fully.** Rejected: the hook needs the place a run executed, which `cd`, `Push-Location` and a variable's assignment give; a parser adds a dependency for no more decisions.

## Consequences
- The corpus grows with every false result found in a real task; a fix lands with its case.
- Points 4–7 of the plan (split `cierreGaps`, a shared `lib/`, split `provenance.mjs`, shared adapter code) run on this net: the corpus and the suite must stay green.
- A real failure in an `apart` run is not held against the task. The agent's own gate (or the typecheck the hook re-runs) still decides Verificar.
- Not done here: the testigos still hold regexes for review, pack and memory commands; they move when `cierreGaps` is split (point 4).
