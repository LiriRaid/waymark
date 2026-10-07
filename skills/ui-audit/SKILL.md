---
name: ui-audit
description: "Waymark tool (ui.audit), owner dept-ux-ui. Audit UI code against WCAG 2.2 AA and interface guidelines: \"revisa la accesibilidad\", \"audita la UI\", \"cumple WCAG\", \"problemas de foco o teclado\", \"revisa la UX\". Reports file:line findings first. Not redesign (ui-refine)."
---

# UI Audit

> **Precondition.** Tool of `dept-ux-ui` (supporting: `dept-qa`, which runs it in the Definition of Done of significant UI changes). If that department skill is not loaded in this conversation, load it first and use its brief (what, why, where, how) as the input of this skill. Skip only for L0 edits.

## Approach
An audit produces evidence, not opinions. Every finding names a rule, a location and a fix; a concern that maps to no rule is a note for `ui-refine`, not a finding.
- **Local, versioned rules.** The rule set lives in `rules/` (no network fetch) and grows from real audits.
- **Report before touching.** `audit` never edits. Only findings the user approved are fixed.
- **Severity decides order.** Critical and serious first; twenty minor findings must not hide one blocker.
- **A search hit is a candidate, not a finding.** Confirm each hit in context: component libraries often supply roles, labels and focus handling that a pattern cannot see.
- **Name the limits.** Static review cannot prove computed contrast, focus order or screen-reader output; list what was not verified.
- Questions before acting: which files or diff? Which template and styling syntax? Which component library and what does it handle? Which themes? Which UI language?

## Inputs
| Input | Source |
|---|---|
| Brief | the `dept-ux-ui` (or `dept-qa`) brief |
| Scope | files or globs given; else the diff (`git diff --name-only HEAD` plus untracked) filtered to templates, components and styles |
| Stack conventions | `../waymark/stacks/<stack>.md` → *Frontend* (template syntax, component library) |
| Project context | `<project>/.waymark/memory.md` → `## UI audit log`, `## Design system` (token pairs for contrast), UI language |
| Rules | `rules/README.md` (index, check syntax) + the category files it lists |
| Known patterns | `patterns/` of `ui-build` / `ui-system` (expected a11y of known widgets) + project skills |

## Severity
| Severity | Meaning | Gate |
|---|---|---|
| critical | blocks a task for some users: WCAG A failure, keyboard trap, unlabeled control in a key flow | fix before done |
| serious | WCAG AA failure or major friction | fix before done, or the user accepts it with a reason |
| moderate | best-practice gap that degrades the experience | schedule |
| minor | polish and consistency | optional |

Each rule has a default severity. Raise it one level when the issue sits on a primary flow (sign-in, checkout, send, save); lower it only with a stated reason.

## Growing the rule set
- A confirmed finding that matches no rule → **novelty check**: grep `rules/` for the concept, its keywords and its WCAG criterion. Covered → reuse that id and, if its pattern missed the case, refine the Check. Not covered → append a rule to the right category file with the next free id and `Added: <YYYY-MM-DD> · source: <project>`; update the count in `rules/README.md`.
- A recurring false positive → tighten that rule's Check and note why.
- Never renumber. Retire a rule with `Retired: <date> — <reason>` so old reports stay readable.
- A category file beyond ~15 rules → split it and update the index.

## Output contract
Always return: scope (file count), categories applied, findings table with totals by severity, the not-verified list, files changed (fix mode only), check re-run results, audit log updated (yes/no), rules added or refined, and hand-offs: `ui-system` for system-level token or contrast fixes, `ui-refine` for non-rule UX critique, `dept-frontend` for structural changes, `dept-qa` for automated accessibility tests.

## Pattern library (grows with use)
- Before building, list `patterns/` and read the matching file, if any. In this skill the reusable knowledge is the rule set in `rules/`; widget patterns (dialog, combobox, tabs) live in `ui-build` and are the reference for what a correct widget looks like.
- After building something reusable that has no pattern yet (a modal, a data table, a stepper…), write `patterns/<pattern>.md` from `../waymark/templates/pattern.template.md`: stack-agnostic intent, anatomy, states, a11y, pitfalls, and one short adapter per stack it was built in. Project-specific details go to project memory, not here.
- Update an existing pattern only with new, verified information (novelty check, waymark `references/learning.md`).

## Modes
Read **only** the mode the task needs (one file); never load all modes.

- **audit** — "audita la UI", "revisa la accesibilidad", "cumple WCAG", "revisa el formulario", before a PR with UI changes, `dept-qa` Definition of Done. → `modes/audit.md`
- **fix** — the user approved findings by number, rule id or severity. → `modes/fix.md`
- **regression** — after a fix round, before a release, "verifica que sigan corregidos". → `modes/regression.md`

## Stack adapters
Stack-specific notes → `references/stack-adapters.md` (read only the project's stack row).

## Learned notes
_Grows with use (waymark `references/learning.md`). Dated, non-obvious notes about using this tool. When there are more than ~10, fold them into the body above and clear this list._
