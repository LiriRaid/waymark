# 0050 · No task closes parcial, and the hooks do not repeat work

**Status:** accepted (2.0.20, level 2: points 2, 3, 4, 9, 10, 11, 15, 16, 17, 18 and 23). Amends ADR 0016 and 0018 (the context brake advises, it no longer stops a prompt by default), ADR 0038 (what `hecho` and `parcial` mean), ADR 0047 (the eyes count after the gate) and ADR 0030 (the record gains `prompts`, `pending`, `spaces` and `returns`).

## Context

Real use of 2.0.19 on two projects closed `parcial` in 75 % of the last 26 tasks, spent 92 blocks in 8 days on lists the hook already knew, and measured the Stop hook at a p95 of 10.6 to 12.8 s against a 2.3 s cap. A prompt with screenshots was stopped by the context brake 28 times in two weeks. In OpenCode the hook's own block, sent back as a message, opened a turn whose last reply had no Cierre.

## Decisions

1. **No task closes `parcial` (the user, 2026-10-29).** A gap only the user's manual test can close is `hecho` with a visible "pendiente tuyo" line (`outcome.userOwned: ['manual']`, `outcome.pending`; tasks.md names it). A gap of the work is asked once to be finished now (an L2/L3 task is one task) or written `bloqueado (<why>)`; the record still says what the agent wrote after that block. A cause outside the work (the quota) stays as it was.
2. **A task keeps every ask.** The record keeps all the task's prompts (`prompts`, masked, last 12). The next ask on a task left open (`bloqueado`, `parcial`, a plan step ahead) is its follow-up whatever its words; an ask that says something about the last result (a negation before a verb of the result, "te faltó", "you forgot") is too. A different ask on the same files is still a new task (ADR 0038).
3. **One ask is one task at L2+.** The window finding flags an option that offers only a phase of the ask; `protocol/l3.md` says the steps are done in the same task.
4. **The proofs are handed early.** The first change of a task hands what an L2+ close asks for (gate, spec first, one review, eyes for a UI file, the Pedido item by item). The red-spec proof is not asked when every changed code file is new at HEAD. The block that asks for the Cierre names the task ID and the follow-up the hook accepts.
5. **One ego space per task; the typecheck goes before the eyes.** A look counts only after the project's typecheck or build passed since the last change (a gate the machine cannot run holds nothing back). The record keeps the ego spaces (`spaces`: name, times taken, finished) and the returns to ego after a change (`returns`). A space closed while the task is open, or opened anew inside one task, is a finding, never a block.
6. **The hooks do not repeat work.** The typecheck the Stop hook re-runs is kept by tree (HEAD plus every changed file's mtime and size, before and after the run) for twenty minutes. `latency.log` gets `project:session:transcript KB`. Reading the transcript and the records cost 40 to 60 ms on a 22 MB session, so an incremental read was not built.
7. **The context brake advises (decision 5, choice A).** Past its size or after an idle stretch it saves tasks.md and says once per step that a new session is cheaper; it never stops a prompt. `WAYMARK_BRAKE_MODE=block` keeps the old stop.
8. **Deferred turns are listed.** A turn deferred or unjudged (`kind: unevaluated`) that no later close of its session covers is listed in tasks.md under *Started, not closed*, the newest four.
9. **OpenCode.** `toLines` leaves the block message out, so a turn keeps the Cierre written before the block and the reply after it.
10. **The project learns.** A correction that says the same in two tasks is proposed for the project's Conventions (or preferences.md when it holds everywhere); the instructions block says the user restarts a local API unless the project's Conventions say the agent does; the bootstrap fills Stack, Source root, Path aliases, Related projects and where each kind of piece lives, each marked to confirm.

## Not built (listed so none is lost)

The dev server's compile output as a second signal for point 18; the card line that sets the returns to ego against the steps done; whether the Cierre names a doubt that was not taken back to ego; the eyes testigo reading the `ego-browser skill` first and handing the path only while the PATH lacks ego (point 1); the confirmed Placement row, the design link kept per project and a term with two meanings (point 23); an incremental transcript read (measured as not the cause); the wording of "hecho shown with its open testigos" (point 10d).

## Consequences

The instructions block is at its cap (6,500 characters), so the next line needs room first. A project with a `parcial` habit sees `Resultado: parcial leaves work undone` once per task; the way out is named in the message.
