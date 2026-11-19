# 0062 · A request that asks for a change is told to route as one, and the record keeps the declared level

**Status:** accepted (2.0.21, in the making). Failures 1 and 13 of `docs/plans/2.0.21.md`: 21 of 247 real tasks started as a question (Q) and then edited files, and the user saw the hook judge a level other than the one declared.

## Context

A turn routed Q that changes files is denied once by the pre-tool hook and must re-route in the middle of the turn (a step lost); the end-of-turn hook judges it as L2. The hook that classifies the prompt (`rule0-hook.mjs`) said nothing about it. The records kept only the level the hook measured, so "the level is lost after the task is created" could not be confirmed or refuted from them.

## Decision

- **Failure 1:** `asksChange(prompt)` reads a request to change something from the prompt alone: a verb that asks for the change (create, add, fix, change, update, implement, remove, rename, refactor, migrate…, in Spanish and English) and not a plain question (how, why, what, where…, "explain"); "can you / could you / puedes / podrías" make a question a request. `changeLine(prompt)` adds one line to the reminder: "The request asks for a change: route it as L<n> (not Q; Q is read-only) and re-route if it grows". n is L3 for a refactor or a migration, L2 when the prompt names two or more files, else L1. The Q rule of the instructions block does not change: a question stays read-only. A false positive costs one line; no network and no model.
- **Failure 13:** `cierreGaps` returns `declared`, the level the turn's routing line declared (a number, `'Q'`, or null when there is no line), and the record keeps it as `declared` next to `level` (the measured one). An unrouted reply inside an open task is not a declaration: it records null, never a guess.

## Consequences

The next reading of the records can count, per task, where declared and measured differ (L1 declared and L2 measured, Q declared and changes made). Old records have no `declared` and read as null. The reminder grows by about 25 tokens on a prompt that asks for a change. Specs "1:" and "13:" in `tests/real-use-2021b.test.mjs`.
