# 0015 · Three layers of memory, written by the hooks; fewer responses per task

**Status:** accepted (2026-10-06, Waymark 2.0.0-dev). Every pick below is the user's (2026-10-06 · T3). It replaces 0013's "engram optional" and the memory rows of 0012. The numbers are in `docs/audit-context.md`.

## Context
The final test (0014) and the audit showed two problems.

**Memory was split across seven places.** Three of them got the same knowledge only if the agent remembered:
- memory.md (*Solved problems*, *Gotchas*, *Decisions*);
- engram, which only agents with its MCP server reach;
- the ADRs.

OpenCode had no engram, so it could not see what Claude or Codex had saved there.

**Most tokens go to extra responses, not to the rules.** Each response re-reads the whole context, about 58k tokens in Claude Code. Six of the 13 responses of a small L1 task were the routine itself:
- the department skill;
- two reads of the procedure;
- `pack`;
- `git status`;
- one end-of-turn block.

A routine that depends on the agent remembering a step fails, and every failure costs one more cycle.

## Decision
**Three layers of memory, each with one job:**

| Layer | Holds | Written by | Travels |
|---|---|---|---|
| git: commits, trailer, notes | what was done, when, how, in which code (the truth of the work) | the end-of-turn hook (notes) | with the repo |
| engram | what was learned: the Aprendido, the decisions, solved problems and gotchas | the end-of-turn hook, with the `engram` CLI | `engram sync` → `.engram/chunks/` committed in the repo |
| `.waymark/memory.md` | the project manual: Identity, map, gates, conventions, Work in progress | bootstrap + the hooks | local |

The engram layer works like this:
- **Save.** At each close the hook runs `engram save`. It uses the task's ID as `--topic`, so closing the same task again updates its memory instead of adding one, and Waymark's project slug as `--project`. Every agent then writes to one project name; the split seen before, one project under two capitalizations, ends.
- **One project name for everyone.** `.engram/config.json` (`project_name`) pins that name for engram's own MCP server too.
- **Commit.** Before a `git commit`, the pre-tool hook runs `engram sync` and stages `.engram/`, so the learned memory rides in the same commit with no step for the agent.
- **Read.** At session start, the session hook imports new chunks (`engram sync --import`), and the card shows the project's latest learned lines.
- **No engram installed.** Waymark keeps working on the other two layers, and `waymark.mjs check` offers to install engram.

Departments stop asking for `mem_save`. `mem_search` stays as a read that counts for Recordar.

**Recordar by the hook.** The project-memory step no longer depends on the agent:
- **Claude Code and Codex:** the pre-tool hook adds the file's `pack` as context before the first edit of each file in the task. Claude Code uses `permissionDecision: "allow"` + `additionalContext`. Codex uses `additionalContext` alone, because 0.160 rejects `allow` without `updatedInput`.
- **OpenCode and Gemini CLI:** their pre-tool hooks cannot add context, so the pack is appended to the result of that first edit (`tool.execute.after`, `AfterTool`).
- **The record:** the hook keeps what it handed over, so the testigo passes by construction.

**Pending tasks close themselves:**
- **By record.** A follow-up that ends `hecho` closes its task's ▶, whichever agent ran it. A "sin resolver" leaves tasks.md once a later task passes that testigo.
- **By time.** At session start, a turn left open by another session for over two hours becomes a chained `{kind: "interrupted"}` record. It shows once on the card and leaves tasks.md.

**Fewer responses** (cuts C1–C4 of the audit):
- **C1:** a department is invoked once per session; later tasks route with the line.
- **C2:** the per-prompt hook adds a one-line `git status`, which it already computes for its snapshot.
- **C3:** the full reminder no longer repeats the block's rules.
- **C4:** the departments' shared Entry, Procedures and Learned rules text lives once, in the block.

## Plan (checkpoints)
1. engram layer: `scripts/engram.mjs`, the end-of-turn save and sync, the commit staging, the session import and the card.
2. Recordar by the hook in Claude Code, Codex, OpenCode and Gemini CLI.
3. Pending tasks close by record and by time.
4. Cuts C1–C4. Departments and memory.md without `mem_save` or the learned sections. Their entries move to engram once, with a backup.
5. `check` and INSTALL: engram install and setup per agent. Tests, install, commit. Then the three-agent test (Claude Code, Codex, OpenCode), then a clean machine.

## Consequences
- engram 3.1.0 is the expected version, with `ENGRAM_NO_UPDATE_CHECK=1` in the hooks to skip its 2-second update check.
- `.engram/chunks/` is committed in each project. Teammates with access to the repo see the project's learned memory, never the personal scope.
- Each close costs one `engram save` and one `engram sync` (local SQLite, under a second each).
