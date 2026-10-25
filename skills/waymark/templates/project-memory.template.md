# Project: <name>

Path: <absolute path to project root>
Updated: <YYYY-MM-DD>

## Work in progress
Read first at Recall. **One line per task, written by the end-of-turn hook from the Cierre's Aprendido** (≤200 characters); never edit these lines by hand. tasks.md is generated from them; a line without an ID at its head counts as a note. Any agent can resume from here.
<!-- Format: "- ▶ [<task ID>] <Aprendido>" (parcial / bloqueado) while the task is open; a task done (hecho) leaves this section, its record stays in git and tasks.md. A follow-up replaces its task's line; lines over 200 characters and open lines older than 14 days move whole to history.md. The whole record: `W tasks <task ID>`. -->

## Identity
- Stack: <slug from stacks/> (<framework + version>)
- Architecture: <slug from architectures/> — <how it maps here, e.g. features/<f>/{components,services,entities,routes}> — evidence: <where the pieces live, first structure commit, docs> (to confirm | confirmed <date> | profile default)
- Package manager / build tool: <pnpm | bundle | uv | gradle | …>
- Related projects: <e.g. backend API at ../api>

## Project map
Filled by the minimal project scan (waymark `references/project-detection.md`); extended when a task explores a new area. The end-of-turn hook adds and keeps *Areas* (one line per folder a task touched, docs/adr/0023).
- Source root and layout: <e.g. src/app/{core,shared,features}>
- Path aliases: <e.g. @core/* → src/app/core/*>
- How this project builds: <composes shared pieces (e.g. every modal wraps app-modal) | builds per feature | mixed>
- Reusables (path · what it is · when to use):
  - Components / UI: <e.g. shared/components/app-modal — base dialog, wrap it for every modal>
  - Features / modules: <…>
  - Services / API clients: <…>
  - Utils / helpers / pipes: <…>
  - Models / entities / types: <…>
  - Animations / motion: <…>
  - Styles / tokens / theme: <…>
- Reference files: <one exemplary file per kind: component, service, endpoint, test — with paths>
- Config: <lint/format/test config files worth knowing>

## Quality gates (verified commands)
| Gate | Command | Verified |
|---|---|---|
| typecheck | | <date> |
| lint (changed files) | | |
| test (related) | | |
| test (full) | | |
| build | | |
<!-- A project with no build step: write its row as `| build | none (<why>) | <date> |`; the Build testigo then does not apply. The end-of-turn hook dates a row whose command passed after the last change, and fills an empty row with the gate that passed; it never replaces a command. -->

## Design system
Maintained by ui-system (discover mode). Source of truth for ui-build / ui-refine.
- Direction: <tone, density, personality>
- Tokens file(s): <path>
- Palette: <roles → token names>
- Typography: <families, scale>
- Spacing / radius / elevation: <scales>
- Component library: <e.g. PrimeNG Aura preset at …>
- Motion: <durations, easings, library>

## Conventions specific to this project
- …
<!-- A step that is yours, in your words and dated: "- Deploys: the user (2026-10-25: «yo despliego»)", "- PRs: the user". A task whose only missing step is one of those closes hecho. -->
<!-- A project that migrates with its own script: "- Migrations: bin/migrate new <name>". A migration file written by hand is asked about first. -->


## Repeated procedures
The end-of-turn hook counts the same run of 3 to 5 action commands across tasks (docs/adr/0023). At 2 → the session card proposes a project skill; write its name in *Project skill* once it exists.
| Procedure | Times | Project skill |
|---|---|---|

## Project skills
- `<slug>-<topic>` — <path> — <what it triggers on>
