# dept-ux-ui · Procedures

Loaded on demand from `SKILL.md` → *Procedures*. Read only the section the task needs.

### New screen or flow (L2)
1. Identify the primary task of the screen and the single primary action; everything else is secondary.
2. Define hierarchy: one dominant heading, grouped content, consistent spacing scale, scannable alignment.
3. Specify states: loading (skeleton for lists/content, spinner only for one-off actions), empty (message + action), error (what happened + how to recover), success (immediate feedback), disabled, hover, focus, active.
4. Specify responsive intent: narrowest viewport first, touch targets, reflow at 320 CSS px without horizontal scroll.
5. Write microcopy (copy rules) in the project's UI language.
6. Pick tokens from the existing system; propose new tokens only when none fits.
7. Invoke `ui-system` for hierarchy and design-system quality; hand implementation to `dept-frontend` (`ui-build`).
8. Run `ui-audit` on the implemented code; fix every AA failure.

### Visual improvement ("se ve feo", "más profesional")
1. Start from the user's screenshot or the component files and name the concrete problems (`browser-verify` screenshots only when the user asks).
2. Fix hierarchy, spacing rhythm and contrast before adding decoration.
3. Invoke `ui-system`; use `ui-refine` for critique and polish. Preserve behavior and interactions.
4. Capture after and compare.

### Accessibility audit
1. Invoke `ui-audit` on the target screens/components.
2. Check manually: keyboard-only pass (tab order, focus visible, no traps except modals), screen reader names/roles, contrast in all themes, zoom to 200%, reflow at 320px, reduced motion.
3. Evidence from the code (focus order, contrast tokens); `browser-verify` screenshots only when the user asks.
4. Report findings by WCAG success criterion, severity and file:line; fix or hand off.

### Theming / tokens change
1. Locate the token source of truth (stack profile); never edit generated or vendor files. UI-library themes → that library's MCP if the user has one (e.g. `primeng`), else `library-docs`, for token names.
2. Change tokens at the semantic layer (surface, primary, text-muted), not raw palette usages.
3. Validate contrast for every affected pair in light and dark themes.
4. Runtime theming → verify the theme persists and applies before first paint where possible.

### Motion
1. Invoke `ui-refine`.
2. Give each animation a purpose: feedback, orientation or continuity. Remove decorative-only motion from task flows.
3. Provide a reduced-motion variant (no motion or a simple fade) for every non-essential animation.

## Anti-patterns
- Removing focus outlines without a visible replacement.
- Placeholder text used as the only label.
- Hero or above-the-fold icons as raster images when inline vectors improve load.
- Buttons without press feedback.
- Generic errors without recovery information.
- Spinners where a skeleton fits.
- Light text on light backgrounds without a contrast check.
- Motion that ignores reduced-motion preferences.
- Multiple competing primary actions on one view.
- Restyling that silently changes behavior or interactions.

## References
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- WAI-ARIA Authoring Practices Guide: https://www.w3.org/WAI/ARIA/apg/
- ISO 9241-210:2019 — Human-centred design: https://www.iso.org/standard/77520.html
- W3C Design Tokens Community Group format: https://www.designtokens.org
- MDN prefers-reduced-motion: https://developer.mozilla.org/docs/Web/CSS/@media/prefers-reduced-motion
- Material Design 3: https://m3.material.io
- Apple Human Interface Guidelines: https://developer.apple.com/design/human-interface-guidelines
