<!-- waymark:begin -->
<!-- Managed by the Waymark installer (INSTALL.md). Edit outside this block; this block is replaced on update. -->
# Rule 0 — Waymark on every request

Every request. Only L0 skips it (a color, a text, a typo or one value the user named exactly); "quick fix" is L1. Write everything in the user's language.

**First text of the turn:** `Waymark → L<n> or Q · dept-<owner> · skills: <only skills you will invoke>` (e.g. `Waymark → L1 · dept-frontend · skills: dept-frontend`); then that `dept-*` skill as your first tool call. The hook takes the owner from that call and the level from the files you change (the line is the floor). A Q that turns into a change → invoke the owner `dept-*` skill with args `L<n>`. Q: read-only, grounded in `file:line` or docs, no Cierre.
**Before the first change** (for you, not checked):
```
Pedido: <the ask in one line> · Captura: <what each image shows + the element it points to | sin captura> [· Copia: <only what was named from X>] [· Capa: <layer the user set>] [· Cambia: <behavior not asked to change> → ask first]
Reutiliza: <piece + path from Project map → Reusables | ninguno → patrón de <file>>
```
Two readings that change the result → one question first. A layer the user named, evidence pointing elsewhere → ask before leaving it.
**The user decides, never you.** First the owner's `procedures.md` section, `waymark.mjs pack <files>`, `git status --short` of each repo; then one choice-window call: the approach with its optimal options (files, risk, cost; recommended marked) and every decision that shapes the work you can foresee. One real way, or the user already chose → confirm it there. Later questions only confirm; a new work decision is asked before applying it. The branch is the user's, never a decision. A user rule exists only where it is written (their message, memory.md, preferences.md): cite it; none → ask. Never offer or run browser verification unless the user asks.
**Close every change with** (task ID from the per-prompt hook):
```
## Cierre · <YYYY-MM-DD · T<n>[a-z]>
Resultado: hecho | parcial (<what is missing>) | bloqueado (<why>)
Evidencia: observada <what you saw> | inferida de <source> (check: <one line for the user>)
Aprendido: <decision ← evidence, and the next step; ≤200 characters; L3: the plan's steps ✔1 · ▶2 · 3>
[Tests | Review: omitido (usuario: "<their words>") — this task only]
```
The end-of-turn hook executes, never reads prose, and blocks once, naming the way out, per testigo of `waymark/routine.json` that applies: the user answered in the choice window before the task's first change; a gate after the last code change passes (yours, or the repo typecheck the hook re-runs); the Cierre complete (Resultado · Evidencia · Aprendido); no secret in the project memory, mem_save or the task's diff and commits; the owner's procedures.md section read before the first change; the project memory searched (waymark.mjs pack) before the first change; L2+ with code: code-review (or waymark.mjs review <files>) on the task's files; L2+ with code: the build once at the end (not when memory.md's Quality gates has `build | none (<why>)`); a spec next to the changed code added or changed; L2+ with a spec and code changed: the spec ran before the code it tests, or in a clean worktree; a failing gate that is not this task's shown failing in a clean copy; a command that failed twice runs again only after consulting the docs. The Cierre is the one part read as text: the heading and its three fields. Recorded, not blocked: commits carry the trailer `Waymark-Task: <task ID>` in the message's last paragraph, next to Co-Authored-By.
- **Memory** — the session card; obey its *Environment*. Before your first change to a file: `waymark.mjs pack <files>`; more: `waymark.mjs memory <section>`, `tasks`. Memory points, code decides: disagrees → fix the entry. Project memory: `<project>/.waymark/memory.md`; any agent reads `.waymark/tasks.md` first. Missing → create it (`waymark/references/project-detection.md` → *Minimal bootstrap*). Never edit *Work in progress* (the hook writes it). Fixed bug → *Solved problems*.
- **Evidencia** — observe the real state before changing; code read is not observed. Cannot observe → *inferida* with the user's check, given before the fix.
- **Gates** — while working, lint and test only the touched files; at the end, per repo, the full typecheck and (L2+) the build once, after the last change. 2nd failed attempt → *When stuck* (`waymark/references/protocol.md`).
- **Docs** — unverified library API, or retrying a failed attempt → `library-docs` or the installed package source, cited. Missing skill → `waymark/references/skills.md`.
- **Comments** say how the code works, never task history (IDs, dates, who chose it).
- **Coexistence** — obey the injected `~/.waymark/coexistence.md`; never edit the other framework's files.

Independent tool calls in one response. Confirmations (plans, updates, destructive steps): your choice window (Claude Code: `AskUserQuestion`).

## Index

UI code: component, screen, modal, form, styles, visual bug → `dept-frontend` · look & feel, accessibility, motion, tokens → `dept-ux-ui` · API, service, job, webhook, realtime → `dept-backend` · schema, migration, query, cache, state → `dept-data` · auth, permissions, secrets, vulnerabilities → `dept-security` · tests, review, bug with no clear layer → `dept-qa` · build, CI, git, deploy → `dept-devops` · structure, refactor, patterns, new module → `dept-architecture` · idea → scope, criteria, plan → `dept-product` · skills, agent config, docs, Waymark → `dept-devex` · unsure / new project → `waymark`

**L1** 1–2 known files · **L2** feature or >2 files → + `waymark/references/protocol.md` · **L3** refactor/migration/new project → + `dept-architecture`, plan first, ADR. Use only the skills and MCP servers this user has; never invent names. `waymark/…` = `<skills-dir>/waymark/`. A project `CLAUDE.md` / `AGENTS.md` wins for that project.

## General rules

Code and commits in the project's language. Package manager and versions: the "Repo (read now)" line, never memory. Preserve current behavior (visuals, focus, motion, responsive, public APIs). Smallest change; extras are proposed, not implemented; removing code you did not write needs a yes; no new abstractions or library swaps unless asked; check consumers of shared code. Locate the exact target first. Ask before destructive or outward-facing actions.
<!-- waymark:end -->
