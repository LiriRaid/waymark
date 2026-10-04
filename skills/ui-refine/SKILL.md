---
name: ui-refine
description: "Waymark tool (ui.refine), owner dept-ux-ui. Improve existing UI by mode (critique, polish, simplify, harden, adapt, animate…): \"mejora esta pantalla\", \"pulir detalles\", \"hazlo más limpio\", \"agrega animaciones\", \"no se adapta al móvil\". Not new UI (ui-build)."
---

# UI Refine

> **Precondition.** Tool of `dept-ux-ui` (supporting: `dept-frontend` for implementation). If that department skill is not loaded in this conversation, load it first and use its brief (what, why, where, how) as the input of this skill. Skip only for L0 edits.

## Approach
Refinement works on something that already exists and already has users. It improves one named quality at a time and leaves everything else exactly as it was.
- **Name the mode.** Map the request to one mode (or an explicit short sequence, e.g. critique → polish). "Make it better" without a mode starts with critique.
- **Diagnose before treating.** Look at the running screen, not only the code. Every change answers a concrete finding.
- **Smallest effective change.** Adjust tokens, spacing, hierarchy and states before restructuring. Rewrites are a hand-off to `ui-build`, not a refinement.
- **The system is the reference.** Fixes use existing tokens and components; a missing token is a proposal, not an inline value.
- Questions before acting: what exactly feels wrong, to whom, on which device? What must not change? How will I show before and after?

### Preserve first (every edit mode)
Before the first edit, write a short **keep list** for the target: hover, focus and active states; existing animations and transitions (timing included); keyboard behavior and shortcuts; inputs/outputs/props and events; responsive behavior per breakpoint; copy that was not in scope. Anything on the keep list changes only if the user asked for it. After editing, re-check each item and report it. When a requested change forces a keep-list item to change, stop and ask.

## Inputs
| Input | Source |
|---|---|
| Brief | the `dept-ux-ui` brief (what is wrong today, for whom) |
| Stack conventions | `../waymark/stacks/<stack>.md` → *Frontend* (styling, motion library, SSR guards) |
| Project context | `<project>/.waymark/memory.md` → `## Design system`, *Conventions*, UI language |
| Current state | the user's screenshot(s) and the component files (`browser-verify` / `run` only when the user asks) |
| Detail references | `references/` in this skill (load only for the active mode) |
| Known patterns | `patterns/` in this skill (generic) + project skills (project-specific) |

## Output contract
Always return to the department:
1. **Mode(s)** run and the finding each change answers.
2. **Keep list** and its post-change check (each item kept, or changed with user approval).
3. **Files changed** and tokens touched; proposed new tokens listed separately.
4. **Evidence:** before/after captures or a clear description of each, viewports and themes checked.
5. **A11y impact:** contrast, focus, reduced motion, target size.
6. **Open items** for `dept-frontend` (implementation), `dept-product` (scope) or a later mode.

## Pattern library (grows with use)
- Before building, list `patterns/` and read the matching file, if any.
- After building something reusable that has no pattern yet (a modal, a data table, a stepper…), write `patterns/<pattern>.md` from `../waymark/templates/pattern.template.md`: stack-agnostic intent, anatomy, states, a11y, pitfalls, and one short adapter per stack it was built in. Project-specific details go to project memory, not here.
- Update an existing pattern only with new, verified information (novelty check, waymark `references/learning.md`).
- For this skill, patterns are refinement recipes as well as components (e.g. `staggered-list-entrance.md`, `skeleton-to-content.md`).

## Modes
Read **only** the mode the task needs (one file); never load all modes.

- **critique** — "revisa la UX", "qué le falta", "se ve feo" with no concrete target, or before any larger refinement. → `modes/critique.md`
- **polish** — the screen works but feels unfinished: misaligned edges, uneven gaps, inconsistent radii, missing states. → `modes/polish.md`
- **simplify** — "hazlo más limpio", too many elements, competing emphasis, high cognitive load. → `modes/simplify.md`
- **clarify** — confusing labels, vague buttons, generic errors, empty screens with no guidance. → `modes/clarify.md`
- **harden** — the screen breaks with real data or real conditions. → `modes/harden.md`
- **adapt** — "no se adapta al móvil", a new viewport, device, input mode or context (print, embedded, kiosk, touch). → `modes/adapt.md`
- **animate** — "agrega animaciones", "transiciones", "microinteracciones", or a state change that is hard to follow. → `modes/animate.md`
- **boldify / quieten** — the design reads as bland and forgettable (boldify) or loud, busy and tiring (quieten). → `modes/boldify-quieten.md`

## Stack adapters
Stack-specific notes → `references/stack-adapters.md` (read only the project's stack row).

## Learned notes
_Grows with use (waymark `references/learning.md`). Dated, non-obvious notes about using this tool. When there are more than ~10, fold them into the body above and clear this list._
