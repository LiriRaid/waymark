---
name: ui-build
description: "Waymark tool (ui.build), owner dept-frontend. Build new UI in any framework: \"crea un modal\", \"nueva pantalla\", \"construye el componente\", \"arma un dashboard\", \"formulario de registro\", \"landing\". Follows the project's design system. Not restyling (ui-refine)."
---

# UI Build

> **Precondition.** Tool of `dept-frontend`. If that department skill is not loaded in this conversation, load it first and use its brief (what, why, where, how) as the input of this skill. Skip only for L0 edits.

## Approach
New interface is a design decision before it is code. Decide on purpose and character first, then write code that carries that decision into every detail.
- **The existing system wins.** In a project with tokens, a component library or established screens, the "direction" is already chosen: match it so precisely that the new view looks like it was always there. Invention is reserved for greenfield work.
- **Intent over intensity.** A quiet, dense admin view and an expressive landing can both be excellent; what fails is a view with no point of view, assembled from defaults.
- **Generic is a defect.** Interchangeable layouts, a single flat type size, evenly spread color, cards wrapped around everything and decorative effects with no reason all read as "template". Each choice should be explainable by the product, the user or the content.
- **Complete beats pretty.** A view is not built until loading, empty, error, success, disabled and interaction states exist, it reflows on the narrowest screen and it works by keyboard.
- Questions before acting: who uses this and in what situation? What is the one primary action? What already exists that I can reuse? What would make this view clearly belong to this product?

### Design system decision (mini-brief)
Write it before the first file, 4–6 lines, in the brief's language. It adapts to the project's situation.

| Field | Brownfield (system exists) | Greenfield (no system) |
|---|---|---|
| **Purpose** | user task + single primary action | same |
| **Tone** | inherited: name the screens/components it must match | chosen: one concrete adjective pair (e.g. "calm, exact"; "warm, editorial") grounded in a sentence about who uses it and where |
| **Constraints** | tokens, library components, breakpoints, theme modes, SSR, a11y level | framework, performance budget, a11y level, theme modes |
| **Differentiator** | one detail that makes this view excellent inside the system (information density, a clear empty state, a well-paced form) | the one memorable trait of the visual identity (type pairing, color strategy, layout rhythm) |
| **Reuse** | components and patterns reused, new ones justified | primitives to create first (tokens, button, input, surface) |

Brownfield rule: if a field would require a new token, font or component variant, list it as a proposal for `dept-ux-ui` instead of silently adding it.

### Avoid
- Inventing fonts, colors or radii in a project that already has a system.
- Shipping only the happy path; a spinner as the only non-success state.
- A modal where inline or progressive disclosure would serve the task.
- Several competing primary actions on one view.
- New breakpoints to patch a layout that fluid sizing would fix.
- Copying a generic template layout without adapting hierarchy to the content.

## Inputs
| Input | Source |
|---|---|
| Brief | the `dept-frontend` brief (plus `dept-ux-ui` states/specs when present) |
| Stack conventions | `../waymark/stacks/<stack>.md` → *Conventions by department → Frontend* |
| Project context | `<project>/.waymark/memory.md` → *Identity*, *Conventions*, `## Design system` (create the section if missing) |
| Design system | token source of truth, theme preset, shared/ui components (Grep the shared layer) |
| Known patterns | `patterns/` in this skill (generic) + project skills (project-specific) |

## Output contract
Always return to the department:
1. **Design decision** (mini-brief) and mode used.
2. **Files** created or changed, with placement rationale.
3. **Reuse map**: components and tokens reused; anything new and why.
4. **States** covered (checklist) and the responsive and theme checks done.
5. **A11y basics** verified (keyboard path, focus, labels, contrast).
6. **Open risks / proposals** for `dept-ux-ui` (new tokens, variants) or `dept-backend` (missing error shapes).

## Pattern library (grows with use)
- Before building, list `patterns/` and read the matching file, if any.
- After building something reusable that has no pattern yet (a modal, a data table, a stepper…), write `patterns/<pattern>.md` from `../waymark/templates/pattern.template.md`: stack-agnostic intent, anatomy, states, a11y, pitfalls, and one short adapter per stack it was built in. Project-specific details go to project memory, not here.
- Update an existing pattern only with new, verified information (novelty check, waymark `references/learning.md`).

## Modes
Read **only** the mode the task needs (one file); never load all modes.

- **build** — a new component, dialog, form, screen or dashboard is needed and no equivalent exists. → `modes/build.md`
- **compose** — the screen can be assembled mostly from existing components (library or shared layer) with little or no new styling. → `modes/compose.md`
- **greenfield-direction** — no tokens, theme or component library exist yet, or the user explicitly asks for a new visual identity. → `modes/greenfield-direction.md`

## Stack adapters
Stack-specific notes → `references/stack-adapters.md` (read only the project's stack row).

## Learned notes
_Grows with use (waymark `references/learning.md`). Dated, non-obvious notes about using this tool. When there are more than ~10, fold them into the body above and clear this list._
