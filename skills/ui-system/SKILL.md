---
name: ui-system
description: "Waymark tool (ui.system), owner dept-ux-ui. Design systems and visual identity: \"paleta de colores\", \"tipografía\", \"design tokens\", \"tema oscuro\", \"sistema de diseño\", \"qué estilo le queda\", \"qué gráfica uso\", theming. Records the existing system first. Not a component (ui-build)."
---

# UI System

> **Precondition.** Tool of `dept-ux-ui`. If that department skill is not loaded in this conversation, load it first and use its brief (what, why, where, how) as the input of this skill. Skip only for L0 edits.

## Approach
A design system is derived from a few decisions, not chosen from a catalogue: product, audience, conditions of use and existing code in; tokens in the project's own styling system out.
- **Existing system first.** Discover and record before proposing. Ignoring what shipped creates a second system.
- **Few inputs, many outputs.** One brand hue, one scale ratio and one base unit generate palette, type and spacing.
- **Roles over values.** Components consume semantic roles (`surface`, `text-muted`, `danger`), never raw values or primitive steps.
- **Accessibility constrains generation.** A color pair becomes a token only after its contrast passes in every theme it appears in.
- **Memory is the system's spine.** Every decision lands in project memory (`## Design system`) so the next session extends it.
- Questions before acting: Is there a system already, and where is its source of truth? Who uses it, how long, on which devices? Light, dark or both? Which component library constrains tokens? What brand traits must stay?

## Inputs
| Input | Source |
|---|---|
| Brief | the `dept-ux-ui` brief |
| Stack conventions | `../waymark/stacks/<stack>.md` → *Frontend* (styling system, component library, SSR) |
| Project context | `<project>/.waymark/memory.md` → `## Design system` (this skill's record, shared with ui-build and ui-refine) |
| Methods | `references/`: `palette-method`, `type-scale`, `product-direction`, `chart-choice` (load only what the mode needs) |
| Known patterns | `patterns/` in this skill (generic) + project skills (project-specific) |

## Output contract
Always return: mode(s) run; sources of truth read; files changed; decisions (recorded in project memory: yes/no); contrast table for every touched pair (pair · theme · ratio · pass/fail); drift counts; open risks (failing pairs, unmigrated files, library tokens not covered); hand-offs (`dept-frontend` for runtime theme code, `ui-audit` for a full accessibility pass, `dept-qa` for visual regression).

## Pattern library (grows with use)
- Before building, list `patterns/` and read the matching file, if any. See `patterns/README.md` for what belongs here.
- After building something reusable that has no pattern yet (theme switch, status color set, KPI tile row…), write `patterns/<pattern>.md` from `../waymark/templates/pattern.template.md`: stack-agnostic intent, anatomy, states, a11y, pitfalls, and one short adapter per stack it was built in. Project-specific details go to project memory, not here.
- Update an existing pattern only with new, verified information (novelty check, waymark `references/learning.md`).

## Modes
Read **only** the mode the task needs (one file); never load all modes.

- **discover** — first UI-system task in a project; record missing or older than the theme files; always before `recommend` or `tokens` on existing code. → `modes/discover.md`
- **recommend** — greenfield, explicit redesign, "qué estilo le queda", or "hazlo más profesional" when the system itself is the problem rather than one screen (one scr → `modes/recommend.md`
- **tokens** — implement an approved system, add a theme ("tema oscuro"), or refactor tokens ("unifica los colores", "design tokens"). → `modes/tokens.md`
- **chart** — "qué gráfica uso", dashboards, KPI rows, choosing chart colors. → `modes/chart.md`
- **consistency-check** — before a tokens refactor, after a large UI change, or "se ve inconsistente". Read-only unless the user asks to fix (then `tokens`). → `modes/consistency-check.md`

## Stack adapters
Stack-specific notes → `references/stack-adapters.md` (read only the project's stack row).

## Learned notes
_Grows with use (waymark `references/learning.md`). Dated, non-obvious notes about using this tool. When there are more than ~10, fold them into the body above and clear this list._
