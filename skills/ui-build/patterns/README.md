# ui-build pattern library

Reusable, stack-agnostic UI patterns learned while building new interface with `ui-build`. The folder starts empty and grows with use.

## What belongs here
- One file per pattern, named `<pattern>.md` in kebab-case (`confirm-dialog.md`, `data-table.md`, `multi-step-form.md`).
- Generic knowledge only: intent, anatomy, states, accessibility, pitfalls, and a short adapter per stack where the pattern was actually built.
- Project-specific details (paths, product copy, a project's token names) go to `<project>/.waymark/memory.md` or a project skill, not here.

## How it is used
1. Before building, list this folder and read the file that matches the request, if any.
2. After building something reusable with no pattern yet, create it from `../../waymark/templates/pattern.template.md`.
3. Edit an existing pattern only with new, verified information (novelty check, waymark `references/learning.md`). Add a stack adapter when the pattern is built in a new stack; update `Seen in`.

## Index
_No patterns yet._
