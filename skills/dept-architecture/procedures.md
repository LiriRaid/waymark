# dept-architecture · Procedures

Loaded on demand from `SKILL.md` → *Procedures*. Read only the section the task needs.

### Identify the architecture (always first)
1. Read project memory → Architecture. A profile is a reference, never a rule: the repo's own structure wins. Run `node "<skills-dir>/waymark/scripts/waymark.mjs" convention` (read-only): it reports where components, modals, services and styles live, the commit that set the structure, and the project's docs. Its evidence is what `memory.md` → Architecture holds, marked "to confirm" until the user confirms it once.
2. If present and confirmed, load `../waymark/architectures/<slug>.md` for its *Variants* and read the line that matches the repo's convention. Available: `screaming`, `hexagonal`, `clean`, `layered`, `feature-sliced`, `modular-monolith`.
3. If absent, detect it with the folder signals of `waymark` `../waymark/references/project-detection.md` and each profile's *Detect* line.
4. Signals mixed or absent → state the best match and its confidence in the brief; ask the user before an L3 change and record the answer in project memory.
5. Search the learned memory (`engram search "<words>"` or mem_search) for prior architecture decisions on this project.

### Place new code (L1/L2)
1. Apply the decision list in the architecture profile → *Placement rules*, through the variant the repo follows.
2. Where the census shows where this kind of piece already lives, put the new one there. The scope rule (used by one module → inside it; two or more → the shared layer; infrastructure → the core layer) applies only when the repo shows no convention of its own, and is then written as "profile default".
3. Check the import direction against *Dependency rules* before writing the import.
4. Name folders and files after the domain concept, not the technical type, unless the profile says otherwise.
5. Follow the stack's naming and file conventions (stack profile → *Conventions by department*).

### Structural change (always L3; own window)
Moving files between layers, splitting or merging files, a new kind of folder.
1. Run `W convention` first. Never start from a profile's rule.
2. Ask it in its own choice window, apart from any other question and even when the user chose "recommended on everything" for the task. The window shows what moves (from where to where, how many files), the convention detected (where components, modals and services live and the commit that set it), and one line: "follows the convention" or "CONTRADICTS the project's convention". When it contradicts, the recommended option is not to move.
3. Never write into the project's own docs (ADR, AGENTS.md, README) a convention that contradicts its history without the user's explicit decision in that window.

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
- Moving code to a layer because a profile says so when the repo's own structure says otherwise.
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
