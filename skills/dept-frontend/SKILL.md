---
name: dept-frontend
description: "Waymark · Frontend department. Use FIRST, before any ui-* skill, to build, change or fix UI code: \"crear un modal\", \"nueva pantalla\", \"componente\", \"formulario\", \"tabla\", \"sidebar\", \"layout responsive\", \"SSR\", page, view, client routing. Not for one color or text."
---

# Frontend Engineering

## Quick ref
**Mission:** Build client-side UI (web or mobile) that is correct, accessible, performant and consistent with the stack's conventions.
**Must:** reactive state primitive and render optimization per stack profile · styling system first, tokens only · guard platform-only APIs when server-rendering · clean up subscriptions, listeners and animations · every UI state (loading, empty, error, success)
**UX musts:** match the existing screens (spacing, density, components) · visible focus and full keyboard path · labels on every control · loading / empty / error states that look like the project's own
**Skills by default:** `ui-build` · `library-docs` (+ the stack's framework / UI-library MCP when the user has one; `run` / `browser-verify` only when the user asks)
**DoD:** Works in the running app, a11y basics pass, all states handled, tests cover criteria, gates green.

## Entry
Run the *Waymark protocol → Entry* from the instructions file (already in context; do not load the `waymark` skill for it). No Waymark block in context (guest) → *Guest entry*, `../waymark/references/coexistence.md` §3. Department-specific reads:
- Learnings: `~/.waymark/learnings/dept-frontend.md` if it exists.
- Stack profile: L1 *Commands* + *Conventions by department → Frontend*, L2+ full. UI work: also the *Quick ref* of `dept-ux-ui`.
- Tools: the **Tools** table below. Open `../waymark/skill-registry.md` only if a capability there has no installed provider.

## Brief questions
The brief must answer:
1. **What** UI is built or changed (component, screen, dialog, form) and which acceptance criteria it satisfies?
2. **Why / for whom** — which user task does it serve?
3. **Where** — which feature owns it (scope rule: one feature → inside it; two or more → shared), exact folder per *Placement rules*, and which existing shared or library component is reused?
4. **Data source** — which service, store or API feeds it, and who owns that contract (`dept-backend`, `dept-data`)?
5. **States** — loading, empty, error, success, disabled, plus hover/focus/active?
6. **Responsive and rendering** — narrowest viewport, light/dark, SSR/hydration constraints?
7. **Accessibility** — keyboard path, focus management, labels, live regions?
8. **How and done** — procedure, skills/MCP (`ui-build`, `ui-refine`, `library-docs`, library MCP) and the tests that prove it? (The browser only if the user asks.)

## Scope
- Owns: components/views, client state, client routing, rendering mode (CSR/SSR/SSG/hydration), styling implementation, icons, client animations, client-side performance, wiring accessibility semantics.
- Does not own: visual and interaction design decisions → `dept-ux-ui` · API contracts → `dept-backend` · global state, caching and data models → `dept-data` · module placement rules → `dept-architecture` · build/deploy → `dept-devops`.

## Procedures
Detailed steps live in `procedures.md` (same folder). **Read only the section you need**: search its heading, read that block, not the whole file. Anti-patterns and references are at the end of that file.

- New component / screen (L2)
- Bug fix (L1/L2)
- Styling / restyle (L1/L2)
- Animation / motion
- Performance pass

## Rules

### Components and state
- **MUST** follow the stack's component model; no legacy module systems the stack profile marks as deprecated.
- **MUST** use the framework's recommended reactive state primitive for local state; streams only for event sequences.
- **MUST** use the framework's change-detection or render optimization by default.
- **MUST** update state immutably or through the primitive's setter API; never mutate shared state in place.
- **MUST** clean up subscriptions, timers, listeners, observers and animations on destroy/unmount.
- **MUST** provide stable keys/tracking for every rendered list.
- **SHOULD** keep components presentational; move data access and orchestration to services/stores per the architecture.
- **SHOULD** use the framework's recommended dependency injection or context mechanism.

### Rendering, SSR and hydration
- **MUST** guard browser/platform-only APIs (window, document, storage, device APIs) when code runs on the server or multiple platforms.
- **MUST** make every new public route renderable in the project's rendering mode; decide prerender/SSR/CSR during planning.
- **SHOULD** defer or lazily hydrate heavy, below-the-fold blocks when the framework supports it.
- **MUST NOT** introduce hydration mismatches (non-deterministic values, time, random IDs in server output).

### Styling and assets
- **MUST** use the project's styling system first; custom CSS only when it cannot express the need.
- **MUST** use design tokens (color, spacing, radius, typography, motion); no hard-coded values.
- **MUST NOT** use inline styles except for justified dynamic bindings.
- **MUST** import UI library components and icons individually (tree-shakeable).
- **SHOULD** keep custom icons/SVGs where the stack profile defines.

### Accessibility wiring
- **MUST** use native semantic elements before ARIA; every interactive element keyboard reachable with visible focus.
- **MUST** label icon-only controls and form fields.

## Tools
| Capability | Skill / MCP / Agent | When | Level |
|---|---|---|---|
| `ui.build` | `ui-build` | Layout, responsive, forms, cards, navigation, visual polish | L1 |
| `ui.refine` | `ui-refine` | Any animation, transition, micro-interaction, scroll effect | L2 |
| `ui.system` | `ui-system` | Premium polish, hierarchy, dashboards, landing pages (when requested) | L2 |
| `test.browser` | `browser-verify` | Flows, responsive checks, screenshots, only when the user asks | — |
| `app.run` | `run` | See the change working in the real app | L2 (L1 for visible changes) |
| `docs.library` | `library-docs` (→ the docs MCP servers the user has) | Framework, styling or UI library API not verified this session | Q |
| `framework.cli` | the stack's framework CLI/docs MCP, if the user has one (e.g. `angular-cli` for Angular); none → `library-docs` | Generators, best practices, migrations | L1 |
| `ui.library` | the UI library's MCP, if the user has one (e.g. `primeng`); else `library-docs` | Component API, props, examples, theming tokens | L1 |

## Definition of Done
- [ ] Exit protocol of `waymark` (instructions file → Exit; L2+ full: `../waymark/references/protocol.md`) (gates, architecture conformance, review, learnings)
- [ ] Acceptance criteria verified in the running app (`run`) and covered by tests
- [ ] Loading, empty, error, success and disabled states implemented
- [ ] Keyboard navigation, visible focus and labels verified
- [ ] No console errors or hydration warnings; SSR render verified when enabled
- [ ] Tokens only; light/dark and narrow viewport checked
- [ ] Cleanup for subscriptions, listeners and animations in place

## Hand-offs
- To `dept-ux-ui`: missing states, copy, hierarchy, token or motion decisions.
- To `dept-backend`: API contract gaps or error shapes the UI cannot handle.
- To `dept-data`: shared state, caching, persistence or offline sync.
- To `dept-architecture`: unclear placement or a needed cross-module contract.
- To `dept-qa`: test strategy, browser regression suites.
- To `dept-security`: auth flows, token storage, XSS-prone rendering.
- To `dept-devops`: SSR/prerender configuration, bundle budgets, deploy.

## Learned rules

_Grows with use (waymark `references/learning.md`). Only rules that are general for this department and not already stated above. Format: `- [YYYY-MM-DD] <rule> — <why> (source: <project>)`._
