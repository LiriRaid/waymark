# ui-system · mode: tokens

Loaded on demand from `../SKILL.md` → *Modes*.

- **When:** implement an approved system, add a theme ("tema oscuro"), or refactor tokens ("unifica los colores", "design tokens").
- **Steps:**
  1. Confirm the source of truth from the record and the stack adapter (`../references/stack-adapters.md`). Never edit generated or vendor files.
  2. Three layers: primitives (scale steps) → semantic roles → component tokens only where a library requires them. Components reference semantic roles only.
  3. Dark theme remaps roles, not primitives (rules in `palette-method.md` §3); never a blind inversion.
  4. Theme switching: one attribute or class on the root, `prefers-color-scheme` as default, applied before first paint (with SSR: cookie or inline bootstrap). Runtime code is handed to `dept-frontend`.
  5. Migrate literals reported by `consistency-check` file by file; visual output stays identical unless change is the goal.
  6. Verify: contrast table for every touched pair and theme; build gate; light and dark screenshots via `test.browser` (`browser-verify`) only when the user asks.
- **Output:** files changed, token diff (added / renamed / removed), contrast table.
