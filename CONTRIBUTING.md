# Contributing to Waymark

Waymark is the supply chain of AI-agent work. It learns on the machine where it is installed: every task you close teaches your own install (your departments' learned rules, your memory, the precedent of earlier tasks). Nothing leaves your machine unless you send it (`docs/adr/0042`).

That is also why the author cannot see, alone, whether Waymark works for other people, other stacks and other agents. You can help in two ways: share a **pattern** you found, or send a **change** for review.

## The pattern, not the case

A **case** is your work: your code, your prompts, your file paths, your client's names, the bug in your repository. It stays with you. Never paste it in an issue or a pull request.

A **pattern** is what your work taught about Waymark, said so that anyone could reuse it without knowing your project:

| Case (keep it) | Pattern (share it) |
|---|---|
| "In `C:\Users\ana\shop-api\src\auth.ts` the agent edited the wrong guard." | "In a NestJS API with two guards on one route, the agent edited the first one it found; the brief did not ask which guard owns the route." |
| "My prompt was: *arregla el login de la tienda*." | "A one-line Spanish ask at L1 skipped the choice window, although the fix touched auth." |
| "Task 2026-10-12 · T4 cost 4.2M tokens." | "L2 tasks with three or more hook returns spent about 20 % of their cost on routine (Claude Code, Waymark 2.0.18)." |
| A log or transcript of your session. | The testigo that blocked, how often, and whether the block was right. |

A useful pattern names: the Waymark version (`<skills-dir>/waymark/VERSION`), the agent and model, the level of the task (L1, L2, L3), the stack in general terms (Angular, Rails, Go…), what happened, how often, and what you would expect instead. Numbers help most: `node "<skills-dir>/waymark/scripts/waymark.mjs" cost` and `node "<skills-dir>/waymark/scripts/waymark.mjs" scorecard` print figures that hold no project content; check them before you paste.

## Share a pattern

Open an issue with the **Pattern report** form (Issues → New issue → Pattern report). It asks for the fields above and reminds you what not to include. Reports are read for each release and grouped by version, so the next one fixes what was reported most.

Reports from agents other than Claude Code are especially valuable: every task the author has recorded ran on Claude Code, and the other adapters (Codex, Cursor, Gemini CLI, OpenCode, Copilot CLI, Kiro, Antigravity, Qwen Code, Droid, Amp) are judged by the conformance list in `tests/conformance/`, not yet by live use.

## Send a change

1. Fork the repository and branch from `develop`.
2. Keep the change small and say why in the commit message.
3. Run the suite the way CI does: `node scripts/gate-tests.mjs` must print `clean (skipped 0, todo 0, fail 0 in 3 runs)`.
4. No data of another project in any file: `tests/privacy.test.mjs` fails on a real user's home folder or address in a fixture, and a fixture from a real session must be redacted first.
5. A change to what Waymark decides or enforces comes with a decision record in `docs/adr/` (start from the latest one).
6. Open the pull request against `develop`. The author reviews every pull request and decides what is merged; releases are signed by the author's key (`skills/waymark/ALLOWED_SIGNERS`).

## Where measuring starts

Waymark 2.0.19 is the baseline: the first release whose numbers come from tasks run on 2.0.18 and later, by the author and by whoever shares a report. From there each release says, with the scorecard (`docs/adr/0028`) and the cost report, how much it improved and where it did not.
