# dept-frontend · Procedures

Loaded on demand from `SKILL.md` → *Procedures*. Read only the section the task needs.

### New component / screen (L2)
1. Read acceptance criteria (`dept-product`) and UI states/specs (`dept-ux-ui`). Missing at L2+ → write them first.
2. Place files per the architecture profile → *Placement rules*; reuse shared components before creating new ones (Grep the shared layer).
3. Component library in use → check it covers the need first (its MCP if the user has one, e.g. `primeng`; else `library-docs`).
4. Verify any framework API not used this session with `library-docs`; use the framework CLI MCP generators when the user has one (e.g. `angular-cli`).
5. Write the test first for the logic and the main criterion (`dept-qa`, stack profile → *Testing*).
6. Implement with the stack's component conventions: typed inputs/outputs, reactive state primitive, optimized change detection, lifecycle cleanup.
7. Invoke `ui-build` for layout, responsive behavior, forms, cards, navigation and visual polish.
8. Implement every state: loading, empty, error, success, disabled; plus hover, focus, active for interactive elements.
9. Add accessibility semantics: native elements first, labels, focus order, keyboard handling (`dept-ux-ui` rules).
10. SSR/SSG enabled → verify server render and hydration without errors; guard browser-only APIs.
11. Verify the criteria with specs and the build; `run` / `browser-verify` only when the user asks.
12. Run the Exit protocol gates (commands from project memory).

### Bug fix (L1/L2)
1. Reproduce with a failing test (the running app or `browser-verify` only when the user asks).
2. Confirm the root cause before editing (render timing, stale state, missing cleanup, hydration mismatch, CSS cascade).
3. Write a regression test that fails.
4. Apply the smallest fix in the owning component; preserve inputs, outputs, styles and interactions.
5. Re-run the test, the gates and a manual check of the affected screen.

### Styling / restyle (L1/L2)
1. Use the project's styling system and existing tokens/utilities; search for an existing token before adding one.
2. Prefer fluid layout (flex/grid, relative units, intrinsic sizing) over new breakpoints.
3. New tokens go in the project's token source of truth (stack profile), never inline.
4. Check light and dark themes and the narrowest supported viewport.
5. Invoke `ui-build` at L2; `ui-system` when premium polish or hierarchy is requested.

### Animation / motion
1. Invoke `ui-refine`.
2. Animate compositor-friendly properties (transform, opacity) unless justified.
3. Encapsulate animation logic per the stack profile (service, composable, controller) and clean it up on destroy/unmount.
4. Respect reduced-motion preferences (`dept-ux-ui` motion rules).

### Performance pass
1. Measure first (Lighthouse/Web Vitals, framework profiler, or mobile equivalent).
2. Apply: lazy-load routes and heavy blocks, defer non-critical rendering, virtualize long lists, memoized derived state, tree-shakeable imports, optimized images.
3. Re-measure and report before/after.

## Anti-patterns
- Default/unoptimized change detection where the stack recommends an optimized mode.
- Mutating state directly instead of through the setter/immutable update.
- Subscriptions or listeners without cleanup.
- Accessing window/document/storage without a platform guard in SSR or multi-platform code.
- Importing a whole UI or icon library.
- Hard-coded colors, spacing or durations.
- Spinner-only UIs with no empty or error state.
- Declaring done from tests alone without seeing the screen.

## References
- web.dev — Core Web Vitals: https://web.dev/articles/vitals
- WAI-ARIA Authoring Practices Guide: https://www.w3.org/WAI/ARIA/apg/
- Official stack docs: stack profile → *Official docs*
