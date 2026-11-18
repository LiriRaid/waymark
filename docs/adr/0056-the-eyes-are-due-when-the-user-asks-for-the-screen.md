# 0056 · The eyes are due when the user asks for the screen

**Status:** accepted (2.0.21, in the making). Changes the condition of ADR 0047; the rest of 0047 (the look after the last change, local pages only, one ego space per task) stands.

## Context

ADR 0047 made the testigo "Ojos" due at every seen change at L2 or more (and at an L1 of styles and templates with no spec), whenever a browser to look with existed. Three weeks of real use of 2.0.20 in a web project (247 tasks, read on 2026-11-18) showed the cost: of 161 tasks that carried the step, 83 failed it, and 21 of the 46 whose request named neither the browser, a check of the screen, a screenshot nor a design link also failed it. Each failure was a block, a "Ran 1 stop hook" and a ✘ in the close of a task where the user never asked to see the screen.

## Decision

`eyesDue` (`skills/waymark/scripts/eyes.mjs`) takes `asked`: the eyes are due only when a prompt of the task names ego, the browser or the screen (`asksEyes`), or the request carries a screenshot or a design link (`requestRefs`). For every other task the testigo does not apply: it is not blocked, it does not count in the evaluation and it does not appear in the close. The look itself, when due, is judged as before.

## Consequences

- A seen change nobody asked to look at is no longer checked by the hook; the user asks for it in the request ("míralo con ego") when they want it.
- The words are read from every prompt of the task, so a description of the app's behavior that holds the word "navegador" also asks for it; the cost is the old behavior on that task, not a new one.
- The claim of the testigo in `routine.json` and in the instructions block keeps its old wording: the block is at 6,496 of 6,500 characters and cannot take the condition. This ADR and the README say it.
- `omittedOf` still names "sin navegador" only for a task that owed the look.
- Specs: `tests/real-use-2021.test.mjs` (cases "9:"); `tests/eyes.test.mjs` and `tests/early-close.test.mjs` now ask for the browser in their prompts.
