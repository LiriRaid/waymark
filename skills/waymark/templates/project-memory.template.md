# Project: <name>

Path: <absolute path to project root>
Updated: <YYYY-MM-DD>

## Work in progress
Read first at Recall. **One line per task, written by the end-of-turn hook from the Cierre's Aprendido** (≤200 characters); never edit these lines by hand. tasks.md is generated from them; a line without an ID at its head counts as a note. Any agent can resume from here.
<!-- Format: "- ▶ [<task ID>] <Aprendido>" (parcial / bloqueado) or "- ✔ [<task ID>] <Aprendido>" (hecho; the newest 5 stay). A follow-up replaces its task's line; older ✔ lines and lines over 200 characters move whole to history.md. The whole record: `waymark.mjs tasks <task ID>`. -->

## Identity
- Stack: <slug from stacks/> (<framework + version>)
- Architecture: <slug from architectures/> — <how it maps here, e.g. features/<f>/{components,services,entities,routes}>
- Package manager / build tool: <pnpm | bundle | uv | gradle | …>
- Related projects: <e.g. backend API at ../api>

## Project map
Filled by the minimal project scan (waymark `references/project-detection.md`); extended when a task explores a new area.
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

## Solved problems
Searched by symptom at Recall. One entry per problem that took more than one attempt; keep the dead ends, they are what saves time next time.
<!-- - [YYYY-MM-DD] Symptom: <what the user saw> · Root cause: <real cause> · Fix: <what worked, file:line> · Did not work: <attempts and why> · Cost: <attempts / requests> -->

## Gotchas
- …

## Decisions (ADR log)
- [YYYY-MM-DD] <decision> — <why>

## Repeated procedures
Count how often a project-specific procedure happens. At 2 → propose a project skill.
| Procedure | Times | Project skill |
|---|---|---|

## Project skills
- `<slug>-<topic>` — <path> — <what it triggers on>
