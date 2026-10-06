# Waymark

**A supply chain for your coding agent's work.** Every change goes through defined stages: the department that owns it, **your** decision among the optimal options, evidence, gates and review. It comes out with a verifiable record: what it was built with, who decided what and when, what was proven, which commit it produced.

For Claude Code, Codex, Cursor, Gemini CLI, OpenCode and any agent that reads [Agent Skills](https://agentskills.io) (`SKILL.md`).

A *waymark* is the sign that marks a trail: it shows the way, and you choose the path. Agents often reach the right answer only after many attempts: they guess APIs, edit the wrong element, rebuild what the project already has, forget yesterday's fix and take decisions you would not have taken. Waymark shortens that path. At every real decision the agent lays out the optimal options with their files, risk and cost and marks the one it recommends; **you decide**, because the recommended one may not be what you need.

It is not an orchestrator and it spawns no agent pipelines. It is a set of skills that makes the agent work like a software company. Every non-trivial task goes through the **department** that owns it. The department decides:

- **what** gets built, **why** and for whom;
- **where** it lives in the architecture;
- **how** it is done, and **which skills and MCP servers** to use.

The task then closes with a Definition of Done (typecheck, lint, tests, build, architecture conformance). Finally the agent **learns** from the result.

Stack- and language-agnostic: department rules are generic. Stack and architecture specifics live in profiles.

## A supply chain of the agent's work

A software supply chain tracks how an artifact was built: its inputs, the steps it went through and who approved them, with records that cannot be altered unnoticed. Waymark applies that to the agent's work. The hooks build the record locally from what the session transcript proves, not from what the agent says, and cost 0 model tokens.

| Link | What Waymark records | How it is verified |
|---|---|---|
| **Inputs** | your request in your words; the project memory; a manifest per task: Waymark and agent version, model, MCP servers used, hashes of the instruction files | read from the transcript and the files at the end of the turn |
| **Department** | the department that owns the task (frontend, backend, data, security, QA, devops, architecture, UX/UI, product, devex): its procedure, rules, tools and Definition of Done | the owner named in the routing line must have been invoked, and its procedure read before the first change; the record keeps declared vs invoked. A question that turns into a change is re-routed, or it is stopped |
| **Decision** | the options put to you, the one you picked and the ones you discarded, on a dated task ID (`2026-10-02 · T3`), each answer with its position (before or after the first change) | your answer in the choice window, recorded as is: no file changes, by edit or by shell, until you were asked; the agent never restates it |
| **Evidence** | what was observed vs inferred, and the check you were given before the fix | written by the agent (the Cierre is the one part read as text); the hook judges actions: a failing gate needs a clean-copy check, a command failing twice needs a docs call before the next run |
| **Gates and review** | lint, typecheck, tests, build, code review (a browser check only when the user asks), memory and procedure used, with the time each gate took and whether it failed | **computed by the hooks** from the tool calls, never declared by the agent (the platform generates the provenance, as in SLSA). What blocks and what is only scored is one contract, [`skills/waymark/routine.json`](skills/waymark/routine.json), that you can change: by default the project memory searched (`waymark.mjs pack`) before the first change, a gate after the last change and, at L2+ with code, code-review (or `waymark.mjs review` in agents without it) and the build at the end. Everything is scored in an automatic evaluation of each task (✔/✘ per step, tokens, estimated quota), shown to you in one line |
| **Output** | the files changed and the commits | the files git saw change between your message and the end of the turn, whatever tool changed them; each commit carries `Waymark-Task: <task ID>` and the record keeps its hash |
| **Record** | one line per task in `<project>/.waymark/provenance.jsonl` (with a commit: the whole record as a git note on it, `refs/notes/waymark`), and `tasks.md` next to it: in progress, pending, next step, done | each line holds the hash of the previous one (and of its note): editing or deleting a past task breaks the chain. The folder is local (kept out of git through the project's `.gitignore`) and plain Markdown/JSONL, so any agent (Codex, Cursor, a new session) resumes from it |

What it is not: an SBOM or a dependency audit. Dependencies are `dept-security`'s job; this chain covers the work the agent does on your code. Decisions: [`docs/adr/`](docs/adr).

## Install

Tell your agent:

> **Install Waymark from https://github.com/LiriRaid/waymark following its INSTALL.md**
>
> *(en español: "Instálame Waymark desde https://github.com/LiriRaid/waymark siguiendo su INSTALL.md")*

There is no installer script. [`INSTALL.md`](INSTALL.md) is written **for the agent**, and the agent runs it step by step:

1. Detects which agent it is and where that agent keeps skills and instructions ([`adapters/`](adapters)).
2. Clones the repo and backs up anything already installed.
3. Offers to remove the third-party skills this one replaces.
4. Copies the skills and creates your private layer `~/.waymark/`.
5. Writes a managed block of general working rules into each agent's instructions file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`…). The rest of that file stays as it is.
6. Registers Waymark's hooks in each agent: settings for Claude Code, Codex and Gemini CLI, a plugin for OpenCode.
7. Sets up engram, the learned memory every agent shares (installs it after your yes if it is missing), proposes MCP servers (`context7`; stack-specific ones only for stacks you use) and runs `sync.mjs`.
8. Lists every file it created or modified, asks you to restart, and gives you a smoke test.

It can configure every agent on the machine in one run (Claude Code, Codex, OpenCode, Gemini CLI, Cursor…); all of them share the same memory, so you can **start a task in one agent and continue it in another**: `.waymark/tasks.md` and the git notes say where the work stands, and engram what each task learned.

When a new version is published, `waymark.mjs check` reports it (the session hook asks the agent to run it once a week) and the agent asks whether to update. **Update** without reinstalling: *"actualiza Waymark desde https://github.com/LiriRaid/waymark siguiendo su INSTALL.md"*. The agent compares `VERSION`, shows the [CHANGELOG](CHANGELOG.md), keeps what your skills learned and replaces the rest. The same sentence with "uninstall" removes it. Node.js 18+ is needed only for `sync.mjs`.

## Built to save tokens

Nothing is preloaded "just in case". Loading is layered:

| Layer | Loaded | Size |
|---|---|---|
| Instructions block in `CLAUDE.md` / `AGENTS.md` | always | ~6.5 k chars (~1.6 k tokens): levels, routing, the testigos, memory |
| Reminder (hook) | every prompt | ~70 tokens (~10 once the last reply followed the routine): the task ID, the repo's stack and a one-line git status |
| Department `dept-*/SKILL.md` | once per session per department | ~5–7 k chars: rules, brief questions, tools to use, DoD |
| Department `procedures.md` | only the section the task needs | one procedure |
| Core `waymark/references/*`, stack and architecture profiles | only in the situations they list (first time in a project, L2+, learning, missing skill) | on demand |
| Session memory digest (hook) | once per session | this machine's environment and the project's work in progress, its latest learned memories (engram) and gates, injected automatically (~600 tokens) |
| Project memory + *Project map* | every task | replaces re-exploring the project each session |

A small L1 task loads the block plus one department and one procedure. Memory (project map, verified gate commands, engram) avoids re-discovering the same things every session.

The bigger saving is not the size of each attempt but the **number of attempts**: a task costs *attempts × cost per attempt*. Waymark's fields (the ask and what each screenshot points at, evidence before the fix, reuse, verified APIs, the two-strike rule) aim at one attempt per task. Large tasks keep their plan as checkpoints in the project memory, so a context compaction does not make the agent guess what was done.

Measured on real tasks ([`docs/audit-context.md`](docs/audit-context.md)), each model response re-reads the whole context (~58 k tokens in Claude Code), so the cost driver is the number of responses. The hooks do the routine's own steps instead of the agent: the git status comes with each prompt, each file's history at its first edit, a department loads once per session, and what was learned is saved at the close. A step the agent could forget is a step the hook does.

### MCP servers only where their framework is used

Your MCP servers stay registered where you put them. In each project, `scripts/mcp-fit.mjs` reads its manifests and blocks (a deny rule in that project's private `.claude/settings.local.json`, after your yes) the framework servers it does not use: no Angular CLI or PrimeNG in a React app or a docs repo, no React docs in an Angular app. When the project adopts the framework the rule is lifted. Docs and memory servers are never blocked. `waymark.mjs check` reports it for the project it runs in.

### Skills you never use, and costly resumes

Each listed skill costs its description in every session. `scripts/skill-fit.mjs` finds the skills you added but have not invoked in 30 days and, after your yes, lists only their names (still invocable); unused plugins are disabled. Waymark's 17 descriptions were also cut from 8,558 to 4,407 characters (~1,000 tokens per session). Resuming a large session after an hour idle re-writes its whole context (the cache expired), so a new task is cheaper in a new session. These are reported, not enforced: `node <skills-dir>/waymark/scripts/waymark.mjs check` lists what is pending (a newer version, skills changed, MCP fit, skill fit, the migration, unconnected agents, a large idle session), and the session hook reminds the agent to run it once a week. The hooks themselves hold only the chain (`docs/adr/0008`).

### Evaluate a task

Say *"evalúa tu trabajo"* at the end of a task: the agent audits it with `references/evaluation.md` (versioned with Waymark), citing its own tool calls. A field it declared without a call behind it is reported as a false declaration.

### Measure it

```bash
node ~/.claude/skills/waymark/scripts/measure.mjs --turns 3-5
```

It reads the agent's own session transcript (offline, no model call) and shows, per prompt: the context it started with (its growth is what every later response re-reads), responses, tool calls, images, new vs cached input tokens, output and sub-agent tokens; the fixed context the session started with; and for a range of prompts (one task) the number of **attempts**. Note the plan-quota % before and after a task to relate tokens to your limits.

## How it triggers

Three layers keep the agent on track, without an orchestrator: each skill's `description` (the trigger, with the phrases people actually type), the instructions block (Rule 0: every request runs recall → department → skills → verify → learn; questions run in read-only consult mode), and a tiny per-prompt **Rule 0 reminder hook** (`scripts/rule0-hook.mjs`, installed by default where the agent supports hooks). The hook runs locally, adds ~120 tokens per prompt (~35 once the previous reply followed the routine) and blocks nothing. Every reply starts with `Waymark → L<n> · <dept>`, so you can see at a glance that the routine ran.

```
"quiero crear un modal"      → dept-frontend → brief → ui-build → gates → learn
"nuevo endpoint de pagos"    → dept-backend (+ dept-security, dept-qa)
"refactoriza a hexagonal"    → dept-architecture (L3: plan + ADR)
"cambia el color del botón"  → L0: done directly, no department
```

| Level | Example | What runs |
|---|---|---|
| L0 | a color, a text, a typo | nothing, done directly |
| L1 | bug in one known file | short Entry · department Quick ref · gates without build |
| L2 | new screen, endpoint, integration | full Entry · department rules and skills · gates + build + review |
| L3 | refactor, migration, new module | L2 + `dept-architecture` + plan before coding + ADR |

## What's inside

```
skills/
  waymark/        core: triage, Entry/Exit protocols, skill registry, learning loop
    SKILL.md (triage, departments, what to read when) · skill-map.json · skill-registry.md (generated)
    references/        protocol, project-detection, learning, skills (find / install / create), maintenance
    scripts/sync.mjs
    stacks/            angular, react, node, nestjs, rails, python, go, java, dotnet, generic
    architectures/     screaming, feature-sliced, hexagonal, clean, layered, modular-monolith
    templates/         department, stack, architecture, tool skill, project skill, project memory,
                       instructions.md (block for CLAUDE.md / AGENTS.md), private-layer/
  dept-product  dept-architecture  dept-frontend  dept-ux-ui  dept-backend
  dept-data  dept-security  dept-qa  dept-devops  dept-devex          ← 10 departments (SKILL.md + procedures.md)
  ui-build  ui-refine  ui-system  ui-audit  browser-verify  library-docs   ← own tool skills
adapters/              per-agent paths and MCP registration
INSTALL.md             install / update / uninstall, written for the agent
scripts/export.mjs     copy your installed (improved) skills back into the repo
.claude-plugin/        optional Claude Code plugin manifest
```

### Departments

| Skill | Owns |
|---|---|
| `dept-product` | requirements, scope, acceptance criteria |
| `dept-architecture` | structure, layers, boundaries, patterns, ADRs |
| `dept-frontend` | UI code in any framework |
| `dept-ux-ui` | visual design, accessibility, motion, design system |
| `dept-backend` | APIs, services, jobs, realtime, integrations |
| `dept-data` | schema, migrations, queries, caching, client state |
| `dept-security` | authn/authz, secrets, OWASP, dependencies |
| `dept-qa` | tests, verification, review, Definition of Done |
| `dept-devops` | build, CI/CD, git, environments, deploy |
| `dept-devex` | agent tooling, Waymark, docs |

### Missing skills are created, not skipped

When a department needs a capability no installed skill provides, the agent installs a known one (asking first) or **creates a new skill** with its trigger description, registers it in `skill-map.json`, adds it to the department's Tools table and uses it. General skills go to the agent's skills folder; project-specific ones into the project.

### Third-party skills are used too

`sync.mjs` indexes every skill it can find, not only Waymark's: the agent's own folder, other agents' folders (`~/.cursor/skills`, `~/.codex/skills`, `~/.agents/skills`, Gemini, OpenCode), plugins and each project's `.claude/`, `.cursor/`, `.agents/`… `skills/`. Each one gets a department and a capability from its description and its path in `skill-registry.md`, so a department can read and follow it even when the agent did not load it. `waymark.mjs check` reports new or removed skills, and `waymark.mjs sync` refreshes the registry. The six community skills Waymark replaces are listed as *Replaced* and never used.

### Tool skills that grow

`ui-build`, `ui-refine`, `ui-system`, `ui-audit`, `browser-verify` and `library-docs` are original skills. Each one is owned by a department and starts with a precondition that loads that department first. They grow as you work through `patterns/`, `rules/`, `facts/` and `## Learned notes`.

`library-docs` routes documentation lookups to the right MCP server: `angular-cli` for Angular, `primeng` for PrimeNG and `context7` for everything else.

## It adapts to you

Nothing personal ships in this repository: no stack, no preferences, no projects. Your private layer `~/.waymark/` starts generic and fills itself as you work:

| File | Fills itself when… |
|---|---|
| `profile.md` | a project of a new stack, package manager or architecture is detected |
| `projects.md` (index) + `<project>/.waymark/memory.md` | you work in a project for the first time; it is the project manual (identity, map, gates, conventions), local and never committed. What each task learned goes to engram, saved by the end-of-turn hook and committed in `.engram/` |
| `preferences.md` | you correct how the agent answers or delivers code |
| `subagents.md` | a search or delegation rule proves wrong or missing |
| `agent.md` | the installer records where your agent keeps skills and instructions |
| `coexistence.md` | the installer finds another agent framework (see below) |

The same layer serves every agent, so switching from Claude Code to Codex keeps your memory. Memory has three layers (`docs/adr/0015`): git holds what was done (commits, trailers, notes), engram what was learned (written by the hooks, shared by every agent, carried in `.engram/`), and `memory.md` the project manual.

### Living next to an orchestrator

Waymark is not an orchestrator: an orchestrator decides *who* does the work, Waymark gives the criteria and the memory the work is done with. So it adapts to whoever arrived first:

| On this machine | Waymark |
|---|---|
| no orchestrator | leads: Rule 0 block, both hooks, full routine |
| an orchestrator already installed (e.g. gentle-ai) | **guest**: no hooks, no block; its departments reach the orchestrator through the orchestrator's own skill registry, its memory through engram |
| Waymark first, an orchestrator later | keeps leading; the newcomer's rules are sorted into **adopted**, **fallback** (its skills back Waymark up) or **resolved**, and you are asked once whether Waymark should step down to guest |

You can always pick another mode and move any rule. The other framework's files are never edited (`~/.waymark/coexistence.md` holds the adaptation), and uninstalling Waymark leaves it exactly as it was.

## The learning loop

After every L1+ task the agent keeps only what was **new and non-obvious** and writes it to exactly one place:

| The lesson is about… | It goes to |
|---|---|
| this project | `<project>/.waymark/memory.md` |
| a stack | `stacks/<stack>.md` |
| a tool skill | its `## Learned notes` |
| a department, in any stack | its `## Learned rules` |
| unsure / seen once | `~/.waymark/learnings/dept-<dept>.md` (staging) |

When a list grows long, the agent folds it into the skill body, so the skills evolve. When a project procedure has repeated twice, the agent generates a **project skill** inside that project.

## Contributing back

Your installed skills get better as you use them. To publish those improvements:

```bash
node scripts/export.mjs ~/.claude/skills --strip-learned
git diff
```

`--strip-learned` drops personal learned entries; leave it off when the lessons are general. The private layer is never exported.

## Extend

- **Stack**: copy `templates/stack.template.md` → `stacks/<slug>.md`, add its detection signal to `waymark/SKILL.md` §6.
- **Architecture**: copy `templates/architecture.template.md`.
- **Department**: copy `templates/department.template.md` → `skills/dept-<name>/SKILL.md`, add it to the core table and to `sync.mjs`.
- **Agent**: add `adapters/<agent>.md` with its paths and MCP registration.

## License

MIT. The tool skills are original work inspired by the approach of community skills; credits are in `skill-map.json` → `inspiredBy`. External skills you vendor later with `sync.mjs --vendor` keep their upstream license in `NOTICE.md`.
