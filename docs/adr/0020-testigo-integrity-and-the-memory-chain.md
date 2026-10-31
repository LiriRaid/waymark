# 0020 · Testigos without false ✔ or false ✘, and a memory chain that travels

**Status:** accepted (2026-10-12). Every pick below is the user's (2026-10-12 · T8, T9 and T10, points 1–3 of the 2.0.3 plan). It amends `0012` (testigos and git as the source), `0013` (portable notes) and `0015` (three layers of memory).

## Context
Three reviews of `main` (2.0.2, 172/172 tests green) found that the routine's evidence could be wrong in both directions.
- **False ✔.**
  - A gate was a word anywhere in the command, quotes included, so `git commit -m "fix build"` and `ls build` counted as a build. Its exit code was not read.
  - A later `node --check` that passed hid a red test.
  - Exception lines (`no comprobado (…)`, `Tests: no (…)`) passed as ✔ with nothing run. A 3-character quote was enough to skip a check.
  - Secrets were read only in `git diff HEAD` and the commits carrying the trailer.
  - In Codex, reading `code-review/SKILL.md` counted as a review.
- **False ✘ on real work.**
  - A file changed through the shell never got its memory pack, and running the pack after the block did not count.
  - A session's first task saw only its last 3 prompts, so its decision was lost.
  - A shell change in another repo was outside the snapshot.
  - A repo with no typecheck (Rails, plain JavaScript) had no gate a test could fill.
  - A Codex task that stopped to ask in the chat was judged as a finished turn.
- **A chain that did not travel.** A clone fetches `refs/heads/*` only, so the task records (git notes) stayed on the machine that wrote them. tasks.md, the card and the task IDs read only the local log stubs: this repo had 31 notes against 13 log lines. Notes were pushed only when the agent pushed in that turn. A lesson could not be corrected, because every task had its own engram topic. A Q's lesson was never saved.

## Decision
- **Each command judged by its executable** (`shellRuns`): gate, test and build come from each part's executable, never from a word in an argument or a commit message. An exit hidden by a pipe or `;` is decided by the output's failure summary, then by the typecheck the hook re-runs. A test that failed after the last code change keeps the gate ✘ (a clean-copy run excepted).
- **Exceptions are ⚠, never ✔.** They count as exceptions in the evaluation (`0012` still holds: the hook never reads prose to grant a step). A skip quote needs at least 3 words (or 12 characters) found in the user's messages, or a whole option they picked; a fragment of the option that accepted the check does not count.
- **Build and review must be real:** exit 0, after the last change, in the code's repo, covering the changed files.
  - *Amended in 2.0.13 (2026-10-15).* The build is judged per repo: each repo needs a build that passed after the last code change in that repo, not after the turn's last one. the real-use project 2026-10-15 · T3 built the API and the front, then wrote only the front's `main.spec.ts` and rebuilt the front, and scored Build ✘. A code change made from the shell names no repo, so it still counts for every repo.
- **Secrets** read every commit of the turn, in any repo, by this git user.
- **An unverified lesson** goes to engram marked `sin verificar`, and its Work in progress line stays.
- **Quota start** is cleared when a turn ends with no task. **Hook errors** go to `~/.waymark/hook-errors.log`, and `check` reports them.
- **The trailer gate** reads the command's skeleton, so a heredoc that mentions `git commit` is not a commit. The docs say it stops a commit once.
- **Recordar through the shell.** The pre-tool hook hands over the pack of the files a shell change names. A pack run after the first change no longer blocks; it is recorded as late.
- **The task's own start.** The per-prompt hook marks it (every agent), and the hooks read the transcript back to it. The `/compact` summary is not a prompt (`isCompactSummary`, plus its opening sentence, which is not documented).
- **Pauses.** A reply with no Cierre that ends asking, with at least 2 options, is a pause: no block, no record, and the snapshot is kept. In Codex, only the questions a message ends with, with options, are decisions asked in chat.
- **Other repos** named by `cd X &&` or `git -C X` are snapshotted before a shell change.
- **No typecheck** → a green test after the last change is the gate.
- **Notes that travel.** `waymark.mjs notes setup` adds, on the user's yes, a fetch refspec into `refs/notes/remotes/origin/waymark`. The session hook merges it with `-s ours`, so a fetch never overwrites a local note. `check` offers the setup and reports notes not pushed; the end-of-turn hook pushes them after any push it sees while origin lacks some.
  - *Amended in 2.0.4 (2026-10-13, the user's pick).* The session hook adds the refspec on its own, once, in a repo with `.waymark/` and an `origin`. It needs no network and says so in the card; the next fetch brings the records. The refspec is a glob, `+refs/notes/waymark*:refs/notes/remotes/origin/waymark*`. The exact refspec of 2.0.3 made every `git fetch` fail ("couldn't find remote ref") while the remote had no notes yet. A glob matches nothing there. `ensureFetchSpec` replaces the exact refspec where it finds it.
- **Records that are only notes.** `readTaskRecords` and `taskIds` join the log and the notes by close (ID + session), in date order. A clone reads its records and never reuses an ID, and two machines' same-day IDs stay two tasks. `verifyChain` still checks only the log.
- **Lessons.** Engram titles each memory with the Aprendido; the request goes in the body. A follow-up writes its task's topic, so it corrects the lesson. A Q that ends with an `Aprendido:` line is saved marked Q. `importChunks` is removed (`0017` replaced `0015`'s export).

## Consequences
- Some turns that passed before now show ⚠ or ✘. That is the point: a ✔ means something ran.
- The pause rule depends on the reply ending with a question and options. A question asked mid-reply still closes the turn.
- Gemini CLI's hook timeout (60 s) is close to the gate re-run plus git. It is left until Gemini is tested live (T10).
- Note merges need the refspec. A clone without it still sees only its own records; `check` says so.
