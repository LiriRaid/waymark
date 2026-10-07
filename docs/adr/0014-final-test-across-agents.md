# 0014 · The final test across agents: notes that travel alone, one ID per commit, Recordar and review in every agent

**Status:** accepted (2026-10-06, Waymark 2.0.0-dev). Every pick below is the user's (2026-10-06 · T2). It amends 0009 (a step an agent lacks), 0012 (notes) and 0013 (Recordar at L2+).

## Context
The final test ran one task per agent in a landing project, in a row: Claude Code (T1, T2), Codex (T3), Gemini CLI (no task: its API call failed with `fetch failed`, after the hooks had injected the card) and OpenCode (T4). The chain held: four records, each with its agent and commit. Five gaps showed up:
- **Notes did not travel alone.** `pack` read a commit's note only through the stub in the local `provenance.jsonl`, which git does not carry. In a fresh clone, a commit with a note showed as "(no task record)".
- **A task committed later had no note.** T1 was committed during T2 with T1's trailer. Notes were only added to the turn's own task, so T1's record stayed in the local log.
- **The trailer and the record disagreed.** Codex used "T2b" in its trailer and Cierre. The end-of-turn hook recorded the task as T3, because it shared no file with T2.
- **Recordar was ambiguous.** Claude counted two files and routed L1. The spec made three, so the hook judged L2 and blocked for `pack`. The instructions block also said "before your first change: pack" for every level, while the testigo applied only at L2+.
- **Review only existed in Claude Code.** `code-review` ships with Claude Code. Codex, Gemini CLI and OpenCode listed `review` in `lacks`, so the step did not apply. On top of that, Codex's `Test-Path …\code-review\SKILL.md` was read as invoking the skill.

## Decision
- **Notes travel alone.** `pack` reads the note on each commit of `git log -- <file>`, with or without a local stub. A commit with no stub and no note whose trailer names a recorded task shows that task, once.
- **Late commits get their record (`notes.noteLateCommits`).** A task recorded with no commit whose trailer appears on a later commit gets its whole record as that commit's note, with that commit in `commits`. The chained line is not touched. The end-of-turn hook runs it after a turn that committed. The session hook runs it too, for a commit made by hand.
- **One ID per commit (`tool-hook.checkTrailer`).** A `git commit` whose `Waymark-Task` trailer the end-of-turn hook would record under another ID is denied, with the right ID:
  - a follow-up letter whose task shares no staged file;
  - an ID never offered.

  A recorded task's ID passes, because that is its work committed by a later task. With nothing staged there is no evidence, so it passes too.
- **Recordar at every level.** The `memory` step applies at L1–L3. The block and the claim say "the project memory searched (`waymark.mjs pack`) before the first change", with no "L2+".
- **Review in every agent (`waymark.mjs review <files>`).** The command prints the diff of the task's files against HEAD (a new file: its first lines) and a five-point checklist. Running it counts as the Review step, just as `code-review` does. Codex, Gemini CLI and OpenCode no longer lack `review`, and each adapter's `note` names the command. Codex counts a `SKILL.md` as invoked only when the command reads it (`Get-Content`, `cat`, `sed`…).
- **OpenCode measurements.** A tool lasts from `state.time.start` to `state.time.end`. The plugin asks `opencode --version` once per load and passes it as `agent_version`, so the record's `inputs.agent` has it.
- **tasks.md.** The *Started, not closed* heading says that the turn reading the file is listed there too. OpenCode had read its own open turn as a hung one.

## Consequences
- An L1 change now costs one more command (`pack`), and it can block for it.
- Gemini CLI's run is still pending. Its hooks fired, but no model reply arrived, so its testigos are unchecked.
- Not covered yet: an install on a clean machine, the audit of redundancy and context, and one memory instead of three. The user picked these next, in that order after this one.
