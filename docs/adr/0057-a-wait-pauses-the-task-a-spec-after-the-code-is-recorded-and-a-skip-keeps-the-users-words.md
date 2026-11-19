# 0057 · A wait pauses the task, a spec after the code is recorded, and a skip keeps the user's words

**Status:** accepted (2.0.21, in the making). Changes three rules of the end-of-turn hook; ADR 0056 changes a fourth.

## Context

The same reading of three weeks of real use of 2.0.20 (247 tasks, 2026-11-18) showed three rules that blocked work the user did not mean to stop:

- 75 of the 94 blocks "the Cierre is missing" were progress messages that end waiting ("avísame cuando lo reinicies", "espero su aviso"). Only a closing question with options paused a task.
- 43 of the 53 Tests ✘ were "a spec that adds cases never ran before the code it tests: show it red in a clean copy", asked for specs written after the code, which cannot be seen red in the working tree.
- 17 of the 34 Review ✘ carried "Review: omitido (usuario: «…»)" that the hook refused: the user's words ("el code-review se hará en general") were said in an earlier prompt, and only the current task's prompts were read.

## Decision

1. **A wait pauses the task** (`namesWait`, `pausedReply` in `stop-hook.mjs`): a reply with no Cierre whose last paragraph names a wait (for the user's step, a restart, a notice) and does not claim to be finished is a pause, like a closing question. A reply that claims to be finished (terminé, hecho, aplicado, listo at the start of a sentence) is not.
2. **A spec written after the code is recorded** (`observed.tests.afterCode`): no clean copy is asked, and the spec must still run green after it (the testigo of the spec that changed after the last run). A spec written first still owes its run before the code.
3. **A skip keeps the user's words** (`earlierWords`, `ruleWords`, `ctx.userWords`): a skip quoted as the user's counts when the words are in this task's prompts, in an earlier prompt of the session, or in a rule the user wrote (`~/.waymark/preferences.md`, the Conventions of the project's `memory.md`). When they come from an earlier prompt the record says so and offers writing the rule in `preferences.md`.

## Consequences

- The instructions block still says "the spec ran before the code it tests, or in a clean worktree": it is at 6,496 of 6,500 characters and cannot take the exception; this ADR is where the rule is written.
- A wait phrase list is short by design and grows with real use; a wait it does not know keeps the old block.
- The Conventions of `memory.md` may hold a line an agent wrote with the user's yes; the user authorised each line, so it counts as written by them.
- Specs: `tests/real-use-2021.test.mjs` (cases "14:", "15:", "16:"); `tests/hooks.test.mjs` and `tests/truth.test.mjs` changed three cases that fixed the old red-first rule.
