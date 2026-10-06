# Skills: find, install or create

Part of the `waymark` core skill. Paths are relative to the core skill folder (`<skills-dir>/waymark/`). Read when a department's **Tools** table has no installed provider for what the task needs, or the user asks for a new skill.

## 1. Find

1. The department's **Tools** table → the session's skill list → `skill-registry.md` (search the capability, not the whole file).
2. Installed under another name or department → use it and fix its row in `skill-map.json` (department, capability), then run sync.

## 1b. MCP servers this user has

Every user connects different MCP servers. Sync indexes all of them; the ones not yet mapped appear in `skill-registry.md` → *Other MCP servers configured*. When a task could use one (or the list is not empty at Entry), identify what it serves from its tool list, add it to `skill-map.json` → `mcp` (`capability` such as `docs.library`, `framework.cli`, `ui.library`, `db`, `browser`; `departments`; `stack` when it only applies to one), run sync and use it. Never call a server that is not connected; never recommend the user's servers as if everyone had them.

## 2. Install a known external skill [ask]

When `skill-registry.md` lists a provider as `missing` with a `source`:

1. One line: *"Para `<capability>` el registro recomienda `<skill>` (`<source>`). ¿La instalo?"* Never install without an explicit yes.
2. `npx skills add <source>` (run `npx skills --help` if the syntax differs), then `node scripts/sync.mjs --vendor <name>` so it becomes an owned real copy, and continue.

## 3. Create the skill (autogeneration)

The skills installed with Waymark are **defaults, not a limit**. Any capability the user's work needs can become a skill: create it freely, in the user's way of working, whenever no installed skill covers it.

No provider exists, and the capability is **reusable** (it will serve future tasks in this or other projects): create it, do not just work around it. One-off needs: do the work directly and note it in the closing report.

**Where it lives — ask the user [ask].** Before writing, ask in one line where they want it, with your recommendation first:

*"No hay skill para `<capability>`. Voy a crear `<name>` (trigger: …). ¿La quieres **global** (todos tus proyectos) o **solo en este proyecto**? Recomiendo <global|proyecto> porque …"*

| Answer | Create it in | Notes |
|---|---|---|
| global | `<skills-dir>/<name>/` — owned tool skill | serves every project; recommend when it is not tied to this project's code |
| this project | `<project>/<project-skills-dir>/<slug>-<topic>/` — project skill | travels with the repository; offer `.gitignore` if it should not be committed |

Skip the question only when the user already said where (in this request, or as a standing rule in `~/.waymark/preferences.md` → *Learned preferences*). If they answer "always global" / "always per project", record it there so it is not asked again.

Steps:
1. **Template.** Copy `templates/tool-skill.template.md` (general) or `templates/project-skill.template.md` (project). Use `skill-creator` if the session has it.
2. **Name.** kebab-case, says what it does (`pdf-invoices`, `rails-service-objects`), no collisions with the registry.
3. **Trigger (`description`).** One line, double-quoted: what it is → `Use when …` → the phrases the user actually typed for this need, in their language plus key English terms → `Not for …`. Concrete words only; generic words cause false triggers.
4. **Precondition.** It belongs to a department: add `patch: "<dept-dept>"` in its `skill-map.json` entry; sync injects the "load the department first" block.
5. **Body — concise and layered, like the default skills.** `SKILL.md` holds only the precondition, approach, inputs, a one-line index of modes and `## Learned notes` (target ≤ ~5,000 characters). Each mode goes to `modes/<mode>.md`, stack-specific notes to `references/stack-adapters.md`, long checklists to `references/`. Use real commands verified in this session; shape it to how the user asked for it.
6. **Register.** Add the entry to `skill-map.json` → `skills` (`type`, `departments`, `capability`, `when`, `level`, `owned: true`, `patch`). Add a row to the owning department's **Tools** table in its installed `SKILL.md`. Project skills: also project memory → *Project skills*.
7. **Sync.** `node scripts/sync.mjs`; confirm it is listed and has no `auto: true`.
8. **Use it now** for the current task; it loads automatically in the next session.
9. **Report:** *"Creé la skill `<name>` (trigger: …) en `<path>`."*
10. **Memory:** say in the Cierre's Aprendido that the skill exists and why (the hook saves it to engram).

## 4. Project skills from repetition

When project memory → *Repeated procedures* counts the same procedure twice, generate a project skill with section 3 (project row), using the phrases the user used both times.
