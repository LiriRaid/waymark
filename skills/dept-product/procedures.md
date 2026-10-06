# dept-product · Procedures

Loaded on demand from `SKILL.md` → *Procedures*. Read only the section the task needs.

### New feature (L2/L3)
1. Search the learned memory (`engram search` or mem_search) with the feature keywords; reuse prior decisions instead of re-deriving them.
2. Restate the request in one sentence: "As <actor> I want <capability> so that <outcome>".
3. List unknowns. For each, decide: ask the user (see *Ask vs assume*) or assume and record the assumption.
4. Write requirements that meet the 29148 quality attributes: necessary, unambiguous, singular, feasible, verifiable, bounded. One per line, numbered (R1, R2…).
5. Write acceptance criteria per requirement in Given/When/Then. Cover the happy path, at least one error path, and the empty/boundary case.
6. Write the non-functional constraints that apply: performance budget, accessibility (WCAG 2.2 AA for UI), security/privacy, i18n, offline/SSR behavior, supported platforms.
7. Write **Out of scope** explicitly; anything not listed in scope is out.
8. Verify feasibility against the stack: any library or framework API not verified this session → `library-docs`.
9. More than 3 locations to search → `Explore` to find existing code that already covers part of the requirement; prefer extending it.
10. Break down into tasks of one deliverable each, ordered by dependency. Tag each task with its department skill and level.
11. At L3, or when the change touches shared/core layers, hand the breakdown to the `Plan` agent; use plan mode when the user must approve before coding.
12. Map each acceptance criterion to a test (unit, integration or browser) and hand off to `dept-qa`.

### Bug report
1. Capture: expected behavior, actual behavior, reproduction steps, environment, frequency.
2. Write one acceptance criterion that fails today and must pass after the fix (it becomes the regression test).
3. Classify level: one known file → L1; more than 2 files or unknown cause → L2.
4. Hand off root-cause analysis to the owning engineering department.

### Change request on existing behavior
1. Describe current behavior precisely (read the code or launch the app with `run`) before describing the new one.
2. List every consumer affected (screens, endpoints, public APIs, stored data).
3. State whether the change is backward compatible; if not, require a migration or deprecation note.
4. Write criteria for both the new behavior and the preserved behavior.

### Scope triage (request is too large)
1. Split into a minimal vertical slice that delivers value end-to-end, then increments.
2. Propose the slice to the user with what is deferred and why.
3. Do not start increments until the slice is done.

### New project from scratch
1. Run *New feature* for the MVP slice only.
2. Hand off to `dept-architecture` to choose the architecture and write the ADR, then to the owner department.

### Ask vs assume
- **Ask** when the answer changes data shape, public API, security/privacy, cost, irreversible actions, or user-visible behavior with more than one reasonable interpretation.
- **Assume** (and state it in the brief and closing report) when the choice is reversible, local, and follows an existing project convention.
- Batch questions: ask all blocking questions in one message, each with a recommended default.
- Never ask what the codebase, project memory or engram already answers.

## Anti-patterns
- Starting implementation of a creative or open-ended request without a plan.
- Criteria like "works correctly" or "looks good" that cannot be tested.
- Gold-plating: options, settings or abstractions nobody asked for.
- Asking questions the code or project memory already answers.
- Asking one question per message instead of batching.
- Silent assumptions that only surface in the closing report.
- One giant task instead of a sequenced breakdown.

## References
- ISO/IEC/IEEE 29148:2018 — Requirements engineering: https://www.iso.org/standard/72089.html
- SWEBOK v4 — Software Requirements: https://www.computer.org/education/bodies-of-knowledge/software-engineering
- Gherkin reference (Given/When/Then): https://cucumber.io/docs/gherkin/reference/
- INVEST criteria for user stories (Bill Wake)
- PMI Disciplined Agile: https://www.pmi.org/disciplined-agile
