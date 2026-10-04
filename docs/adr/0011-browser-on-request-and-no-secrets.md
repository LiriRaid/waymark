# 0011 · The browser only on request, no secrets in the chain, and turns counted from the last close

**Status:** accepted (2026-10-03, Waymark 2.0.0-dev, step 3c). Amends 0010 (browser step, decisions, memory) and 0004 (what a record keeps).

## Context
Test A of the 3c fixes ran in a real project with Claude (Opus 5.5 medium). T2d was an L2 feature: an upload indicator inside the editor and image resize handles. It took ~17% of the 5-hour quota (2% + 15% across a quota reset) and scored 10/12. T2e applied the code-review findings; it took ~2% and scored 9/11. The review of both records and the session transcript found:
- **The browser check cost a lot and decided nothing.** Following 0010, the agent offered it, the user picked Playwright and gave a test account, and the agent drove the app and read screenshots. The user's verdict: it spends tokens and misreads screens, so the person decides; Waymark never offers or recommends it.
- **The test account's password reached the chained log.** The user typed it as a free-text answer, and the record kept every decision verbatim. A chained record cannot be edited without recomputing the chain.
- **Decision ✘ and Aprender ✘ were false:**
  - The agent wrote `Decisión: del usuario, elegida en el choice window:` with the picks on the next lines. In T2e it quoted a whole multi-select answer.
  - It separated sub-decisions with ` · `.
  - It updated `memory.md` with a node script through the shell, which is not Edit or Write.
  - Two technical steps that fixed bugs (one real way each) could only be written as "no preguntada".
- **T2e was recorded as 17.4M tokens ≈ 22% instead of ~2%.** The turn was resumed by the background code-review's notification after T2d's close, so it had no prompt of its own. T2d's prompt (a pasted image of 1.45 MB) had fallen out of the hook's 4 MB tail, so the hook found no turn and summed the whole tail. The same read made the gate skip a turn whose prompt was out of its 2 MB tail.

## Decision
All of these are the user's picks (2026-10-03 · T2l).
- **Browser verification only when the user asks for it.**
  - No browser step in `routine.json`, no offer in the gate, the reminder or the instructions block.
  - The departments (QA, frontend, UX/UI, DevOps), the stacks and the UI skills say "only when the user asks; never offered or recommended". UI work is proven with specs and the build, plus a one-line check for the user.
  - The `browser-verify` skill stays installed for when the user asks.
- **No secrets in the chained log.**
  - A record keeps only the picked option labels; a free-text answer is stored as `(respuesta escrita, N caracteres)`.
  - Passwords, tokens, keys and URL or `curl -u` credentials are masked in the prompt, the commands, the Cierre, `open.json` and the findings.
  - The hook still reads the live answer to check "del usuario".
  - The test project's records were redacted and their chain recomputed. The two transcripts and the temp Playwright script were masked in place, with the same length.
- **Routine checks that read what the agent really did:**
  - `Decisión` continues on the next lines when its line ends with ":". A quoted multi-select answer counts as the user's.
  - `Sub-decisiones` split on ` · ` when one part holds several "→".
  - `→ única (<why>)` marks a technical step with one real way; it passes and is not counted as asked.
  - `memory.md` counts as written when it changed during the turn and holds the task ID, whatever tool wrote it.
- **Turns counted right.**
  - The hooks read further back (doubling, up to 64 MB) until the task's prompts are in view.
  - A turn counts from its prompt, or from this session's last close when that is later.
  - The end-of-turn hook takes a new git snapshot at each close, so a resumed turn diffs from there.
- **Review once per task:** a follow-up that applies the review's findings passes with the code-review run earlier in the same task.
- **Tasks outside the project are recorded:** a turn with a Cierre whose changes are all outside the project (install, cleanup) gets its record in the session's project.

## Consequences
- Fewer tokens per UI task: the browser runs only on request. The estimate of a turn resumed by a notification matches the real quota: T2e is now 2.21M ≈ 2.8%, against ~2% observed.
- The log can no longer hold a typed secret, but it also loses the text of free answers. The transcript keeps that text, under the agent's own retention.
- A `Sub-decisiones` item that names a bug fix must now say why it has one real way.
- Tests: 87 (`tests/hooks.test.mjs`).
