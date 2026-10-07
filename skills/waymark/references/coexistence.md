# Coexistence with orchestrators and other agent frameworks

Read when the installer (INSTALL §1.1), an update (§9) or the session hook finds another framework that also governs the agent: a marked block in the instructions file that is not Waymark's (e.g. `<!-- gentle-ai:persona -->`), hooks that do not run Waymark scripts, or skills/agents that orchestrate work (SDD flows, persona, delegation rules, its own skill registry).

**Waymark is not an orchestrator.** An orchestrator decides *who* does the work (sub-agents, phases, models). Waymark is the criteria and the memory the work is done with: departments (what, why, where, how), rules, project memory and learning. The user decides: the agent puts each real decision to them with the optimal options. So Waymark fits two shapes: it **leads** when the agent works alone, and it is a **guest** inside an orchestrator, giving its workers the departments and the memory. It never competes for control of the turn.

**Principle: Waymark adapts; the other framework is never edited.** Its blocks, hooks, skills, agents and registries stay byte-for-byte as they are. Uninstalling Waymark leaves it exactly as it was.

## 1. Who arrived first decides the mode

| Situation | Mode | Waymark installs |
|---|---|---|
| No other framework | — (no `coexistence.md`) | everything: block on top, both hooks, full Rule 0 |
| An orchestrator is **already installed** | `guest` (recommended) | skills + private layer; **no block, no hooks**; skills registered through the orchestrator's own registry (§4); memory through engram |
| Waymark was first; an orchestrator **arrives later** | `waymark-leads` (recommended) | stays as it is; the newcomer's rules are classified (§2) and its skills join Waymark's `skill-registry.md` as *Fallback* (`sync.mjs` already indexes third-party skills) |
| The user wants only the skills | `skills-only` | skills + private layer, nothing else |
| The orchestrator was uninstalled | back to no `coexistence.md` | block + hooks again (§5) |

The user can always pick another mode **[ask]**: a guest can lead if they prefer Waymark's routine, a leader can step down to guest if they prefer the orchestrator's flow.

## 2. Detect and classify (all modes)

For every agent being installed (`~/.waymark/agent.md` → `<instructions-file>`):
1. Instructions file: HTML-comment markers with a namespace other than `waymark` (`<!-- <name>:<section> -->`, `<!-- BEGIN <name> -->`) and sections that define a persona, an orchestrator, a memory protocol or triggers.
2. Agent settings: hooks whose command does not run `rule0-hook.mjs`, `session-hook.mjs`, `tool-hook.mjs` or `stop-hook.mjs`.
3. Skills, plugins and agents of the same framework; its **skill registry** and how it is refreshed (its docs; known ones in §4).

Read each section once and write its rules as one line each; never guess rules you did not read. Then ask per rule: **does it act at the same moment as a Waymark rule?** (first text of the turn, before the first edit, delegation, memory, language of code and commits, commits/PRs, closing a change).

| Class | Test | Goes to |
|---|---|---|
| **Adopted** | different moment, or same moment with an outcome Waymark accepts (a preference, a tool choice, a stricter check) | Waymark follows it as a user preference |
| **Fallback** | it names a skill, agent, workflow or tool that covers a capability | `capability → provider`, used when Waymark has none, or at *When stuck* |
| **Resolved** | same moment, incompatible outcome | who wins: Waymark in `waymark-leads`, the orchestrator in `guest` |

In `guest` the lists are short: almost every turn-level rule resolves to the orchestrator. What matters is that the departments and the memory reach its workers (§3).

## 3. Guest mode

- **No Waymark hook, no Rule 0 block.** Nothing asks for the opener or the Cierre; the orchestrator's format, phases and delegation rule the turn.
- **Departments are knowledge.** The orchestrator (or its sub-agents) loads a `dept-*` skill when the task matches its trigger, through its registry. Each department then runs its *Guest entry* (below) instead of the Rule 0 Entry.
- **Memory travels through engram** when the orchestrator uses it: Waymark saves project decisions, solved problems and gates with `topic_key` `waymark/<project-slug>/<topic>`, so the orchestrator's `mem_search` finds them. `<project>/.waymark/memory.md` stays the source and keeps filling itself.

**Guest entry** (what a department does when no Waymark block is in context):
1. Recall: read `<project>/.waymark/tasks.md` and `memory.md` if they exist (before migration: `~/.waymark/projects/<slug>.md`) (Work in progress, Solved problems, Quality gates) and `mem_search "waymark <slug>"` if engram is available. Missing memory → create it with the *Minimal bootstrap* (`project-detection.md`).
2. Apply the department's rules and the one `procedures.md` section the task needs; verify APIs with `library-docs` as usual.
3. Reply in the orchestrator's format; do not print the Waymark opener or Cierre.
4. After a change: update *Work in progress* / *Solved problems* in the project memory and `mem_save` the decision (topic key above).

## 4. Register through the orchestrator's registry (guest)

| Orchestrator | Scans | Refresh after copying the skills | Source |
|---|---|---|---|
| gentle-ai | project skill roots (`skills/`, `.claude/skills/`, `.opencode/skills/`, `.github/skills/`…) then global agent skill directories; writes `.atl/skill-registry.md` | `gentle-ai skill-registry refresh` | gentle-ai `docs/usage.md` |
| other | its docs: where it looks for skills and how it re-indexes | its refresh command; none → copying into the agent's `<skills-dir>` is enough | its docs |

Verify after refreshing that the registry lists `waymark` and the `dept-*` skills; report it. Never edit the orchestrator's registry by hand, `--vendor` its skills or patch them.

## 5. Write and keep `~/.waymark/coexistence.md`

From `templates/private-layer/coexistence.md`: `Mode`, `Frameworks` (name · markers · hooks · registry), then *Adopted*, *Fallback*, *Resolved*, one line each, ≤ ~1,800 characters (the session hook injects it in `waymark-leads`). Show the lists before writing **[ask]**; the user can move any rule.

- **Update (§9):** detect again; new rules or frameworks → classify only those and ask. In `guest`, re-run the orchestrator's refresh.
- **Session hook (leading modes only):** an unlisted framework → asks to offer the choice *keep leading* (`waymark-leads`) or *become guest*; a listed framework whose markers are gone → offers to return to the full install.
- **Switching modes:** to `guest` remove Waymark's block and hook entries (backup first, §3 of INSTALL) and refresh the orchestrator's registry; to a leading mode add them back (§6.2, §7.2).

## Worked example: gentle-ai

`waymark-leads` (Waymark was installed first):

```
Mode: waymark-leads
Frameworks: gentle-ai · markers gentle-ai:persona, engram-protocol, sdd-orchestrator, trigger-rules · registry .atl/skill-registry.md

## Adopted
- Commits: conventional commits, no AI attribution (overrides the agent's default attribution).
- Shell tools: rg/fd/bat/sd/eza when installed (Environment says which exist).
- One question per choice window; short answers; after asking, stop and wait.
- Never agree without verifying (same as Evidencia). Persona tone only in chat.
- engram: mem_save after decisions/bugfixes/findings; mem_session_summary before closing and after compaction.
- Delegation: ≥4 files to understand or ≥2 non-trivial files to write → subagent, with the department skill path in its prompt.

## Fallback
- review.diff (Cierre → Review) → review-readability; pre-PR on auth/update/security/payments or >400 lines → the 4 reviews in parallel.
- L3 plan → SDD (explore → propose → spec/design → tasks → apply → verify → archive), artifacts in engram.
- When stuck (2nd failed attempt) → judgment-day. Structural questions (Q) → CodeGraph first.

## Resolved
- First text of the turn → Waymark opener; persona applies to the rest of the reply.
- "The main agent coordinates and does not execute" → the main agent routes (opener, dept skill, Memoria, Cierre); execution is delegated by the Adopted thresholds.
- Language of code/UI/docs → the project's established language; no convention yet → neutral English.
- Pre-commit triggers + Cierre Review → one review; the trigger's result fills the Review field.
```

`guest` (gentle-ai was installed first):

```
Mode: guest
Frameworks: gentle-ai · markers gentle-ai:* · registry .atl/skill-registry.md (refreshed 2026-10-01, lists waymark + 10 dept-*)

## Adopted
- Everything in gentle-ai's persona, engram protocol and triggers.

## Resolved
- Turn flow, delegation, SDD phases, models and reviews → gentle-ai.
- Waymark → departments as knowledge (Guest entry) + project memory via engram (topic waymark/<slug>/…).
```
