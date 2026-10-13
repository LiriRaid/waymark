# 0023 · The project learns from its records: the hook writes what it observed, the rest is proposed

**Status:** accepted (2026-10-12). Every pick below is the user's (2026-10-12 · T13, point 5 of the 2.0.3 plan). It builds on `0012` (testigos and git as the source) and `0015` (three layers of memory).

## Context
- **Promised but never filled.** The project memory has *Quality gates (verified commands)*, a *Project map* and *Repeated procedures*. Only the agent filled them, so in practice they stayed empty or out of date. In this repo every gate row said `not verified` although the full suite ran green in every task.
- **The data is already there.** Each closed task's record holds:
  - its commands, and which part of each was a gate, a test or a build (`shellRuns`);
  - the files it changed and its Aprendido;
  - the evaluation of each testigo;
  - the user's prompt, and the user's reply to a rejected choice window.

  Incidents (`incidents.mjs`) already find a testigo that failed 3 times in 10 tasks.
- **The user's rule** (plan 2.0.3, point 5): the hook writes what it observes, and everything else is proposed and approved by the user in the choice window.

## Decision
- **Quality gates.** When the Verificar testigo passed (a gate after the last change), the end-of-turn hook does two things for each part of a passing command that was a gate, test or build:
  - It dates the row whose command matches. A `<placeholder>` in the row matches any word: `node --check <file>`.
  - If no row matches, it fills an empty row of that kind with the part. The part must name no single file (a glob is fine) and carry no variables or loops.

  It never replaces a command already written, and never touches `none (…)` rows.
- **Project map → Areas.** The hook keeps one line per folder the task touched, two levels deep, `(root)` for files at the root. Each line holds the task ID and its Aprendido clipped to 100 characters. The newest comes first, there are no duplicates and there are at most 12 lines. The user's own lines in the section stay.
- **Repeated procedures.** A procedure is a run of 3 to 5 action steps (`<program> <subcommand>`) that repeats in 2 or more of the newest 40 tasks. These are not steps:
  - reads;
  - heredoc bodies and inline code;
  - loop fragments.

  A run counts only if at least one of its steps is outside the routine. The routine is gates, tests, file operations, and git add, commit and push. The hook writes the count into the table and keeps the user's *Project skill* cell.
- **Proposals, never writes.**
  - A procedure with no project skill → a project skill (`dept-devex` → *Generate a project skill*).
  - An incident rule → a Learned rule of the owner department, which is the department most of its failed tasks were routed to.
  - A correction the user repeated in 2 tasks, and not already in `preferences.md` → a preference. A correction is the clause after a trigger word ("nunca", "siempre", "no hagas", "te dije", "never", "always", "don't"…). Clauses are compared by their words, so two different corrections in long prompts that share other words do not group.
- **Where proposals appear.** The session card says each new proposal once (`.waymark/proposals-seen.json`). `waymark.mjs check` lists them every time, in its `procedure:`, `rule:` and `preference:` lines. The agent offers each one in the choice window and writes it only after the user's yes.

## Consequences
- The gate rows of a project fill and stay dated by themselves, so the session card's *Gates* line shows verified commands.
- In this repo's 52 records the detector proposes nothing. The only repeated runs are the commit routine. Before the filters were added, shell loops, inline JavaScript and heredocs showed up as procedures, and long prompts showed up as corrections. Each of those cases is now a test in the spec.
- `shellRuns` splits at newlines inside quotes, on purpose, to keep line positions. `learn.mjs` flattens quoted newlines and drops heredoc bodies before it counts steps. Records clip long commands, so a quote may never close; that is handled too.
- A correction made mid-task, not in the task's first prompt or in a reply to the choice window, is not in the record, so it is not counted.
