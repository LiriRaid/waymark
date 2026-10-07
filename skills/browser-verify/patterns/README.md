# browser-verify patterns

Reusable verification flows, one file per flow: `patterns/<flow>.md` (e.g. `login-seed-user.md`, `crud-form.md`, `modal-dialog.md`, `paginated-table.md`, `theme-toggle.md`). Empty at first; it grows as flows are verified.

## When to add one
- A flow was verified end to end, is likely to recur in other projects, and has no file here yet.
- Run the novelty check first (waymark `references/learning.md`): list this folder and grep the flow name.

## Format
Start from `../../waymark/templates/pattern.template.md` and fill it for a check, not for a build:
- **Intent** — what the flow proves for the user and when the check is not worth running.
- **Anatomy** — the steps: route, recon, actions, assertions on visible outcomes.
- **States** — which of loading, empty, error, disabled, focus, viewport and theme apply.
- **Accessibility** — keyboard path, focus after open/close, announcements to confirm.
- **Pitfalls** — timing traps, flaky selectors, dev-mode noise in the console.
- **Stack adapters** — one short block per provider or stack actually used (built-in pane, Playwright, Angular, Rails…).

## What does not belong here
- Project routes, seed accounts, ports or data → project memory (`<project>/.waymark/memory.md`).
- Real credentials of any kind, ever.
- Anything already covered by `../SKILL.md` or a stack profile.
