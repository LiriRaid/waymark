# ui-build · mode: build

Loaded on demand from `../SKILL.md` → *Modes*.

- **When:** a new component, dialog, form, screen or dashboard is needed and no equivalent exists.
- **Steps:**
  1. Read the brief and the mini-brief inputs; list `patterns/` and read any match.
  2. Inventory: Grep shared components, tokens and similar screens. Note spacing scale, type steps, radius, elevation and motion tokens in use.
  3. Write the design decision. Brownfield: name the screens it must match. Greenfield: run `greenfield-direction` first.
  4. Sketch structure in text: regions, hierarchy (one dominant element), primary and secondary actions, reading order.
  5. Choose primitives: native elements first, then the component library, then custom markup.
  6. Implement with the stack adapter. Tokens only; no hard-coded color, spacing, radius or duration.
  7. Implement every state: loading (skeleton for content, inline spinner for an action), empty (message + next action), error (cause + recovery), success feedback, disabled, hover, focus-visible, active. Forms add field-level validation, submit pending and server error.
  8. Responsive: build from the narrowest viewport up; prefer fluid grid/flex, `minmax`, `clamp` and container-relative sizing over new breakpoints. Check reflow at 320 CSS px.
  9. Accessibility basics: labelled controls, logical focus order, visible focus, dialogs trap and restore focus and close on Escape, async status in a live region, contrast in every theme, targets at least 24x24 px.
  10. Motion only where it explains a change (open, close, reorder, feedback); respect reduced motion. Elaborate motion belongs to `ui-refine` animate.
  11. Cover every state with specs (narrow and wide, light and dark, keyboard-only); run it (`run` / `browser-verify`) only when the user asks.
- **Output:** files created, the design decision, states checklist, screenshots or notes of the checks.
