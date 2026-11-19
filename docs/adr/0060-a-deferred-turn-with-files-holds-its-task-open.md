# 0060 · A deferred turn with files holds its task open

**Status:** accepted (2.0.21, in the making). Completes the deferral fix of failure 7 (the turn after a notice reaches back to the task's prompt).

## Context

A turn that launches a background run is deferred: the hook records an `unevaluated` line with the files the turn changed and waits for the notice. The notice, when it comes, wakes the turn and the whole task is judged. When it never comes (the session was closed, the agent died) and the user sends another prompt, that prompt started a turn of its own: a question ended as a question record and the deferred task's files, up to 26 in the real use of 2.0.20, were never judged or recorded. Four such lines were still in `tasks.md`.

## Decision

`unclosedDeferral` (`transcript.mjs`) finds the earliest deferral of the session that changed files, has no close after it and is under 24 hours old. While one exists, the stop hook reads the prompts after it as continuations of the same stretch (their words stay in the task's prompts): the stretch is judged from the deferred task's prompt, the question's answer included, and the Cierre is asked as for any task. A close ends it. A deferral older than a day stops holding prompts and stays in `tasks.md` as not evaluated.

## Consequences

- A question asked while a deferred task is open is answered and the hook asks the Cierre of the stretch in the same turn; with the background run still running (under its wait) the turn is deferred again.
- A session that abandons a deferred task keeps it open for a day at most.
- A different task asked meanwhile joins the stretch and is closed under the deferred task's ID: the hook has no signal that tells a new ask from a follow-up. Closing the deferred task first (its Cierre, or `W done`) separates them.
- Spec: `tests/real-use-2021.test.mjs` (cases "7b:").
