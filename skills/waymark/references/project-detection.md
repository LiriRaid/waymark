# Project detection and minimal scan

Part of the `waymark` core skill. Paths are relative to the core skill folder (`<skills-dir>/waymark/`). Read only when the instructions file or a department points here.

## Minimal bootstrap (any level, one step)

No project memory yet → create `<project>/.waymark/memory.md` **now** (`<project>` = the git root; the session hook names the exact path), before the task, from `templates/project-memory.template.md`. The folder is local: the end-of-turn hook adds `.waymark/` to `.git/info/exclude` and writes its `README.md` and `tasks.md` (docs/adr/0007). Fill only what one quick look gives:
- *Identity*: stack and version from the manifest; architecture from the folder signals below (or "unknown").
- *Quality gates*: commands from the project's own `AGENTS.md` / `CLAUDE.md` / README, else the manifest scripts (`package.json` scripts, `Makefile`, `composer.json`…); mark them *not verified*.
- *Work in progress*: empty; the end-of-turn hook writes one line per task from its Cierre (`- ✔|▶ [<task ID>] …`, ≤200 characters).
- Add the row to `~/.waymark/projects.md`.

Leave *Project map* empty; the **full scan below** runs at L2+ or when the map is needed. Never skip Recall or Learn because the file did not exist.

Run the first time Waymark works in a project, for a new project from scratch, or when the project memory has no *Project map*.

| Signal | Stack |
|---|---|
| `package.json` with `@angular/core` / `@nestjs/core` / `next` or `react` / other | angular / nestjs / react / node |
| `Gemfile` with `rails` | rails |
| `pyproject.toml`, `requirements.txt` | python |
| `go.mod` · `pom.xml`/`build.gradle` · `*.csproj` | go · java · dotnet |
| nothing known | generic |

| Folder signal | Architecture |
|---|---|
| `src/app/features/` or `src/features/` | screaming |
| ≥4 of `app, pages, widgets, features, entities, shared` | feature-sliced |
| `domain/` + `adapters/` or `ports/` | hexagonal |
| `domain/` + `application/` + `infrastructure/` | clean |
| `modules/<a>/`, `modules/<b>/` with public index, or `packs/` | modular-monolith |
| `controllers/` + `services/` or Rails `app/models` + `app/controllers` | layered |

Signals only say *which* technology it is, not *how this project is built*. Before writing the memory, run a **minimal project scan** (read-only, bounded: config files plus at most ~5 source files):

1. **Config:** manifest, compiler/tsconfig, lint and format config, test config, path aliases, env example (never real secrets).
2. **Structure:** list folders 2–3 levels deep from the source root; confirm or correct the architecture guessed above. The table is a starting point, not a limit: frontends and backends use any architecture (hexagonal, clean, feature-sliced, MVVM, atomic design, micro-frontends, monorepo layouts, hybrids). **No profile matches** → describe what the project actually does (layers, allowed imports, where each kind of file lives), create `architectures/<slug>.md` from `templates/architecture.template.md` with those rules and its *Detect* signals, tell the user in one line, and record it in project memory. **Hybrid** → record which profile applies to which folder.
3. **Reference examples:** read 1–2 existing files of the same kind as the current task (a component, an endpoint, a migration, a test) to learn naming, file layout, state and error-handling patterns.
4. **Reusables:** list what the project reuses, by kind: components/UI, features/modules, services/API clients, utils/helpers, models/entities/types, animations, styles/tokens/theme (search the shared/common/core layers and the most-imported files). Note **how the project builds**: does it compose shared pieces (e.g. every modal wraps a base modal) or build per feature? Later tasks must follow that.
5. **Record** it in project memory → *Identity*, *Project map* and *Conventions specific to this project*. Later tasks read the map instead of rescanning; extend it when a task explores a new area.

**Project instructions file.** The global instructions block is the same for every project. If the scan finds something this project needs **on every task** and that differs from the general rules (a mandatory convention, a forbidden library, a different language for code or commits, a monorepo layout, how to run it), propose a project instructions file **[ask]**: `<project>/<project-instructions-file>` (`CLAUDE.md` for Claude Code, `AGENTS.md` for most other agents; see `~/.waymark/agent.md`).
- If one already exists, read it and propose only additions; never rewrite the team's content.
- Keep it short (< ~2,000 characters) and only always-needed, non-personal rules: it is committed and shared with the team, and loaded on every task. Commands, gotchas, maps and decisions stay in project memory.
- It never repeats or contradicts Waymark; it may add one line: *"This project uses Waymark; project memory: `.waymark/memory.md` (local, not committed)."*

Then verify the gate commands once (run each, keep the ones that work) and write the project memory file. Then keep the private layer current: add the project's row to `~/.waymark/projects.md`, and add any stack, package manager or architecture not yet listed to `~/.waymark/profile.md`. **New project from scratch**: run `dept-product` (scope) → `dept-architecture` (choose architecture, write ADR) → owner department, and create the project memory at the end of the first session.
