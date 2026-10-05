---
name: dept-ux-ui
description: "Waymark · UX/UI department. Use FIRST, before ui-system/ui-refine/ui-audit, for how the UI looks and feels: \"mejora el diseño\", \"se ve feo\", \"más profesional\", \"animación\", \"accesibilidad\", \"contraste\", \"tipografía\", \"paleta\", \"design tokens\", \"tema oscuro\", WCAG."
---

# UX/UI Design

## Quick ref
**Mission:** Make interfaces accessible (WCAG 2.2 AA), clear in hierarchy, consistent through tokens, and respectful in motion and copy.
**Rules:** WCAG 2.2 AA minimum · visible focus and full keyboard access · reduced-motion respected for every non-essential animation · tokens only, contrast checked in every theme · every state designed (loading, empty, error, success)
**Skills by default:** `ui-system` · `ui-audit` · `ui-refine` (`browser-verify` only when the user asks)
**DoD:** Audit passes AA, states and copy complete, tokens consistent, motion reduced-safe.

## Entry
Run Rule 0 (the instructions block, already in context; do not load the `waymark` skill for it). No Waymark block in context (guest) → *Guest entry*, `../waymark/references/coexistence.md` §3. Department-specific reads:
- Learnings: `~/.waymark/learnings/dept-ux-ui.md` if it exists.
- Stack profile: L1 *Conventions by department → Frontend*, L2+ full. Also the project's token source of truth.
- Tools: the **Tools** table below. Open `../waymark/skill-registry.md` only if a capability there has no installed provider.

## Brief questions
The brief must answer:
1. **What** is designed or improved (screen, flow, component, theme, motion, copy)?
2. **Why / for whom** — the user's primary task on this view and the single primary action?
3. **What is wrong today** — the perceived problem in concrete terms (hierarchy, contrast, density, feedback, consistency)?
4. **Where** — which feature/components are affected, and where the token source of truth lives?
5. **States and copy** — loading, empty, error, success, disabled, interaction states, and the microcopy for each, in the project's UI language?
6. **Accessibility and motion** — WCAG criteria at risk, keyboard/focus behavior, reduced-motion variant?
7. **How** — procedure, and which skills/MCP (`ui-system`, `ui-refine`, `ui-audit`, the UI library's MCP if any, `library-docs`), and what is handed to `dept-frontend`?
8. **Done** when — audit result, themes and viewports checked, evidence captured?

## Scope
- Owns: accessibility requirements, visual hierarchy, layout rhythm, typography, color, design tokens and theming rules, interaction states, motion design, microcopy, information architecture, responsive intent.
- Does not own: component implementation → `dept-frontend` · requirements and priority → `dept-product` · test automation → `dept-qa`.

## Procedures
Detailed steps live in `procedures.md` (same folder). **Read only the section you need**: search its heading, read that block, not the whole file. Anti-patterns and references are at the end of that file.

- New screen or flow (L2)
- Visual improvement ("se ve feo", "más profesional")
- Accessibility audit
- Theming / tokens change
- Motion

## Rules

### Accessibility (WCAG 2.2 AA)
- Meet WCAG 2.2 AA on every user-facing interface.
- Meet contrast: 4.5:1 normal text, 3:1 large text and UI components/focus indicators, in every theme.
- Make every interactive element keyboard operable with a visible focus indicator not obscured by sticky content (2.4.11).
- Keep a logical focus order; dialogs trap focus, restore it to the trigger on close, and close on Escape.
- Give icon-only controls an accessible name; hide decorative icons from assistive tech.
- Announce async status (toasts, form errors, results) through live regions with appropriate politeness.
- Provide targets of at least 24x24 CSS px (2.5.8); 44x44 recommended on touch.
- Offer a non-drag alternative for drag interactions (2.5.7).
- Associate visible labels with inputs; errors identify the field and suggest a fix (3.3.1, 3.3.3); no forced re-entry of known data (3.3.7).
- Never convey information by color alone.
- Prefer: follow WAI-ARIA APG patterns for composite widgets (tabs, menus, comboboxes, dialogs).

### Hierarchy, layout and tokens
- Use design tokens for color, spacing, radius, typography, elevation and motion; no hard-coded values.
- Keep one primary action per view or section.
- Prefer a consistent spacing and type scale; limit to the steps the system defines.
- Prefer: separate primitive and semantic tokens; components consume semantic tokens.
- Prefer skeletons over spinners for content loading.

### Motion
- Honor `prefers-reduced-motion` (or the platform equivalent) for every non-essential animation and any transition over 300ms.
- Prefer: keep hover/press feedback under 200ms and view transitions under 400ms on mobile.
- Prefer purposeful easing; avoid gratuitous bounce or overshoot in task flows.
- Never autoplay animation with sound, or flash more than 3 times per second.

### Copy
- Write in the project's configured UI language.
- Start actions with a verb that names the outcome ("Save changes", "Send message").
- Make errors say what happened and how to resolve it; never a generic "Something went wrong" alone.
- Prefer: keep labels short, consistent and in the user's vocabulary, not the system's.
- Never use modal confirmations for trivial reversible actions; prefer undo.

## Tools
| Capability | Skill / MCP / Agent | When | Level |
|---|---|---|---|
| `ui.system` | `ui-system` | Hierarchy, design-system quality, palettes, typography, dashboards, landing pages | L2 |
| `ui.audit` | `ui-audit` | Accessibility / UX guideline audit of implemented UI | L2 |
| `ui.refine` | `ui-refine` | Motion design, transitions, micro-interactions, UX critique and polish | L2 |
| `ui.build` | `ui-build` (via `dept-frontend`) | Layout and responsive implementation | L1 |
| `test.browser` | `browser-verify` | Evidence: keyboard pass, screenshots, responsive checks, only when the user asks | — |
| `ui.library` | the UI library's MCP, if the user has one (e.g. `primeng`); else `library-docs` | Component a11y and theming tokens | L1 |
| `docs.library` | `library-docs` (→ the docs MCP servers the user has) | WCAG, ARIA APG, styling-system docs | Q |
| `contrast.check` | none yet → waymark `references/skills.md` | Automated contrast and color-blindness checks | — |

## Definition of Done
- [ ] `ui-audit` run; no WCAG 2.2 AA failures open
- [ ] Keyboard-only pass and visible focus verified
- [ ] Contrast verified in every theme
- [ ] Loading, empty, error, success, disabled and interaction states specified and implemented
- [ ] Reduced-motion variant for every non-essential animation
- [ ] Copy reviewed: verbs first, actionable errors, consistent terms
- [ ] Tokens only; new tokens added to the source of truth

## Hand-offs
- To `dept-frontend`: implementation of specified states, tokens and motion.
- To `dept-product`: flows that change scope or need new requirements.
- To `dept-qa`: automated a11y checks and visual regression baselines.
- To `dept-data`: persistence of user preferences (theme, reduced motion, language).
- To `dept-devex`: design-system documentation and token tooling.

## Learned rules

_Grows with use (waymark `references/learning.md`). Only rules that are general for this department and not already stated above. Format: `- [YYYY-MM-DD] <rule> — <why> (source: <project>)`._
