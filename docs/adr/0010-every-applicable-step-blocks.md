# 0010 · Every applicable step blocks once; the branch and the browser are the user's

**Status:** accepted (2026-10-03, Waymark 2.0.0-dev, step 3c). Amends 0005 and 0006 (what blocks) and 0009 (decisions asked in chat).

## Context
In the real 3c test (a real project, 2026-10-03), Codex trusted the four hooks and resumed the work from `tasks.md`. Codex ran out of quota mid-turn, and Claude picked up the cut step. The Claude task still scored 9/12:
- **Decision ✘:** the agent listed the branch as one of its own sub-decisions, and asked three questions after the code.
- **Navegador ✘:** the browser check was never put to the user.
- **Previos ✘:** "warnings that already existed" was never checked.

Earlier, T2c scored 9/10 with Índice ✘: no `mem_save` of the task line. The user's rule: "every applicable routine must always pass".

The same test showed six gaps in the chain:
- `tasks.md` lost "paso 2", because the last `Pendiente:` won.
- `Waymark → L0|Q` read as L0.
- Codex counted only the last question of a message.
- A Codex reply in the chat opened an unrouted turn, read as L0, which skipped the gate.
- `open.json` did not say which agent started the turn.
- The quota estimate had no pairs to calibrate it.

## Decision
- **Every step that applies blocks once** (`routine.json`): procedure, engram index, browser, spec next to the code, red claims and pre-existing claims join decision, gate, Cierre, Aprendido, `mem_search`, review, build and docs. The commit trailer stays `record`: fixing it means rewriting a commit, which is destructive once pushed (the user's pick). Each block message says how to fix it now. The reminder asks for each step at its moment: the index with the Aprendido, the clean-copy check when a failure is called pre-existing.
- **Steps the user owns pass on the user's answer.** The browser check is offered in the first choice window, with a test user + Playwright when there is a login or OTP. Navegador fails only when it was never offered, or when it was accepted and not done. `Navegador: omitido (usuario: "<words>")` accepts the user's words or the option they picked.
- **The branch is the user's.** The gate no longer offers it as a sub-decision. A `Sub-decisiones` item about the branch is ignored: never `no preguntada`, never counted.
- **Decisions come first.** Every decision that shapes the work goes in the first choice-window call:
  - a later question that only confirms is `→ confirmada` and passes;
  - `→ preguntada tarde` (passes the block, Decision ✘) is kept for a work decision asked after applying it.
- **Routing is inherited inside an open task.** A turn with no routing line takes the routing of the task's last routed turn (L1–L3) while that turn has not written its Cierre (the user's pick, over "any turn of the task" and "only Codex chat replies"). An explicit `Waymark → L0` and a Q turn never pass their routing on. `L0|Q` is Q.
- **Codex:** every question line written after the turn's last action counts as a decision asked in chat. Each line gets the user's reply as its answer.
  - `request_user_input_async`, the choice window of Codex's default mode, returns `{"accepted":true}`. It counts as asked only once the user's next message answers it; the options that message names are taken as picked.
  - A call rejected for bad arguments never counts. A replay of the real 3c rollouts found both gaps (2026-10-03 · T2k).
- **Shell redirects:** a `>` inside quotes, a heredoc body or a PowerShell here-string is not a redirect. Before, `node -e "…x=>{…}"` was gated as a file change.
- **Quota:** while the model has fewer than 3 pairs (no fit yet), the end-of-turn line asks for the real % with the exact `calibrate.mjs` command (the user's pick).
- **tasks.md:** `próximo` joins every pending part in order. A marker inside quotes is text, and `NEXT` counts only when followed by a space or a colon. `open.json` keeps the agent ("started in codex").

## Consequences
- More turns are blocked once, on the steps that used to only score ✘. Each block names the fix, and none of them blocks twice (`stop_hook_active`).
- The instructions block grows by about 800 characters, because it quotes every block step (tests check it). The installed `CLAUDE.md` block must be refreshed when this version is installed.
- The branch still appears in each record (`observed.branches`), but it is never scored.
- Tests: 77 (`tests/hooks.test.mjs`, the seven `3c` tests and the updated block expectations).
