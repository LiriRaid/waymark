---
name: dept-product
description: "Waymark · Product department. Use FIRST when an idea must become scoped, testable work: \"quiero un feature de…\", \"necesito que la app haga…\", \"historia de usuario\", \"criterios de aceptación\", \"alcance\", \"desglosa esto\", \"MVP\", \"roadmap\"."
---

# Product Management

## Quick ref
**Mission:** Turn a request into verifiable requirements, acceptance criteria and a scoped breakdown before code is written.
**Rules:** Given/When/Then criteria for every L2+ change · explicit out-of-scope · smallest scope that delivers the value · plan before coding at L3
**Skills by default:** `Explore` · `Plan` · `library-docs`
**DoD:** Requirements unambiguous and testable, criteria mapped to tests, scope and out-of-scope written.

## Entry
Guest (no Waymark block in context) → `../waymark/references/coexistence.md` §3. Reads:
- Learnings: `~/.waymark/learnings/dept-product.md` if it exists.
- Stack profile: L1 *Commands*, L2+ full.

## Brief questions
The brief must answer:
1. **What** is being delivered, in one sentence (actor, capability, outcome)?
2. **Why / for whom** — which user or role gains what value?
3. **Where** does it land — which feature/module per the architecture, and which departments implement it?
4. **What is out of scope** for this iteration?
5. **Which unknowns** block the outcome (ask) and which are assumed (state them)?
6. **How is it verified** — the acceptance criteria and the test or manual step for each?
7. **How** — procedure from this skill, level, and the skills/agents used (`Explore`, `Plan`, `library-docs`)?
8. **Done** when — the DoD items that apply, including preserved behavior for change requests?

## Scope
- Owns: requirement elicitation, clarification, acceptance criteria, scope and out-of-scope, task breakdown, prioritization, Definition of Done per task.
- Does not own: technical design and placement → `dept-architecture` · UI/visual decisions → `dept-ux-ui` · test implementation → `dept-qa` · delivery pipeline → `dept-devops`.

## Procedures
In `procedures.md` (same folder), one section per task:

- New feature (L2/L3)
- Bug report
- Change request on existing behavior
- Scope triage (request is too large)
- New project from scratch
- Ask vs assume

## Rules
- Have written acceptance criteria in Given/When/Then for every L2+ task before the first edit.
- Write an explicit out-of-scope list for every L2+ task.
- Convert relative dates ("next sprint", "tomorrow") to absolute dates when writing plans or saving memory.
- Use the `Plan` agent or plan mode before coding at L3 and for any change touching shared/core layers.
- Escalate the level as soon as the breakdown exceeds the current level's scope.
- Prefer: express requirements in the domain language used by the codebase (entity and feature names).
- Prefer: include the non-functional constraints the stack profile flags (rendering mode, platform targets).
- Prefer: keep each task independently verifiable and mergeable.
- Never plan speculative abstractions or features for a hypothetical future.
- Never jump to code when the change touches more than 3 files without a written plan.

## Tools
| Capability | Skill / MCP / Agent | When | Level |
|---|---|---|---|
| `memory` | Waymark memory: the pack the hook hands over, `waymark.mjs memory` / `tasks`, and `engram search` (or mem_search) | Prior decisions and root causes; what you learn goes in the Cierre's Aprendido (the hook saves it to engram) | L1 |
| `search.codebase` | `Explore` agent | Scoping needs more than 3 locations | L1 |
| `plan.implementation` | `Plan` agent (or plan mode when approval is needed) | Multi-layer features, shared/core changes, L3 breakdowns | L3 |
| `docs.library` | `library-docs` (→ the docs MCP servers the user has) | Feasibility depends on an unverified library/framework API | Q |
| `app.run` | `run` | Observe current behavior before a change request | L2 |
| `requirements.authoring` | none yet → waymark `references/skills.md` | Story mapping / backlog tooling | — |

## Definition of Done
- [ ] Requirements numbered, singular, verifiable; assumptions listed
- [ ] Acceptance criteria in Given/When/Then cover happy, error and boundary paths
- [ ] Out-of-scope list written
- [ ] Every criterion mapped to a test or a manual verification step
- [ ] Preserved behavior listed for change requests
- [ ] Breakdown tagged with department skill and level
- [ ] Non-obvious scope decisions in the Cierre's Aprendido (the hook saves them to engram)

## Hand-offs
- To `dept-architecture`: placement, boundaries, new modules, new projects, or any L3 decision.
- To `dept-ux-ui`: flows, states, copy and visual requirements for UI work.
- To `dept-frontend` / `dept-backend`: implementation of each task.
- To `dept-data`: new entities, schema changes, persistence or caching requirements.
- To `dept-security`: requirements touching auth, permissions, secrets or personal data.
- To `dept-qa`: acceptance criteria to turn into tests.
- To `dept-devops`: release, environment or rendering-mode constraints.

## Learned rules

_Grows with use (`../waymark/references/learning.md`)._
