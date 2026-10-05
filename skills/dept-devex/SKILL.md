---
name: dept-devex
description: "Waymark · Developer Experience department. Use FIRST for agent tooling and Waymark itself: \"crea una skill\", \"agrega un MCP\", \"CLAUDE.md\", \"settings de Claude\", \"actualiza el registro de skills\", \"agrega un stack al Waymark\", README, docs, memory, agents."
---

# Developer Experience & Documentation

## Quick ref
**Mission:** Maintain the skills-based Waymark and its tooling so every session triggers the right department and tools with minimal context.
**Rules:** tool names live only in `skill-map.json` (registry is generated) · run `sync.mjs` after any skill/MCP change · install skills only with an explicit yes · new stacks/architectures/departments/project skills start from `templates/` · ask before writing to `~/.claude` or a repository from a project task
**Skills by default:** `skill-creator` · `update-config` · `init` · agent `claude-code-guide` · `library-docs` · MCP `engram`
**DoD:** templates followed, sizes within limits, registry regenerated, trigger descriptions concrete, no contradictory instructions.

## Entry
Run Rule 0 (the instructions block, already in context; do not load the `waymark` skill for it). No Waymark block in context (guest) → *Guest entry*, `../waymark/references/coexistence.md` §3. Department-specific reads:
- Learnings: `~/.waymark/learnings/dept-devex.md` if it exists.
- When the task is Waymark itself, the "project" is Waymark source repository (or `<skills-dir>/waymark/`).
- Tools: the **Tools** table below. Open `../waymark/skill-registry.md` only if a capability there has no installed provider.

## Brief questions
1. **What** is changing: a skill, a department, the registry, an MCP, settings, CLAUDE.md, docs, memory?
2. **Why / for whom**: which recurring friction or missing capability does it fix, for this user or for one project?
3. **Where** does it live: core (`skills/waymark`), a department (`skills/dept-*`), the private layer (`~/.waymark/`), a project (`<project>/<project-skills-dir>/`) or global settings?
4. **How** will it trigger — which exact user phrases, in which language?
5. Does it need a **new dependency** (skill, MCP server) and did the user approve it?
6. Does it **contradict** anything in CLAUDE.md, the core protocol or another department?
7. **What does done look like**: sync clean, skill listed, trigger tested with a real phrase?

## Scope
- Owns: the waymark plugin (core, departments, `skill-map.json`, sync, stacks, architectures, templates), project skills, the private layer, CLAUDE.md, Claude Code settings, MCP availability, memory, documentation structure.
- Does not own: product code conventions → `dept-frontend`, `dept-backend` · CI pipelines → `dept-devops` · secret policy → `dept-security` · architecture content decisions → `dept-architecture`.

## Procedures
Detailed steps live in `procedures.md` (same folder). **Read only the section you need**: search its heading, read that block, not the whole file. Anti-patterns and references are at the end of that file.

- Layout of Waymark
- Write a trigger description (any skill)
- Registry: skill-map.json + sync
- Install a missing skill or MCP
- Generate a project skill
- Private layer maintenance
- Add a stack, architecture or department
- CLAUDE.md hygiene
- Settings, MCP and memory
- Documentation (Diátaxis)

## Rules
- Keep `skill-map.json` the single source of tool names and regenerate the registry with sync.
- Start every new profile, department or project skill from `templates/`.
- Install skills or MCP servers only after an explicit yes.
- Ask before modifying the agent config folder or a repository from within a project task.
- Keep the `waymark` core skill as the single protocol; others reference it, never redefine levels.
- Prefer: keep department `SKILL.md` ≤ ~8,000 characters (procedures in `procedures.md`), tool skills ≤ ~11,000, and the instructions block ≤ ~6,500 (it quotes every testigo that blocks).
- Never write contradictory instructions across CLAUDE.md, the core skill and departments.
- Never put stack-specific commands in department skills; they belong in `stacks/`.

## Tools
| Capability | Skill / MCP / Agent | When | Level |
|---|---|---|---|
| skills.author | `skill-creator` | Create or improve a skill, including project skills | L1 |
| config.claude | `update-config` | settings.json, permissions, env vars, MCP config | L1 |
| docs.project | `init` | Create a project CLAUDE.md | L1 |
| claude.docs | `claude-code-guide` agent | Skills, plugins, MCP, settings or SDK behavior not verified this session | Q |
| claude.api | `claude-api` | Tooling that calls the Claude API | L1 |
| docs.library | `library-docs` (→ the docs MCP servers the user has) | Docs for tooling libraries (script runners, doc generators) | Q |
| memory | MCP `engram` | Session context, decisions, root causes | L1 |
| search.codebase | `Explore` agent | Auditing names or contradictions across files | L1 |
| skills.discovery | none yet → waymark `references/skills.md` | Finding new skills (`npx skills find`) | L1 |

## Definition of Done
- [ ] Changed files follow their template's section order and size limits
- [ ] `sync.mjs` run; no unreviewed `auto: true` or `Unassigned` entries left
- [ ] Every referenced name exists in the registry or session listing
- [ ] Trigger descriptions tested with a real phrase
- [ ] No contradictions between CLAUDE.md, core skill and departments
- [ ] Docs classified by Diátaxis type

## Hand-offs
- To `dept-architecture`: a new architecture profile needs design decisions.
- To `dept-qa`: gate definitions or the Definition of Done change.
- To `dept-devops`: tooling that must also run in CI.
- To `dept-security`: settings or MCP touching permissions, secrets or network.
- To `dept-product`: Waymark roadmap or scope.
- To any `dept-*`: its content needs domain review.

## Learned rules

_Grows with use (waymark `references/learning.md`). Only rules that are general for this department and not already stated above. Format: `- [YYYY-MM-DD] <rule> — <why> (source: <project>)`._
