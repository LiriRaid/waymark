# 0038 · The ask kept as items and answered, options with their attributes, claims backed, redone work shown

**Status:** accepted (2.0.18, point 10). Amends ADR 0030 (the fields `asked` and `options` are now filled from the Pedido line and judged) and ADR 0033 (the scorecard now names this ADR, whose lock replaces the one in 0033).

Scorecard-Lock: e1bc77d6c9e882da8cb065bb40a5cfe0bdc270c073fce3ad77c915c6d2a0eaa9

## Context

Criteria 11 and 13 ask that a task is complete and done the way it was asked, and that the decisions put in front of the user can be judged. Until now the `Pedido` line was "for you, not checked": nothing compared what was asked with what the Cierre says was done, the choice window's options carried whatever the agent wrote, the share of claims a tool call backs was computed per record and never shown, and a task that had to be redone as a follow-up looked like any other. The thresholds of two checks were left open (`null`) until this point, to be frozen from the baseline.

## Decision

All four choices are the user's (2026-10-17): block once, the format in `l2.md` and the hook's message, a finding for the options, the thresholds below.

- **The ask as numbered items.** At L2+ the agent writes the `Pedido` line with its requirements numbered, `Pedido: 1) … 2) … · Captura: …`. The hook reads the last such line of the task (before any `## Cierre`) from the transcript: the numbers run from 1 without a gap and fewer than two is not a list (nothing to answer one by one, and no tokens spent on it). The record's `asked` holds them (the Pedido line first, else the user's own list, as before).
- **The Cierre answers each item.** `Pedido: ✔1 <evidence> · ✘2 <why not>` (the marks may continue on the lines below). `askedGaps` compares: an item with no mark is named, and `Resultado: hecho` over an item marked ✘ is a contradiction. Both are said by the `cierre` testigo, which already blocks once: the agent answers the item or writes `Resultado: parcial (<what is missing>)`. If it insists, the unanswered item stays in the record's `unresolved` and the record's `outcome` reads `parcial` (with `said: hecho` and why), never `hecho`. The answers are kept in `answered: [{ n, ok, note }]`. L1, Q and L0 are not asked for it.
- **Where the format is explained.** In `references/protocol/l2.md` (read only at L2+) and in the hook's message, not in the instructions block: the fixed context stays at its frozen threshold and Q, L0 and L1 pay nothing.
- **Options with their attributes.** `optionsLint` judges the first choice window of an L2+ task (the later ones only confirm): each option's description must state its risk and its files or its cost, and exactly one option of each question is marked `(Recommended)`; a window of one option, or a question asked in the chat with no options known, is not judged. A window that lacks them is a finding in the record and in `findings` (`observed.options.missing`), recorded and not blocked: asking the user again costs more than the defect.
- **Claims backed, per task and per version.** `observed.evidence` already holds the facts the Cierre cited and the ones no tool call shows. `tasks.md` shows `backed` per task as `10/10` and marks `⚠` below 0.95, and `waymark.mjs cost` shows the sum per version and level (`57/60`).
- **Redone work.** `tasks.md` lists, under *Redone or reworked*, the tasks whose files came back: redone as a follow-up (read from the IDs, never stored: a chained record cannot be edited when a later one continues it) and those a record says rework an earlier task (`reworks`, `reworkFiles`, within seven days).
- **Thresholds frozen from the baseline** (the user's choice, measured on this project's records on 2026-10-17: backed 0.957, redone 0.167): check 11.2, the share of cited facts backed by a call, at least 0.95; check 13.5, the share of recent tasks redone as a follow-up on the same files, at most 0.20. Both pass today and fail on a regression. The scorecard names this ADR; its lock is the line above, and a test fails if `docs/scorecard.json` changes without a new one.

## What it proves, and what it does not

That every numbered item of the ask has an answer in the Cierre, and that none of them says `hecho` over its own ✘. It does not prove that an answer is true (the Evidencia testigo checks that what it cites is backed by a call; the items are the agent's own list), that the agent numbered the requirements the way the user would, or that a list of one requirement was complete. A task redone as a follow-up is a signal, not a verdict: the user may have changed their mind. The options check reads words in the description (risk, files, cost, a mark), not whether the numbers are right.

## Alternatives considered

- **Only a warning for an unanswered item.** The plan says the Resultado cannot read `hecho`; a warning nobody reads would not stop it. Rejected for blocking once, which every other testigo of the Cierre does.
- **The format in the instructions block.** About 105 characters in every session against a fixed context at 10,886 of a frozen 11,000. Rejected: it is the cost the release is meant to cut.
- **Block the close for options without attributes.** It would make the agent ask the user the same question again. Rejected for the finding.
- **Stricter thresholds (0.97 and 0.15).** Both would fail today and leave criterion 11 and 13 below their target until the tasks improve. Rejected for the baseline.

## Consequences

- Scorecard checks 10.6, 11.2, 11.3, 13.2, 13.3, 13.4 and 13.5 pass.
- Records from this release carry `answered` when the Pedido was a list, and `observed.options` (`null` when nothing was judged). Older records are read as before.
- The `Pedido` line of the task can be read from the record (`asked`) without the transcript, which the precedent search (ADR 0033) and the dataset of 3.0.0 can use.
