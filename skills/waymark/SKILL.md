---
name: waymark
description: "Waymark core. Use when unsure which department owns a task (\"qué departamento aplica\", \"usa waymark\"), for a new project or the first time in one (\"arranca el proyecto\"), a missing skill (\"no hay skill para esto\"), recording learnings or syncing the skill registry. Not for trivial edits."
---

# Waymark — core

Waymark is a set of **departments**. Every task above L0 passes through the department that owns it before any tool skill is used. The department answers *what, why, for whom, where and how*, then decides which skills and MCP servers to call. Nothing is enforced by hooks: the trigger is each skill's description plus the instructions block in the agent's instructions file.

**Loading is layered to save tokens.** The instructions file (always in context) holds routing and the compact protocol. A task loads one department `SKILL.md`; that department reads one section of its `procedures.md`; the files below are read only in the situations listed. Never load a layer "just in case".

Paths are relative to this skill's folder. `~/.waymark/` is the user's private layer (same for every agent). `<skills-dir>` / `<project-skills-dir>` are the agent's skill folders, recorded in `~/.waymark/agent.md`.

## 1. Triage

| Level | Name | Examples | Mandatory |
|---|---|---|---|
| L0 | Trivial | a color, a text, a typo, one CSS value | Nothing. Do it directly. No department. |
| Q | Question | explain, where is, how does | Consult mode (`references/consult.md`): route to the topic department, read-only, cite `file:line` or docs. |
| L1 | Localized | bug in one known file, small addition in 1–2 files | Compact Entry · department Rules + Tools · one procedure section · gates without build |
| L2 | Feature | new screen, endpoint, component tree, integration, bug touching >2 files | Full Entry (`references/protocol.md`) · department skills · Exit with build + review |
| L3 | Architectural | refactor, migration, new module, cross-cutting change, new project | L2 + `dept-architecture` + plan before coding + ADR |

Escalate as soon as the scope grows. Never de-escalate to skip rules.

## 2. Departments

| Skill | Owns | Typical requests |
|---|---|---|
| `dept-product` | requirements, scope, acceptance criteria, breakdown | "quiero un feature de…", user stories, plan |
| `dept-architecture` | structure, layers, boundaries, patterns, ADRs | refactor, new module, "dónde va esto" |
| `dept-frontend` | UI code in any framework: components, screens, state, rendering | modal, pantalla, formulario, componente, SSR |
| `dept-ux-ui` | visual design, accessibility, motion, design system | animación, accesibilidad, jerarquía visual, tokens |
| `dept-backend` | APIs, services, jobs, realtime, integrations | endpoint, webhook, job, canal, servicio |
| `dept-data` | schema, migrations, queries, caching, client state | migración, tabla, consulta, cache, store |
| `dept-security` | authn/authz, secrets, OWASP, dependencies | login, permisos, roles, CORS, vulnerabilidad |
| `dept-qa` | tests, verification, review, Definition of Done | test, bug, regresión, cobertura |
| `dept-devops` | build, CI/CD, git, environments, deploy | deploy, pipeline, rama, PR, build |
| `dept-devex` | agent tooling, Waymark, docs | skill, MCP, CLAUDE.md, documentación |

One **owner** department plus 1–2 supporting ones (e.g. "crear un modal de contactos" → owner `dept-frontend`, support `dept-ux-ui`, `dept-qa`). Load the owner skill; read only the *Quick ref* of supporting ones.

## 3. Read on demand

| Situation | Read |
|---|---|
| L2+ task, or the compact protocol is not enough | `references/protocol.md` (full Entry, brief example, Exit, closing report) |
| a question (Q) | `references/consult.md` |
| first time in a project, new project, or memory without *Project map* | `references/project-detection.md` |
| end of an L1+ task with something new learned | `references/learning.md` |
| a needed skill is missing, or the user asks for a new skill | `references/skills.md` |
| an orchestrator or another agent framework is installed (install, update, `waymark.mjs check` says it appeared or is gone, the user changes the mode), or a department runs with no Waymark block in context (guest) | `references/coexistence.md` |
| sync, vendoring, new stack / architecture / department | `references/maintenance.md` |
| the session hook asks for a check, or the user asks for updates / maintenance | run `node scripts/waymark.mjs check` (read-only) from the project folder; offer each reported item with the choice window; `waymark.mjs sync \| mcp-fit \| skill-fit \| migrate \| connect \| install-hooks` after the yes |
| stack or architecture conventions | `stacks/<stack>.md`, `architectures/<arch>.md` — only the sections the level asks for |
| a provider's status or source | `skill-registry.md` — search the capability, do not read it whole |
| new private-layer file | `templates/private-layer/` |
