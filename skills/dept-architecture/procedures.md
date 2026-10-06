# dept-architecture · Procedures

Loaded on demand from `SKILL.md` → *Procedures*. Read only the section the task needs.

### Identify the architecture (always first)
1. Read project memory → architecture. If present, load `../waymark/architectures/<slug>.md`. Available: `screaming`, `hexagonal`, `clean`, `layered`, `feature-sliced`, `modular-monolith`.
2. If absent, detect it with the folder signals of `waymark` `../waymark/references/project-detection.md` and each profile's *Detect* line.
3. Signals mixed or absent → state the best match and its confidence in the brief; ask the user before an L3 change and record the answer in project memory.
4. Search the learned memory (`engram search "<words>"` or mem_search) for prior architecture decisions on this project.

### Place new code (L1/L2)
1. Apply the decision list in the architecture profile → *Placement rules*.
2. Default scope rule: used by one module → stays inside it; used by two or more → promoted to the shared layer; cross-cutting infrastructure → the core/infrastructure layer.
3. Check the import direction against *Dependency rules* before writing the import.
4. Name folders and files after the domain concept, not the technical type, unless the profile says otherwise.
5. Follow the stack's naming and file conventions (stack profile → *Conventions by department*).

### Refactor (L2/L3)
1. Write down current behavior and public API; they are invariants.
2. Ensure tests cover the invariants; if not, add characterization tests first (hand-off to `dept-qa`).
3. Refactor in small steps, each leaving gates green. Separate behavior-preserving commits from behavior changes.
4. Run `simplify` on the result.

### Migration, new module or new project (L3)
1. Produce a staged plan with the `Plan` agent (plan mode if the user must approve).
2. New project: choose the architecture with the user from the available profiles, record it in project memory.
3. Define the module's public contract (exported interface, events, DTOs) before its internals.
4. Prefer strangler-style incremental migration over big-bang rewrites; keep old and new paths working until cut-over.
5. Verify framework/library migration steps with `library-docs`; use the framework CLI MCP when the stack has one.
6. Write an ADR (below) and put the decision in the Cierre's Aprendido (the end-of-turn hook saves it to engram).

### Review for conformance
1. Run every item in the architecture profile → *Conformance checklist* (Grep patterns where given).
2. Report each item as ✔/✘ with file:line for failures.
3. Fix violations using *Common violations → fix* in the profile.

### Architecture Decision Record (L3)
1. Location: `docs/adr/NNNN-<kebab-title>.md` (or the project's ADR folder), numbered sequentially.
2. Sections: **Title** · **Status** (proposed / accepted / superseded by NNNN) · **Context** (forces, constraints, current state) · **Decision** (one paragraph, active voice) · **Alternatives considered** (at least two, with why rejected) · **Consequences** (positive, negative, follow-up work).
3. Keep it under one page. Never edit an accepted ADR; supersede it.
4. Link the ADR in the closing report.

## Anti-patterns
- Cross-module deep imports that bypass the public contract.
- Generic `utils`/`helpers` dumping grounds in the core layer.
- Promoting code to shared when only one module uses it.
- Interfaces with a single implementation and no boundary reason.
- Big-bang rewrites instead of incremental migration.
- Mixing a refactor and a behavior change in the same step.
- Designing against a framework API from memory without `library-docs`.
- God services that orchestrate, render and fetch at once.

## References
- ISO/IEC/IEEE 42010:2022 — Architecture description: https://www.iso.org/standard/74393.html
- SWEBOK v4 — Software Design: https://www.computer.org/education/bodies-of-knowledge/software-engineering
- Michael Nygard, "Documenting Architecture Decisions": https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions
- ADR templates: https://adr.github.io
- The Twelve-Factor App: https://12factor.net
- Martin Fowler, Strangler Fig Application: https://martinfowler.com/bliki/StranglerFigApplication.html
