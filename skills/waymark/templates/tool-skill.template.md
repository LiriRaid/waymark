---
name: <capability-name>
description: "Waymark tool (<capability>), owner <dept-department>. <What it does>: <concrete phrases, user's language + English>. Not for <what it is not for> (<the right skill>). (≤ ~300 characters)"
---

# <Tool name>

> **Precondition.** Tool of `<dept-department>`. If that department skill is not loaded in this conversation, load it first and use its brief (what, why, where, how) as the input of this skill. Skip only for L0 edits.

## Approach
The thinking model of this tool in 5–10 lines: what it optimizes for, the questions it asks before acting, the principles it never trades away.

## Inputs
| Input | Source |
|---|---|
| Brief | the department brief |
| Stack conventions | `../waymark/stacks/<stack>.md` → section relevant to this tool |
| Project context | `<project>/.waymark/memory.md` → relevant sections |
| Known patterns | `patterns/` in this skill (generic) + project skills (project-specific) |

## Modes
Read **only** the mode the task needs (one file); never load all modes.

- **<mode>** — when <situation / phrases> → `modes/<mode>.md` (each file: When · Steps · Output)

## Stack adapters
Stack-specific notes → `references/stack-adapters.md` (read only the project's stack row).

## Output contract
What this skill always returns to the department (files changed, decisions, checks run, open risks).

## Pattern library (grows with use)
- Before building, list `patterns/` and read the matching file, if any.
- After building something reusable that has no pattern yet (a modal, a data table, a stepper…), write `patterns/<pattern>.md` from `../waymark/templates/pattern.template.md`: stack-agnostic intent, anatomy, states, a11y, pitfalls, and one short adapter per stack it was built in. Project-specific details go to project memory, not here.
- Update an existing pattern only with new, verified information (novelty check, waymark `references/learning.md`).

## Learned notes
_Grows with use (waymark `references/learning.md`). Dated, non-obvious notes about using this tool. When there are more than ~10, fold them into the body above and clear this list._
