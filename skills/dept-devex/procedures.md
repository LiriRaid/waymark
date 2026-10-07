# dept-devex · Procedures

Loaded on demand from `SKILL.md` → *Procedures*. Read only the section the task needs.

### Layout of Waymark
- `<skills-dir>/waymark/` — core (live copy, real folders, portable): `SKILL.md` (protocol), `skill-map.json`, generated `skill-registry.md`, `scripts/sync.mjs`, `stacks/`, `architectures/`, `templates/`.
- `<skills-dir>/dept-<dept>/SKILL.md` — one skill per department (`templates/department.template.md`).
- `<skills-dir>/<tool>/` — owned tool skills (`"owned": true` in skill-map, provenance in `NOTICE.md`, evolve via `## Learned notes`).
- Source repository (clone of the published repo): `skills/`, `adapters/`, `INSTALL.md`, `scripts/export.mjs` (copies the live skills back into the repo to publish improvements).
- `~/.waymark/` — private layer, self-filling (templates in `../waymark/templates/private-layer/`): `agent.md`, `profile.md`, `preferences.md`, `subagents.md`, `projects.md`, `learnings/`, `projects/`, and `coexistence.md` only when another agent framework is installed (`../waymark/references/coexistence.md`). Never shared or published.
- `<project>/<project-skills-dir>/<slug>-<topic>/` — project skills. `<skills-dir>` / `<project-skills-dir>` per agent: `~/.waymark/agent.md`.
- As a plugin, names are prefixed (`waymark:dept-qa`); use the form the session lists.
- Enforcement: description triggers + the instructions block (Rule 0) + the per-prompt Rule 0 reminder hook (`scripts/rule0-hook.mjs`) where the agent supports hooks. The hook reminds (one line once the last reply followed the routine) and, once, stops a costly resume of a large idle session; it never orchestrates.

### Write a trigger description (any skill)
1. Single line, double-quoted, inner quotes escaped as `\"`.
2. Start with what it is (`Waymark · <Dept> department.`), then `Use FIRST` + what it precedes when it must run before tool skills.
3. List concrete phrases the user actually types, in the user's language (Spanish here) plus key English terms.
4. Say what it is not for when confusion is likely (e.g. L0 edits).
5. Avoid generic words ("code", "help"): they cause false triggers or misses.
6. **≤ ~300 characters.** Every description is listed in every session; procedural notes ("load X first", "decides which skills to use") belong in the body. The 17 Waymark descriptions went from 8,558 to 4,407 characters in 1.7.0 (~1,000 tokens per session).
7. Test: a fresh prompt with one listed phrase must load the skill; an unrelated prompt must not.

### Registry: skill-map.json + sync
1. Edit only `../waymark/skill-map.json` (`skills` or `mcp`): `type`, `departments`, `capability`, `when`, `level`, `source`, optional `patch` (department whose precondition is injected), optional `stack`.
2. Run `node ../waymark/scripts/sync.mjs` (`--dry-run` preview, `--unpatch` remove patches). It re-indexes user, plugin and project skills plus MCP servers, auto-assigns new skills (`auto: true`), re-applies the precondition block to tool skills and regenerates `skill-registry.md`.
3. Review every `auto: true` entry and `Unassigned` row; fix department, capability and level, rerun sync.
4. After every `npx skills add`, run `sync.mjs --vendor <name>` so the new skill becomes an owned real copy in `<skills-dir>` (no links, portable).
5. Never edit `skill-registry.md` by hand; never reference a name absent from the registry or the session listing.

### Install a missing skill or MCP
1. Follow `waymark` `references/skills.md`: propose in one line with name and source; wait for an explicit yes.
2. Skill: `npx skills add <source>` (check `npx skills --help` if syntax differs). MCP: configure via `update-config` or `claude mcp add`, verifying with `claude-code-guide`.
3. Add or fix its entry in `skill-map.json`, run sync, confirm the status reads `installed` / `configured`.

### Generate a project skill
1. Trigger: a procedure counted twice in project memory (*Repeated procedures*), or the user asks.
2. Copy `../waymark/templates/project-skill.template.md` (`skill-creator` for wording): description = the user's real phrases; procedure = real paths and verified gates.
3. Ask before writing `<project>/.agents/skills/<slug>-<topic>/SKILL.md`, its `name` equal to the folder. That is the only real copy, in every agent's folder: Codex, OpenCode and Gemini CLI read it, and the session hook links it into `.claude/skills` for Claude Code. Never write a project skill into an agent's own folder (`.claude/skills`, `.opencode/skills`, `.gemini/skills`). Both folders stay out of git (docs/adr/0017).
4. Register it in project memory → *Project skills*, run sync (it appears under `## Project skills`).

### Private layer maintenance
1. Learnings: one line each, `- [YYYY-MM-DD] [project] <lesson> — <why>`; only non-obvious, reusable facts.
2. Past ~150 lines: merge duplicates, drop lessons already in department rules, promote stable ones into the department skill or stack profile.
3. Project memory: keep `templates/project-memory.template.md` sections; update gates, gotchas, decisions as learned.

### Add a stack, architecture or department
1. Copy the matching file in `../waymark/templates/`; keep the exact section order.
2. Stack: concrete *Detect* signals; *Commands* for every gate, run once for real; add the signal to `waymark/references/project-detection.md`.
3. Architecture: From / May import / Must not import table; conformance items verifiable by Grep.
4. Department: Quick ref ≤ 6 lines, Brief questions, stack-agnostic rules, DoD starting with the Exit protocol, `SKILL.md` ≤ ~8,000 characters with the Procedures index, steps in `procedures.md` (`templates/procedures.template.md`); add it to `waymark` SKILL.md §2 and the `depts` list and keywords in `sync.mjs`.

### CLAUDE.md hygiene
1. Short (target < 3,000 chars): stack summary, package manager, project-specific rules, and one line pointing to the `waymark` skill.
2. No "skip", "ignore", "optional for small tasks" wording that contradicts the levels; levels decide what is mandatory.
3. Do not duplicate department, stack or registry content; no tool names absent from the registry.
4. One configuration root per workspace; no nested agent config folders in subdirectories. Use `init` for a new project CLAUDE.md.

### Settings, MCP and memory
1. Settings, permissions, env vars: `update-config`; behavior questions: `claude-code-guide`.
2. Load deferred tools via tool search first. Never move or remove the user's MCP servers. Generic servers (docs, memory) are available everywhere; a framework's server is blocked per project where that framework is not used (deny rule in the project's `.claude/settings.local.json`; `../waymark/scripts/mcp-fit.mjs` plans it and applies it after a yes).
3. `engram`: the end-of-turn hook saves each task's Aprendido (docs/adr/0015); search it (`engram search`, mem_search) before re-reading context. Never `mem_save` by hand what the Cierre already holds.

### Documentation (Diátaxis)
1. One type per page (tutorial, how-to, reference, explanation); link between them.
2. Document intent and decisions, not drifting code; match the project's doc language; keep README current.

## Anti-patterns
- Editing `skill-registry.md` by hand, or leaving a newly installed skill as a link instead of vendoring it.
- Vague descriptions that never or always trigger.
- CLAUDE.md growing into a second protocol or a copy of departments.
- Installing skills or writing project skills into a repo without asking.
- Learnings that duplicate department rules or grow unconsolidated.

## References
- Claude Code docs: https://docs.claude.com/en/docs/claude-code
- Diátaxis: https://diataxis.fr
