# 0044 · A record for the work, none for what is not work, and one task closed by the person who asked for it

**Status:** accepted (2.0.19). Extends ADR 0016 (the context brakes), ADR 0015 (the open turn and the record of a question) and ADR 0038 (a task done as asked).

## Context

Four days of real use showed the records disagreeing with the work, in both directions:

- **Work with no record.** A background agent's notification carried no `tool-use-id`, so the turn waited for it for good: 1.5 hours of L3 left no ID, no Cierre and no decisions. A turn the user interrupted lost its edits (the next turn read from its own prompt). A session that moved into a sibling repo left its Cierres in one log and nothing in the other.
- **Records with no work.** A notification after the close, an empty prompt or a repeat of the last ask became `T<n>b` rows of the same ask; a courtesy message, or a turn that only wrote memory, became a task.
- **Tasks that never closed.** Fourteen `▶` lines piled up. A step that was the user's (their deploy, their PR) left a task `parcial` every time. Three different requests chained as `T16 → T16b → T16c` over six hours, 87 files and 96.7M tokens, while the context warning, informational, was ignored. The brake that should have advised was switched off by a `parcial`: a session reached 879k without a word.

## Decision

- **A background agent is released by its `task-id` as well as the launch's `tool-use-id`**, is not waited for past 30 minutes, and a reply that already carries its Cierre is judged while the review runs.
- **The edits of a turn that never closed are judged with the next one.** The per-prompt hook keeps the session's snapshot while its last turn is still open (`open.json`, at most six hours old), so the diff the end-of-turn hook reads starts where the work did.
- **No record without work:** a turn that no prompt started (a notification after the close), an empty one, a repeat of the last task's ask, a courtesy, or one that only wrote the routine's own files, and changed nothing, writes no record. A task that changes another project's files leaves a short `touched` record there (no ID of its own, so that project's counter never moves); a project the task committed in already holds it as a git note. A second session with a turn open in the project is named in the prompt line.
- **One request is one task, closed by the user's word.** The close asks "¿Se completó lo que pediste?"; a bare "sí" after a `hecho` is read by the per-prompt hook, which records `confirm`, removes the `▶` line and stops the prompt before the model (0 tokens; an agent that cannot stop a prompt is told in one line). It does not apply when the reply ended asking something else, when the task is not the session's last record, or when it was not `hecho`. Anything else continues the task as a follow-up.
- **A step the user owns never leaves a task `parcial`.** When the project's Conventions (or the user's preferences) give a step to the user in their words (`Deploys: the user`, `PRs: the user`) and the Cierre's only gap is that step, the record says `hecho` with `userOwned`. A `parcial` for a cause outside the work (the quota, a provider) is marked `cause: external`: the next ask is a new task unless the user says it continues.
- **A big task is told to split, never held.** Past 60 minutes, 150 tool calls or 40 changed files (a project changes them in `memory.md`: `Soft cap: 90 min / 200 calls / 60 files`), the agent is told once to offer closing it and opening a new task. Past ~500k of context mid-task it is told once per step to offer a new session; the brake holds a message only between tasks, and a task closed `parcial` or `bloqueado` no longer switches it off.
- **"Apply the findings" is the user's own decision.** A review already said what is wrong, so a prompt that orders exactly that fix counts as the decision and is recorded in their words; a batch that only applies them is asked for one delta review of the files it changed, not a whole round.
- The options-attributes finding and the Cierre-heading rule that point 3 left for this record are as built there (the attributes asked of the recommended option only; a question prints no Cierre with an ID).

## Alternatives considered

- **Reserve each open turn's ID so two sessions never share one.** Built and reverted: the design (and the handoff test) is that an open task has no number until it closes, and a duplicate is renumbered by the hook at the close; reserving made a handoff to another agent skip the number of the task it was continuing. The warning line stays.
- **A full copy of the record in each repo the task touched.** It would put the same prompt, cost and decisions in two chained logs and count the task twice. Rejected for the short `touched` record.
- **The agent runs `done` after the user's "sí".** It costs a response (every response re-reads the whole context) and fails whenever the agent forgets. Rejected for the hook.
- **The soft cap holds the message, like the brake.** It would hold the user's message mid-task; the brake already held two important ones once. Rejected: it only tells.

## Consequences

- A task that touched a sibling project shows there as "Touched from another project" in `tasks.md`; its record and its ID live in the project it ran in.
- A project whose Conventions give deploys to the user closes those tasks `hecho`; with no such line they stay `parcial` as before. Waymark never infers the rule.
- The prompt hook reads the transcript for the soft cap at every prompt of a task in progress (it already read it for the session state).
- A "sí" meant for another question is not taken for the confirmation while the last reply ended with that question.
