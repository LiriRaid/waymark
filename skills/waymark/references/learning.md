# Learning loop

Part of the `waymark` core skill. Paths are relative to the core skill folder (`<skills-dir>/waymark/`). Read only when the instructions file or a department points here.

Run at the end of every L1+ task (Exit → Learn). **Work in progress** is written by the end-of-turn hook, never by hand: one line per task, `- ✔|▶ [<task ID>] <Aprendido>` (≤200 characters; ✔ when Resultado is hecho, the newest 5 kept), taken from the Cierre's Aprendido. A follow-up replaces its task's line; longer or older lines move whole to `history.md`. `tasks.md` is generated from those lines and the records (git notes + `provenance.jsonl`); a line without an ID at its head is a note.

After each L1+ task, collect what was **non-obvious and new**: something you had to discover, a correction from the user, a command or flag that was needed, a library quirk, a mistake you made. Discard anything already stated anywhere in Waymark.

**1. Novelty check (mandatory before writing anything).** Grep the candidate concept in: the department `SKILL.md`, the stack profile, the tool skill, the project memory and the learnings file. Already covered → write nothing. Covered but wrong or outdated → fix it in place and say so.

**2. Place it where it belongs** (exactly one destination):

| The lesson is about… | Write it to |
|---|---|
| this machine or environment (OS, shell, missing tools, how to edit files) | `~/.waymark/profile.md` → *Environment* |
| a problem that took more than one attempt | `<project>/.waymark/memory.md` → *Solved problems* (symptom, cause, fix, dead ends) + `mem_save` |
| this project only (paths, conventions, gotchas, commands) | `<project>/.waymark/memory.md` |
| a project rule that must apply to **every** task there and the team should share | `<project>/<project-instructions-file>` — ask first (see `project-detection.md`) |
| a stack/framework, valid in any project of that stack | `stacks/<stack>.md` → matching *Conventions* section |
| an architecture, valid in any project that uses it | `architectures/<arch>.md` → *Placement rules* or *Conformance checklist* |
| a library fact verified in official docs | `library-docs/facts/<library>.md` (per version) |
| how to use a tool skill (ui-build, ui-refine, …) | that skill's `## Learned notes` |
| a general rule of the department, valid in any stack | the department's `## Learned rules` |
| how the user wants answers or code delivered (a correction) | `~/.waymark/preferences.md` → *Learned preferences* |
| searching or delegating to subagents | `~/.waymark/subagents.md` → *Learned rules* |
| not sure yet / seen once | `~/.waymark/learnings/dept-<dept>.md` (staging) |

Format: `- [YYYY-MM-DD] <lesson> — <why> (source: <project>)`.

**3. Promotion.** A staged learning seen a second time (any project) is promoted to its final destination from the table and removed from staging. A user correction is promoted immediately.

**4. Consolidation (the skills evolve).** When a `## Learned notes` / `## Learned rules` list passes ~10 items, fold them into the body of the skill (the Procedure, Rules or Anti-patterns they refine), keep the meaning, and clear the list. Report it in the closing report.

**5. Project skills.** When the same project-specific procedure has been done twice (project memory → *Repeated procedures*), or the user asks, generate a skill **inside the project**: `<project>/<project-skills-dir>/<slug>-<topic>/SKILL.md` from `templates/project-skill.template.md`, with the trigger phrases the user actually used. Register it in project memory and run `node scripts/sync.mjs`. Ask before writing into the repository; offer `.gitignore` if it should not be committed.

**6.** If an `engram` (or other memory) MCP is available, also `mem_save` architecture decisions and bug root causes.

**7. Memory hygiene (memory points, the code decides).** Persistent memory makes an agent hallucinate when it is stale, retrieved for the wrong project, too large, or holds guesses written as facts. So:
- Write only what was verified, with its evidence (`decision ← evidence`, `file:line`, the command that proved it) and the date; a hypothesis is written as one (`hipótesis: …`) or not at all.
- When a memory entry and the code disagree, the code wins: fix or delete the entry in the same task and say so.
- A *Solved problems* entry whose file, component or dependency no longer exists, or whose fix was reverted, is deleted. *Work in progress* entries the session hook flags as old are confirmed with the user or closed (`Status: idle`).
- The project file `<project>/.waymark/memory.md` is the source of truth; engram holds the history and search. If they disagree, update the project file and `mem_update` the observation.
- Keep each list short: past ~10 *Solved problems*, merge entries with the same root cause and drop the ones that cannot recur.

Mention in the closing report every file written by this loop.
