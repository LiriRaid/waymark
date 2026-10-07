# ui-refine pattern library

Reusable, stack-agnostic refinement recipes learned while improving existing interface with `ui-refine`. The folder starts empty and grows with use.

## What belongs here
- One file per pattern, named `<pattern>.md` in kebab-case. Two kinds:
  - **Component refinements**: how a common component should look and behave once refined (e.g. `data-table-density.md`).
  - **Refinement recipes**: a repeatable treatment from one mode (e.g. `staggered-list-entrance.md`, `skeleton-to-content.md`, `long-text-truncation.md`).
- Generic knowledge only: intent, anatomy, states, accessibility, pitfalls, and a short adapter per stack where it was actually applied. Note which mode produced it.
- Project-specific details (paths, token names, product copy) go to `<project>/.waymark/memory.md` or a project skill, not here.

## How it is used
1. Before refining, list this folder and read the file that matches the target or mode, if any.
2. After a reusable refinement with no pattern yet, create it from `../../waymark/templates/pattern.template.md`.
3. Edit an existing pattern only with new, verified information (novelty check, waymark `references/learning.md`). Add a stack adapter when applied in a new stack; update `Seen in`.

## Index
_No patterns yet._
