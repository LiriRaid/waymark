# 0055 · A task the hook closed without a Cierre is closed afterwards by an appended record

**Status:** accepted (2026-10-30). The user's pick (2026-10-30 · T13b). It continues `0025` (the chain and its anchors) and `0044` (one task, closed by the person who asked for it).

## Context
- A turn that waited on a `Monitor` (a watch on a gate) ended with no Cierre. Its second stop was recorded in red, with `cierre: ""` and `outcome.result: null`. The cause is fixed (`pendingBackground` waits for a non-persistent Monitor, up to the cap of a background agent), but two tasks of the build, whose work was done, tested and committed, were left with a record that says they never closed.
- A record with a commit is a git note, anchored and chained. `forget` refuses it, and editing it would break the chain.

## Decision
- **`waymark.mjs close "<task ID>" --evidencia "…" --aprendido "…" --reason "…" [--result hecho] [--apply]`** appends one chained record `{kind: "close-late", task, taskSession, by: "user", cierre, result, reason, at}`. Without `--apply` it shows the plan.
  - The Evidencia and the Aprendido are written by the user (or by the agent for the user, from what the task did); the command never makes them up, and refuses a task that already has a Cierre, an unknown task and a missing reason.
- **The read applies it.** `readTaskRecords` gives the task that Cierre and result, marks it `closedLater: {at, by, reason}`, removes the owed-Cierre line from `unresolved` and corrects **only the Cierre step** of its evaluation (`score` +1). Every other step stays as the hook judged it, so a task that also failed Verificar still shows it.
- The note, the log lines of the task and the anchors are not touched; `verify` still passes. The task's own history shows both facts: it closed in red, and it was closed afterwards, when and why.

## Consequences
- A scorecard measured over the records counts such a task as closed with a complete Cierre; the record keeps `closedLater`, so the way it got there is visible.
- It is not a way to hide a failure: it supplies a Cierre, not a pass of the other testigos.
