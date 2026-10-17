# INSTALL — instructions for the agent

> **You are a coding agent (Claude Code, Codex, Cursor, Gemini CLI, OpenCode or similar) and the user asked you to install, update or uninstall Waymark.** Follow this document step by step. No installer script is needed: you do the work with your own file and shell tools.
>
> Talk to the user in their language. Ask before every step marked **[ask]**, with your choice window if the agent has one (Claude Code: `AskUserQuestion`, options as buttons, recommended first), else in text. Never touch credentials, sessions or files not listed here.

Repository: `https://github.com/LiriRaid/waymark`

---

## 0. Pick the operation

| The user said… | Do |
|---|---|
| "instálame / install Waymark" | §1 (incl. §1.1 orchestrators, §1.2 confirm) → §8 |
| "actualiza / update Waymark" | §9 |
| "desinstala / uninstall Waymark" | §10 |
| "quita la versión vieja e instala la nueva" / a Waymark before 2.0 is installed | §11 |

## 1. Detect the agent and its paths

Identify which agent **you** are, and **every other agent installed on this machine** (config folders such as `~/.claude`, `~/.codex`, `~/.cursor`, `~/.gemini`, `~/.config/opencode`, or the agent's CLI on the PATH). The known agents and their folders are listed in `skills/waymark/scripts/agents/agents.json`; `connect-agents.mjs` also reports an unknown one (a hidden home folder or a `~/.config` folder with instructions, a `skills/` folder or hooks) and offers it the pointer to `.waymark/tasks.md` (`docs/adr/0022`). Waymark can be installed in all of them at once; they share one private layer, so work started in one agent can be resumed in another. For each agent, open `adapters/<agent>.md` from the repository (`claude-code`, `codex`, `cursor`, `gemini-cli`, `opencode`, or `generic` if none fits). It gives:

- `<skills-dir>` — where Waymark's skills live: **`~/.agents/skills` for every agent**, one real copy (`docs/adr/0017`). Claude Code, which reads only `~/.claude/skills`, gets a link to each one there. An agent's own folder (`~/.claude/skills`, `~/.codex/skills`…) holds only the skills the user asks for that agent alone.
- `<project-skills-dir>` — project skills: `.agents/skills` for every agent (Claude Code through a link in `.claude/skills`), kept out of git
- `<instructions-file>` — global instructions file (e.g. `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`)
- how to register MCP servers

If the adapter marks a path as *verify*, check it against your own documentation or the filesystem before using it. Tell the user in one line per agent what you detected (the sample messages in this file are shown in the user's language):

```
Agent: Claude Code · skills: ~/.agents/skills (links in ~/.claude/skills) · instructions: ~/.claude/CLAUDE.md · private layer: ~/.waymark
Also found: Codex (~/.codex) · Cursor (~/.cursor)
```

**1.1 Orchestrators and other agent frameworks.** Before the plan, check whether another framework already governs each agent: marked blocks in `<instructions-file>` that are not Waymark's (`<!-- <name>:<section> -->`), hooks in the agent settings that do not run Waymark scripts, orchestrator/persona/trigger skills, its own skill registry. Waymark is not an orchestrator: **if one is already installed, Waymark becomes its guest** (no hooks, no Rule 0 block; its skills and memory reach the orchestrator through the orchestrator's own registry and engram). Follow the repository's `skills/waymark/references/coexistence.md` §1–§4: read its sections, write each rule as one line and classify it (Adopted · Fallback · Resolved), and find how its registry is refreshed. **Never edit that framework's files.** Tell the user in one line:

```
Orchestrator already installed: <name> (<name>:* blocks, its own hooks, registry <its path>) → Waymark joins as a guest: no hooks and no block, its skills through its registry, memory through engram. I do not touch its files.
```

Nothing found → the normal plan below; Waymark leads.

**1.2 Plan and confirm [ask].** Before downloading or touching anything, show the user the plan and wait for an explicit yes:

```
I will install Waymark like this:
1. Skills (17)           → ~/.agents/skills/            (one copy for every agent; Claude Code sees them through links in ~/.claude/skills; backup first if something exists)
2. General instructions  → ~/.claude/CLAUDE.md          (a marked block at the top; the rest is not touched)
3. Private layer         → ~/.waymark/                  (outside .claude; works for any agent and fills itself in)
4. Hooks                 → ~/.claude/settings.json      (project card at session start ~600 tokens; a reminder per message ~70 tokens with the task ID and the git status; each file's pack at its first edit; your decision before files change; the testigos, the record and what was learned at the end of the turn)
5. Agents: Claude Code (this one) + the ones I found (Codex, OpenCode, Gemini CLI…): the shared skills of step 1, and the block and hooks in each; the same memory
6. Learned memory        → engram (CLI; if missing I offer to install it) and its MCP in each agent
7. I will ask before: removing third-party skills, moving content out of your instructions file, installing engram and registering MCP servers.
```

Ask it with your **choice window** if the agent has one (Claude Code: `AskUserQuestion`), the plan in the question, options as buttons:
- **Install in all my agents (Recommended)** — when §1 found other agents; it lists them. Waymark is a user-level install for every agent: the skills once in `~/.agents/skills`, and the instructions block and hooks in each agent. With no other agent found, the option is **Install (Recommended)**, for this agent.
- **Only this agent** — only when §1 found others: the full install here, nothing in the others. After the install, `node "<skills-dir>/waymark/scripts/waymark.mjs" check` offers each agent that is not set up yet.
- **Change something** — the user says what (another folder, skip the hook, skip a step).
- **Cancel**.

**§1.1 found an orchestrator →** the plan becomes the guest plan (items 2 and 4 disappear; a new step refreshes its registry) and the question offers, one question only:
- **Guest of <framework> (Recommended)** — skills + private layer; no block, no hooks; `<framework>` keeps its flow and loads Waymark's departments through its registry; memory through engram.
- **Waymark leads, <framework> as fallback** — full plan; its compatible rules adopted, its skills as fallback, turn conflicts resolved for Waymark (the user prefers Waymark's routine).
- **Skills only** — skills + private layer; no registry step, no block, no hooks.
- **Cancel**.

Then show the lists (Adopted · Fallback · Resolved) and let the user move any rule **[ask]**; they become `~/.waymark/coexistence.md` in §6.1 with `Mode: guest | waymark-leads | skills-only`.

Agents without a choice window: show the plan and end with *"Shall I continue?"* (in the user's language).

Use the real paths from the adapter. **Several agents chosen** → §5 (skills in `~/.agents/skills`) and §6.1 (private layer) once; §3, §6.2, §7 once per agent with its own adapter (backup, instructions block, hooks, MCP in its own config). If the user says no or changes something (another folder, skip a step), adapt and show the plan again.

### Which hooks each agent gets

Generated from `agents/agents.json` and the adapters (`node skills/waymark/scripts/matrix.mjs`). Tell the user after the install: for an agent whose cell is *advisory*, the step is asked in its instructions and nothing blocks it; for a sensitive path or a secret in a tool's result, *prevent* means a hook refuses the call and *detect* means only that the end-of-turn hook finds it in the transcript and records it (after the fact, in the record of the task).

<!-- agent-matrix:begin (generated by skills/waymark/scripts/matrix.mjs --write; do not edit) -->
**Hook events Waymark registers, per agent** (from `agents/agents.json`):

| Agent | SessionStart | UserPromptSubmit | PreToolUse | PostToolUse | Stop |
|---|---|---|---|---|---|
| Claude Code | yes | yes | yes | — | yes |
| Codex | yes | yes | yes | — | yes |
| Gemini CLI | yes | yes | yes | yes | yes |
| OpenCode | yes | yes | yes | yes | yes |
| Cursor | yes | yes | yes | yes | yes |
| Antigravity | yes | yes | yes | yes | yes |
| Kiro | yes | yes | yes | yes | yes |
| Copilot CLI | yes | yes | yes | yes | yes |

**What each agent enforces.** *enforced*: a hook runs and can stop the turn or hand the agent the text. *advisory*: the agent is told in its instructions and nothing blocks it. For what the guard protects, *prevent*: a hook before the tool refuses the call; *detect*: nothing refuses it, and the end-of-turn hook reads the transcript of the agent and records what got through in the record of the task, where it cannot be removed. No guarded action is left with neither.

| Agent | End-of-turn checks | Decision gate and commit trailer | Memory and procedures handed over | Sensitive paths: edits and shell | Sensitive paths: reads | Secret printed in a tool result | Context brake |
|---|---|---|---|---|---|---|---|
| Claude Code | enforced | enforced | enforced | prevent | prevent | detect | enforced |
| Codex | enforced | enforced | enforced | prevent | detect | detect | enforced |
| Gemini CLI | enforced | enforced | enforced | prevent | detect | detect | enforced |
| OpenCode | enforced | enforced | enforced | prevent | detect | detect | enforced |
| Cursor | enforced | enforced | enforced | prevent | detect | detect | enforced |
| Antigravity | enforced | enforced | enforced | prevent | detect | detect | advisory |
| Kiro | enforced | enforced | enforced | prevent | detect | detect | advisory |
| Copilot CLI | enforced | enforced | enforced | prevent | detect | detect | advisory |

Agents Waymark knows with no adapter yet (nothing is recorded or checked there): Windsurf, Qwen Code, Droid, Amp, Crush.
<!-- agent-matrix:end -->

## 2. Get the files

Clone into a temporary folder (do not clone inside `<skills-dir>`):

```bash
git clone --depth 1 https://github.com/LiriRaid/waymark "<tmp>/waymark"
```

No git? Download `https://github.com/LiriRaid/waymark/archive/refs/heads/main.zip` and extract it. If the user gave you a local path to the repository, use that instead.

Requirement check: `node --version` must be 18 or newer. Node is required: the skill links (§5), the hooks, the status line, `sync.mjs` and every `waymark.mjs` command run on it. If Node is missing, stop and tell the user to install it first (nodejs.org, or `winget install OpenJS.NodeJS.LTS`, `brew install node`).

`waymark.mjs` is a script, not a program on the `PATH`: typed bare in a terminal it is "not found". Every command in this file runs as `node "<skills-dir>/waymark/scripts/waymark.mjs" <command>`; the session card prints that command once, as `W`, for the agent. No launcher is installed: nothing is written outside `<skills-dir>` and the agents' own files, and `tests/docs.test.mjs` fails if a document shows the bare name as a command.

Paths in this guide start with `~`. Node does not expand it, and PowerShell expands it only for its own commands: on Windows write `"$HOME/.agents/skills/…"` (PowerShell, Git Bash) or `"%USERPROFILE%\.agents\skills\…"` (cmd), or the absolute path.

## 3. Back up **[ask if anything exists]**

Create `~/.waymark-backups/<YYYY-MM-DD-HHmm>/` and copy into it whatever already exists of:

- `<skills-dir>/waymark`, `<skills-dir>/dept-*`, and the tool skills listed in §5
- `<instructions-file>`
- `~/.waymark/`

Report the backup path. If nothing exists, say "clean install" (in the user's language) and continue.

## 4. Replaced third-party skills **[ask]**

Waymark ships its own tool skills that replace these community skills. If any of them is installed in `<skills-dir>` (or as a link from `~/.agents/skills`), list what you found and ask before removing:

| Installed skill | Replaced by |
|---|---|
| `frontend-design` | `ui-build` |
| `impeccable` | `ui-refine` |
| `ui-ux-pro-max` | `ui-system` |
| `web-design-guidelines` | `ui-audit` |
| `webapp-testing` | `browser-verify` |
| `context7-mcp` (skill, not the MCP server) | `library-docs` |

Remove only the confirmed ones. Remove a link, not the folder it points to, unless the user confirms nothing else uses it. **Before removing a real folder, copy it to the §3 backup.** If `~/.agents/.skill-lock.json` exists, back it up and delete the entries of the removed skills (and entries whose folder no longer exists, reporting them).

## 5. Copy the skills

Copy every folder in the repository's `skills/` into `~/.agents/skills` (every agent's user folder), replacing existing folders with the same name:

```
waymark  dept-product  dept-architecture  dept-frontend  dept-ux-ui  dept-backend
dept-data  dept-security  dept-qa  dept-devops  dept-devex
ui-build  ui-refine  ui-system  ui-audit  browser-verify  library-docs
```

Copy real files into `~/.agents/skills`. Then, where Claude Code is installed, link them from `~/.claude/skills`: `node "$HOME/.agents/skills/waymark/scripts/skill-links.mjs" --user` shows the plan **[ask]**, `--apply` makes a junction (Windows) or symlink per skill. A Waymark skill still copied in `~/.claude/skills` from an older install moves to `~/.agents/skills` (the newer content wins; the replaced folder goes to `~/.waymark-backups/<date>-skills/`). Skills that are not Waymark's are never touched. From here on `<skills-dir>` = `~/.agents/skills` in every path below, the hooks included. If this is a reinstall and the user's installed copies have entries under `## Learned rules` / `## Learned notes`, or files in `patterns/`, `rules/`, `facts/` that the repository does not have, keep those entries: merge them into the new files instead of overwriting.

## 6. Private layer and instructions

Keep a list of **every file you create or modify** from here on; §8 reports it.

**6.1 Private layer.** Create `~/.waymark/` from `<skills-dir>/waymark/templates/private-layer/`:

| File | If missing | If it exists |
|---|---|---|
| `README.md`, `profile.md`, `preferences.md`, `subagents.md`, `projects.md` | copy the template | keep it; never overwrite |
| `agent.md` | copy and fill with the paths from §1 | add or update this agent's row only |
| `learnings/`, `projects/` | create | keep |
| `coexistence.md` | only if §1.1 found another framework: from the template, with the mode and the three lists confirmed in §1.2 | update `Mode`, `Frameworks` and the lists the user confirmed; keep the rest |

These files start generic on purpose. **Do not ask the user to fill them**: Waymark completes them automatically while they work (stacks and projects on first detection, preferences from corrections, see `waymark` §6–§7).

- **The user's own layer:** if they name one (a private repository, a zip, a folder), copy it into `~/.waymark/` instead of the templates.

**6.2 Instructions block.** Insert `<skills-dir>/waymark/templates/instructions.md` (everything from `<!-- waymark:begin -->` to `<!-- waymark:end -->`) into `<instructions-file>`. It holds the general working rules and the mandatory use of Waymark; it contains no stack or personal data.

- File missing → create it with the block.
- Block already present → replace it in place.
- Mode `guest` or `skills-only` → **no block**: nothing in the instructions file competes with the orchestrator.
- File exists without the block → add the block **at the top** and leave the rest of the file untouched. Another framework's blocks are never moved, edited or offered for moving. Then read the rest of the file and list for the user the parts that are now covered by the block or the private layer (an older Waymark section, rules about subagents, delivery preferences, project descriptions, links to files such as `Agents.md` or `user-preferences.md`). Offer **[ask]**: move each part into the matching private-layer file (`subagents.md`, `preferences.md` → *Learned preferences*, `projects.md`, `profile.md`) and remove it from the instructions file. Never delete content the user did not approve.
- Agents whose instructions are not a file (e.g. Cursor user rules): show the block and ask the user to paste it.

## 7. MCP servers and sync

**7.1 MCP [ask].** Waymark works without MCP servers; `library-docs` uses them for version-accurate documentation. Register only what the user accepts, with the method in the adapter, and skip servers already registered.

| Server | Propose when | Command / source |
|---|---|---|
| `context7` | always (docs for any library) | `https://mcp.context7.com/mcp` (HTTP) |
| `engram` | always: the learned layer (`docs/adr/0015`). The end-of-turn hook saves each task's Aprendido with the `engram` CLI into its local store (`.engram/` is git-ignored, `docs/adr/0017`) and the card shows the latest memories, in every agent on the machine | `https://github.com/Gentleman-Programming/engram`. Waymark pins the release it was tested with in `skills/waymark/engram.pin.json` (`docs/adr/0036`): its version and, per OS and architecture, the sha256 of the release archive and of the binary inside it. Binary missing → offer **[ask]** the pinned release's asset for the OS (`engram_<version>_<os>_<arch>`): compare the archive's sha256 with the pin (and `checksums.txt`) before extracting it, then put it on the PATH. `check` compares the installed binary with the pin and says when it is another release or not the published bytes (a notice, never a stop). Then each agent's MCP **[ask]**: `engram setup <agent>` (`claude-code`, `codex`, `gemini-cli`); OpenCode: add `mcp.engram` (`["<engram>", "mcp", "--tools=agent"]`, type `local`) to the config file OpenCode actually reads (`~/.config/opencode/opencode.json[c]`; on Windows `engram setup opencode` writes `%APPDATA%opencode`, which OpenCode does not read). A project with learned sections in memory.md: `node "<skills-dir>/waymark/scripts/waymark.mjs" learned` (§8 check) |
| stack-specific servers | only when the user works with that stack | entries in `skill-map.json` → `mcp` with a `stack` field |

The stack-specific entries shipped today are **examples** for Angular (`angular-cli`: `npx -y @angular/cli mcp`, `primeng`: `npx -y @primeng/mcp`). On a fresh machine the stack is usually unknown: skip them, and let `dept-devex` propose the right server later, when a project of that stack is detected (`waymark` §5).

**Framework servers only where their framework is used.** The user's MCP servers stay where they registered them (user scope, `.mcp.json`, local); nothing is moved or removed. A framework's server (Angular, PrimeNG, React, Vue, Tailwind, NestJS, Prisma…) is visible in every project, so in projects that do not use that framework the agent can waste calls on it and its names and instructions sit in context. `node "<skills-dir>/waymark/scripts/mcp-fit.mjs"` reads each known project's manifests (`package.json`, `Gemfile`, `pyproject.toml`, `composer.json`, `pom.xml`, `.csproj`…; none up to the repository root = no framework) and plans a permission deny rule (`mcp__<server>`) in that project's own `.claude/settings.local.json` (private, normally git-ignored) for each framework server it does not use, and lifts the rules it added when the project adopts the framework. Show the plan **[ask]**; on yes re-run it with `--apply` (it merges into the existing settings file with a `.waymark-bak` copy, never overwrites one it cannot parse, and never removes a rule the user wrote). Generic servers (`context7`, `engram`) are never blocked. Afterwards `node "<skills-dir>/waymark/scripts/waymark.mjs" check` reports the same for the project it runs in (§7.2). Takes effect in the next session. Measured on Claude Code 2.1.287: a deny rule hides the server from tool search and drops its names and instructions from context (~120 tokens per server per request); the larger saving is the calls the agent no longer makes to the wrong framework.

**Skills you never use (Claude Code).** Every listed skill sends its name and description in every session. `scripts/skill-fit.mjs` reads the agent's own transcripts (offline) and, for skills you added (claude.ai synced skills, `~/.claude/skills`) with no invocation in 30 days, proposes `skillOverrides: "name-only"` in `~/.claude/settings.json` (still invocable by name; only the description leaves the listing), and `enabledPlugins: false` for plugins with no skill used. Waymark's own skills, the providers in `skill-map.json` and skills bundled with the agent are never touched; it needs 14 days of history; `--apply` after a yes (backup `.waymark-bak`), `--restore` lifts only its own entries. `node "<skills-dir>/waymark/scripts/waymark.mjs" check` reports the plan's size (§7.2). Verified on Claude Code 2.1.286: `name-only` drops a synced skill's description from the listing.

**7.2 Hooks (installed by default): the four links of the chain** (`docs/adr/0008`). Four small local scripts, 0 tokens to run, one per link, the same for every agent:
- **Session start** (`session-hook.mjs`, also after `/clear` and a context summary): a capped digest (≤ 2,700 chars, usually ~600 tokens) of this machine's *Environment*, the project's manual and open tasks (listed; `node "<skills-dir>/waymark/scripts/waymark.mjs" check` asks which already work), and its latest learned memories from engram, with the pointer to `.waymark/tasks.md`, so Recall never depends on the agent remembering to read it. A turn another session left open over two hours (an API error, the quota) is closed as interrupted (`docs/adr/0015`). With `coexistence.md` it also injects its rules (≤ 1,800 chars). When the last `node "<skills-dir>/waymark/scripts/waymark.mjs" check` is older than a week, one line (~30 tokens, at most once a week) asks the agent to run it.
- **Each prompt** (`rule0-hook.mjs`): the Rule 0 reminder (~70 tokens, ~10 once the previous reply opened with `Waymark →`), the task ID (`2026-10-02 · T3`), the repo's stack and a one-line `git status`, so the agent spends no response on it. **Context brake** (`docs/adr/0016`): by default, a message to a session at 300k tokens is stopped before the model (0 tokens), kept in `.waymark/next-prompt.md` and brought by the next session's card; resending it continues there until the context grows another 100k, where it stops again (400k, 500k…; `WAYMARK_BRAKE_TOKENS`, 0 = off; `WAYMARK_BRAKE_STEP`, 0 = once per session). The same happens to a message that reaches a session past 100k after more than an hour idle (`docs/adr/0018`): its cache has expired, so the first response would re-write the whole context, once per idle stretch (`WAYMARK_IDLE_TOKENS`, `WAYMARK_IDLE_MINUTES`, 0 = off). Both brakes wait for the task: while the session's task is in progress (no Cierre yet, cut by the quota, or closed `parcial`/`bloqueado`) no message is stopped at any size; the first message after a Cierre `hecho` is. It takes a `git status` snapshot (≤ 1.5 s) so the end-of-turn hook knows every file the turn changed, and marks the turn open in `.waymark/open.json` (a turn that never ends still shows in `tasks.md`). It never changes the prompt.
- **Decision gate** (`tool-hook.mjs`, before shell commands and edits): every L1–L3 change to project files (edits, and shell commands that change files such as `git checkout --`, `sed -i`, `rm` or a redirect) is denied until the user was asked in the choice window in this task. A single way is confirmed there too. A turn routed Q is told once to re-route by invoking the owner department with args `L<n>`. The message asks for every decision that shapes the work in the same call and never offers browser verification (only when the user asks); the branch is the user's and is never pushed as a sub-decision. A reply with no routing line inside a task that has not closed keeps the task's routing.
- **Memory at the first edit and at the commit** (`tool-hook.mjs` too, `docs/adr/0014`, `0015`): the first edit of each project file in a task gets that file's `node "<skills-dir>/waymark/scripts/waymark.mjs" pack` (what earlier tasks did there) as context: before the tool in Claude Code and Codex, with the edit's result in OpenCode and Gemini CLI. Recordar never depends on the agent. A `git commit` whose `Waymark-Task` trailer would be recorded under another ID is denied with the right one. The project's `.gitignore` keeps `.waymark/`, `.engram/`, `.agents/` and `.claude/skills/` out of git (`docs/adr/0017`).
- **End of turn** (`stop-hook.mjs`): a turn routed L1–L3 that changed project files must end with `## Cierre · <task ID>` (`Resultado`, `Evidencia`, `Aprendido`); the decision is the user's answer in the choice window, recorded as is. Everything it can observe is computed and recorded under `observed`: memory, procedure, gates after the last change with time and failure, the gate testigo's run, secrets found (where and kind, never the value), the chain (with its anchors in git), tests, the Evidencia (a check after the last change, and its cited facts found or *sin respaldo*), browser, review, docs, branches, time.
  - What blocks (once) and what is only recorded and scored is one file, the catalog of testigos `skills/waymark/routine.json` (`docs/adr/0006`, `0012`). Each testigo executes instead of reading prose: when the agent ran no gate after its last code change, the hook runs the repo typecheck (memory.md *Quality gates* → package.json → tsconfig, 40 s, never the full build). Every testigo that applies blocks once; only the commit trailer and the chain are recorded (`docs/adr/0010`). `node "<skills-dir>/waymark/scripts/waymark.mjs" testigos [<task ID>]` re-runs the ones that execute.
  - Every task gets an automatic evaluation (✔/✘ per step, tokens, quota) that the user sees as one line. In Claude Code the quota % is measured by Waymark's status line from the task's first prompt to its close (`docs/adr/0019`), and each clean measure becomes a calibration pair. The 5-hour window is the account's, so with several sessions open each rise is split among them by what each spent: every terminal shows `5h 41% · esta sesión ≈12%`, and a task shared with another session closes with its own part, prorated by cost (an estimate, never a pair). Elsewhere it is estimated from those pairs, or from the ones you add: `calibrate.mjs "<task ID>" <percent>`.
  - The record (with the agent's name) goes into the hash-chained `<project>/.waymark/provenance.jsonl`; a task with a commit keeps it whole as a git note on that commit (`refs/notes/waymark`) and a stub in the log (`docs/adr/0012`). Each record also appends the log's length and last hash to a note on HEAD under `refs/notes/waymark-anchor`, pushed and fetched with the task notes: a log rewritten by hand no longer passes the chain, and a removal the user asks for goes through `node "<skills-dir>/waymark/scripts/waymark.mjs" forget "<task ID>" | --session <id> --reason "<why>"` (the plan; `--apply` after their yes), which leaves a rewrite anchor with the reason (`docs/adr/0025`). The hook writes the task's *Work in progress* line from the Aprendido (≤200 characters) and regenerates `tasks.md` (`docs/adr/0007`). A record with no commit (a question, a task without one, a confirmation) also appends its chained line to a note on HEAD under `refs/notes/waymark-log`; a task committed in several repos gets its note on its newest commit in each. `node "<skills-dir>/waymark/scripts/waymark.mjs" tasks [<task ID>]` lists the records (the log's and those only git holds, e.g. in a clone: notes, `waymark-log` lines, and the `Waymark-Task` commits of an ID with no record). The hook pushes the notes in each repo the turn pushed while the remote lacks some; when its process cannot (no git credentials there), the close blocks once and asks the agent to run `node "<skills-dir>/waymark/scripts/waymark.mjs" notes push` from its own shell in each repo; `notes push` also works by hand. A clone brings branches only: in a repo with an `origin`, the session hook adds one fetch refspec on its own (a glob into `refs/notes/remotes/origin/waymark*`, never over the local notes; a remote with no notes yet does not break `git fetch`) and merges what each fetch brings. With no `.waymark/` it also fetches the notes at once (5 s, no credential prompt, at most once a day) and, when git holds records, rebuilds `.waymark/memory.md` (*Work in progress* from the records; Identity and gates for the Minimal bootstrap) and `tasks.md`; a fetch that fails is one line on the card. `node "<skills-dir>/waymark/scripts/waymark.mjs" notes setup` does the same by hand; `check` reports note commits not pushed.
  - The learned layer: the task's Aprendido, decisions, files and commit are saved to engram with its CLI (`engram save`, topic = task ID, project = the slug pinned in `.engram/config.json`), so every agent shares what was learned. A commit that carries an earlier task's trailer gets that task's record as its note. In agents without code-review, `node "<skills-dir>/waymark/scripts/waymark.mjs" review <files>` is the review.
  - A turn routed Q in a project with memory leaves a short record with no task ID: its question, the skills it ran and what it answered (the Aprendido, or the start of the final reply). `tasks.md` lists the last five since the last close, so a question that ran a review is not taken for still pending. A turn that launched an agent in the background (a review) is recorded, like a task, when its notification ends it.

**On demand, not in the hooks:** `node "<skills-dir>/waymark/scripts/waymark.mjs" check` (read-only) reports, one line each, what is pending:
- a newer Waymark version (§9);
- skills changed since the last sync;
- MCP fit and skill fit (§7.1);
- memory still in `~/.waymark/projects/`;
- engram missing, or not the pinned release (the learned layer, §7.1), or a memory.md that still holds *Solved problems*, *Gotchas* or *Decisions* (`node "<skills-dir>/waymark/scripts/waymark.mjs" learned` moves them to engram);
- other agents not connected;
- a registered hook that does not answer a probe in some agent (a moved or linked install): until it is re-registered, no task there is recorded;
- a GitHub repo with task records (git notes) that allows squash or rebase merges, which leave the notes behind: merge pull requests with a merge commit;
- a framework that appeared or vanished;
- a large idle session in the folder (resuming one after an hour re-writes its whole context).

The agent offers each item with the choice window. `node "<skills-dir>/waymark/scripts/waymark.mjs" sync | mcp-fit | skill-fit | migrate | connect | install-hooks | learned` run the matching script after the user's yes. `node "<skills-dir>/waymark/scripts/waymark.mjs" pack <files>`, `review <files>`, `tasks` and `memory` only read.

- **Claude Code:** `node "<skills-dir>/waymark/scripts/install-hooks.mjs"` shows the plan for `~/.claude/settings.json` **[ask]**, then re-run it with `--apply`. It makes a `.waymark-bak` backup first and never writes a file it cannot parse. It adds, updates (path, matcher) or de-duplicates only the entries that run `waymark/scripts/<hook>.mjs`; every other key and hook stays, and new entries go after the existing ones. Run it from the installed copy (`<skills-dir>`), never from a checkout of the repo, because it registers the path it runs from. It also sets `"statusLine": { "type": "command", "command": "node \"<skills-dir>/waymark/scripts/statusline.mjs\"", "refreshInterval": 30 }` (quota and context; it measures each task's %). If you already have a status line, its command moves to `~/.waymark/statusline.json` and runs after Waymark's. The result is:

```json
{ "hooks": {
  "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "node \"<skills-dir>/waymark/scripts/rule0-hook.mjs\"" } ] } ],
  "SessionStart":     [ { "hooks": [ { "type": "command", "command": "node \"<skills-dir>/waymark/scripts/session-hook.mjs\"" } ] } ],
  "PreToolUse":       [ { "matcher": "Bash|PowerShell|Edit|Write|NotebookEdit", "hooks": [ { "type": "command", "command": "node \"<skills-dir>/waymark/scripts/tool-hook.mjs\"" } ] } ],
  "Stop":             [ { "hooks": [ { "type": "command", "command": "node \"<skills-dir>/waymark/scripts/stop-hook.mjs\"" } ] } ]
} }
```

  Verify: `echo {} | node "<skills-dir>/waymark/scripts/rule0-hook.mjs"` and `echo {} | node "<skills-dir>/waymark/scripts/session-hook.mjs"` each print JSON with `additionalContext`. `echo {} | node "<skills-dir>/waymark/scripts/tool-hook.mjs"` and `echo {} | node "<skills-dir>/waymark/scripts/stop-hook.mjs"` print nothing (they only answer when a check fires).
- **Coexistence mode:** `guest` or `skills-only` → register **none** of the hooks (the orchestrator's hooks own the turn). `waymark-leads` → all four, added after the other framework's; never remove or reorder its hooks.
- **Codex CLI:** `node "<skills-dir>/waymark/scripts/install-hooks.mjs" --agent codex` shows the plan for `~/.codex/hooks.json` **[ask]**; then re-run it with `--apply`. Tell the user to open `/hooks` in Codex and trust the four Waymark hooks, because Codex skips them until then (`adapters/codex.md`, `docs/adr/0009`).
- **Gemini CLI:** `node "<skills-dir>/waymark/scripts/install-hooks.mjs" --agent gemini` shows the plan for `~/.gemini/settings.json` (its event names: SessionStart, BeforeAgent, BeforeTool, AfterAgent, plus AfterTool for the pack with the edit's result) **[ask]**; then re-run it with `--apply`. A new Gemini session picks them up.
- **OpenCode:** `node "<skills-dir>/waymark/scripts/install-hooks.mjs" --agent opencode` shows the plan for `~/.config/opencode/plugins/waymark.js` **[ask]** (the plugin runs the same scripts on session.created, chat.message, tool.execute.before/after and session.idle); then re-run it with `--apply` and restart OpenCode.
- **Cursor:** `node "<skills-dir>/waymark/scripts/install-hooks.mjs" --agent cursor` shows the plan for `~/.cursor/hooks.json` (`"version": 1`; sessionStart, beforeSubmitPrompt, preToolUse, postToolUse, postToolUseFailure, afterAgentResponse and stop) **[ask]**; then re-run it with `--apply`. Cursor reloads the file on save and user hooks need no trust. Cursor has no instructions file: its session card brings the Rule 0 block (`adapters/cursor.md`, `docs/adr/0021`). Cursor also runs Claude Code's hooks from `~/.claude/settings.json`; Waymark's step aside there, so nothing runs twice.
- **Copilot CLI:** `node "<skills-dir>/waymark/scripts/install-hooks.mjs" --agent copilot` shows the plan for `~/.copilot/hooks/waymark.json` (`"version": 1`, flat entries under Claude Code's event names: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop) **[ask]**; then re-run it with `--apply`. User hooks need no trust; a new session picks them up. Copilot drops a command hook's UserPromptSubmit output, so the card and the block carry Rule 0 (`adapters/copilot.md`).
- **Kiro:** `node "<skills-dir>/waymark/scripts/install-hooks.mjs" --agent kiro` shows the plan for `~/.kiro/hooks/waymark.json` (`"version": "v1"`; SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, each with `--event`) **[ask]**; then re-run it with `--apply`. Global hooks are documented for Kiro CLI V3; the IDE documents only the workspace's `.kiro/hooks`. Kiro answers with plain text and exit codes, and no hook carries the reply, so the Cierre and a question asked in the chat are not checked there (`adapters/kiro.md`).
- **Antigravity:** `node "<skills-dir>/waymark/scripts/install-hooks.mjs" --agent antigravity` shows the plan for a hook named `waymark` in `~/.gemini/config/hooks.json` (SessionStart, PreInvocation, PreToolUse, PostToolUse, Stop, each with `--event`; the user's named hooks stay) **[ask]**; then re-run it with `--apply`. No hook carries the prompt or the reply, so the Cierre is not checked there and the choice window is `ask_question` (`adapters/antigravity.md`).
- **Other agents:** the same scripts with `--agent <name>`, once that agent has a module in `scripts/agents/` (`adapters/generic.md`). Until then only the pointer block applies, with no hooks: say so in the report.
- `node "<skills-dir>/waymark/scripts/waymark.mjs" check` offers `install-hooks` for every agent found without Waymark's hooks, Claude Code included.
- Report it under *Archivos modificados* (`settings.json — hook Rule 0 agregado`).

**7.3 Sync.** Run:

```bash
node "<skills-dir>/waymark/scripts/sync.mjs"
```

It indexes installed skills (this agent's, other agents' skill folders such as `~/.cursor/skills` or `~/.agents/skills`, plugins and project skill folders, each with its path) and MCP servers into `skill-registry.md`, applies the department precondition to tool skills and creates the private layer folders. Show its output. Entries marked `auto: true` or under *Unassigned* are third-party skills it found; report them, do not fix them silently. In `waymark-leads` this is how the other framework's skills become available as *Fallback*. Afterwards `node "<skills-dir>/waymark/scripts/waymark.mjs" check` reports when skill folders changed, and `node "<skills-dir>/waymark/scripts/waymark.mjs" sync` re-runs it.

**7.4 Orchestrator registry (`guest` only).** Run the orchestrator's refresh so it indexes the copied skills (`coexistence.md` §4: its own refresh command). Check that its registry now lists `waymark` and the `dept-*` skills and report it. If it does not scan `<skills-dir>`, tell the user where it scans and ask **[ask]** before copying the skills there too. Never edit its registry by hand.

## 8. Verify and report

1. Confirm these exist: `<skills-dir>/waymark/SKILL.md`, `<skills-dir>/dept-frontend/SKILL.md`, `<skills-dir>/ui-build/SKILL.md`, `~/.waymark/agent.md`, `~/.waymark/preferences.md`, and the block in `<instructions-file>` (in `guest`: `~/.waymark/coexistence.md` and the orchestrator's registry listing the skills, instead of the block).
2. Tell the user that skills load at session start: **they must restart the agent** (new session).
3. Run `node "<skills-dir>/waymark/scripts/waymark.mjs" verify --install`: it compares every installed file with `waymark/MANIFEST.json` (sha256, offline), checks `waymark/skill-map.json` and `waymark/skill-registry.md` against what `sync` writes (they differ on every machine, so they are not hashed), and verifies `waymark/MANIFEST.json.sig` against the key in `waymark/ALLOWED_SIGNERS`. That works on a plain copy; in a git clone it also shows the release tag's signature. `--require-signature` makes anything but `signed by <maintainer>` fail the exit code. Anything it reports as changed, missing, extra or `BAD signature` means the install is not what was released: say so before going on.
   Optionally, with the user's yes, set up signing of their tasks: put the path of their ssh key in `~/.waymark/preferences.md` as `Signing key: <path>` (a public key works with ssh-agent), and add their public key to `~/.waymark/ALLOWED_SIGNERS` (git's allowed-signers format; several keys, each with `valid-after="YYYYMMDD",valid-before="YYYYMMDD"` if wanted; a revoked key goes in `~/.waymark/REVOKED_SIGNERS`, one public key per line). `node "<skills-dir>/waymark/scripts/waymark.mjs" sign` says whether the key signs without asking. Never read, print or copy the private key: only its path is written.
4. In the new session run `node "<skills-dir>/waymark/scripts/waymark.mjs" check` and offer, with the choice window, what it reports: reconnecting an agent whose instructions block changed, the hooks of an agent without them. Nothing pending → say so.
5. Smoke test for the new session: *"quiero crear un modal de confirmación"* → the agent must start its reply with the `Waymark → L<n> · dept-frontend` line, load `dept-frontend`, then use `ui-build`. In `guest`: the orchestrator's flow runs as before and loads `dept-frontend` from its registry, with no Waymark opener.
6. Report, listing **every file created or modified** (from §6 on), so the user knows what changed:

```
## Waymark installed
- Agents / paths: … (one per line)
- Version: <skills-dir>/waymark/VERSION
- Backup: ~/.waymark-backups/<date>/
- Skills: 17 copied · third-party removed: …
- Files modified according to INSTALL.md:
  - <instructions-file> — block added at the top / replaced (the rest intact)
  - ~/.waymark/agent.md — created / row added
  - ~/.waymark/{profile,preferences,subagents,projects}.md — created (they fill in as work happens)
  - …
- Moved to the private layer with your permission: …
- Coexistence: <framework> · mode … · adopted N · fallback N · resolved N · its files: unchanged   (only if §1.1 found another)
- MCP: registered … · skipped …
- engram: <version> · MCP in: … (the hooks use its CLI even when an agent has no MCP)
- Sync: … (skills of other agents: N) · Measure a task: node <skills-dir>/waymark/scripts/measure.mjs --turns a-b
- Pending: restart the agent and run the smoke phrase
```

## 9. Update

1. **Compare versions.** Read the installed `<skills-dir>/waymark/VERSION` (missing = older than 0.3.0) and the repository's. Same version → say it is up to date and stop unless the user insists. Otherwise show the user the `CHANGELOG.md` entries between both versions and wait for a yes **[ask]**.
2. Get the files (§2) and back up (§3) — always, because installed skills may have learned content. Update every agent where Waymark is installed (§1), unless the user names one.
3. For each skill folder: copy new and changed files, delete files the repository removed (only inside the 17 Waymark skills), but **merge** `## Learned rules`, `## Learned notes`, `patterns/`, `rules/` and `facts/`: keep the user's entries, add the repository's.
4. `~/.waymark/`: only create missing files or folders from the templates; never edit existing ones. Existing `projects/<slug>.md` files gain new template sections (e.g. *Work in progress*) the next time a task runs there; do not rewrite them now. From 2.0 project memory lives in `<project>/.waymark/` (docs/adr/0007): `node "<skills-dir>/waymark/scripts/waymark.mjs" check` reports the move per project; `node <skills-dir>/waymark/scripts/migrate-memory.mjs --all` shows the plan for every project (dry run) and `--apply` migrates (backup first, hash chain verified). The old location keeps working until 2.1.0. A memory.md that still holds *Solved problems*, *Gotchas* or *Decisions*: `check` offers `node "<skills-dir>/waymark/scripts/waymark.mjs" learned` (dry run; `--apply` on yes) to move them to engram (`docs/adr/0015`).
   `skill-map.json`: take every entry from the repository, then add back the installed entries the repository does not have (skills and MCP servers the user created or mapped, project skills).
5. Re-run §1.1: a framework or rules that `~/.waymark/coexistence.md` does not list yet → classify only those and ask **[ask]** (no such file yet and a framework found now → the §1.2 question: keep leading or become guest). `Mode: other-leads` from 1.5.0 → offer to switch to `guest`: remove Waymark's block and hooks (backup first).
6. Per mode: leading → replace the instructions block (§6.2) in every agent and re-run `install-hooks.mjs --agent <agent>` for each one (§7.2) from `~/.agents/skills/waymark/scripts`, so each has all its hooks and they point at the shared folder (an install from before `docs/adr/0017` registered them under `~/.claude/skills`; run `skill-links.mjs --user --apply` first, §5); `guest` → no block, no hooks, re-run the orchestrator's refresh (§7.4). Then run sync (§7.3).
7. Report with the same list of modified files as §8, plus `Version: <old> → <new>`.

## 10. Uninstall **[ask]**

1. `node "$HOME/.agents/skills/waymark/scripts/uninstall.mjs"` shows the plan for every agent: the hook entries that run Waymark's scripts (Claude Code, Codex, Gemini CLI, Cursor; Copilot CLI's and Kiro's `hooks/waymark.json`, removed whole when nothing else is in it; the `waymark` hook in Antigravity's `config/hooks.json`), Claude Code's status line (the one you had before comes back from `~/.waymark/statusline.json`), the OpenCode plugin, the marked blocks in each instructions file, and `skill-fit --restore` / `mcp-fit --restore` when they changed something. Re-run it with `--apply` after the user's yes **[ask]**: each file is backed up first to `~/.waymark-backups/<date>-uninstall/`; the rest of every file stays.
2. Remove `waymark`, `dept-*` and the six tool skills from §5 in `~/.agents/skills`, and their links (or older copies) in `~/.claude/skills`. Remove a link, never the folder it points to through it.
3. Restart each agent.
4. Ask whether to keep `~/.waymark/` (it is the user's memory; default: keep). A coexisting framework needs nothing: its files were never changed. In `guest`, re-run its registry refresh so it stops listing Waymark's skills.
5. MCP servers: list the ones the install registered and ask before removing any.

## 11. Replace an older Waymark (1.x) with 2.0 **[ask]**

For a machine with Waymark 1.x (the 17 skills copied in `~/.claude/skills`, memory in `~/.waymark/projects/`) that should end with a clean 2.0. Tell the user the plan first:

```
I found Waymark <version> (skills in ~/.claude/skills). I will:
1. Back up skills, instructions, hooks and ~/.waymark      → ~/.waymark-backups/<date>/
2. Remove the old version: the 17 skills, the block and Waymark's hooks in each agent (nothing else is touched)
3. ~/.waymark (your memory): keep it and migrate each project to <project>/.waymark (Recommended) · or start empty (it stays in the backup)
4. Install 2.0 (§1–§8): skills in ~/.agents/skills with links in ~/.claude/skills, the block and hooks in each agent, engram
```

1. **Detect** the installed version per agent: `<agent skills folder>/waymark/VERSION` (missing = older than 0.3.0). 2.0 or newer → §9 instead.
2. **Back up** (§3), adding each agent's hook file (`~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.gemini/settings.json`, `~/.cursor/hooks.json`, `~/.config/opencode/plugins/waymark.js`).
3. **Remove the old install:** §10 steps 1–2 in every agent, running `uninstall.mjs` from the clone of §2 (`<tmp>/waymark/skills/waymark/scripts/uninstall.mjs`). Merge nothing back: a clean 2.0 starts from the repository's skills. Learned rules the user wants kept stay in the backup; they move to engram later with `node "<skills-dir>/waymark/scripts/waymark.mjs" learned`.
4. **The private layer [ask]:**
   - **Keep (Recommended):** `~/.waymark/` stays. After step 5, `node "$HOME/.agents/skills/waymark/scripts/migrate-memory.mjs" --all` shows the move of each project's memory into `<project>/.waymark/` (dry run). On a yes, re-run it with `--apply`: backup first, hash chain verified.
   - **Start empty:** move `~/.waymark/` into the backup. §6.1 creates it again from the templates.
5. **Install 2.0:** §1–§8, from a clone of `main` (§2). The skills go to `~/.agents/skills` (§5). The hooks are registered from `~/.agents/skills/waymark/scripts` (§7.2), so they never run through a link.
6. **Verify** before the report:
   - `echo {} | node "$HOME/.agents/skills/waymark/scripts/rule0-hook.mjs"` prints JSON with `additionalContext`. The same through `"$HOME/.claude/skills/waymark/scripts/rule0-hook.mjs"` (the link) prints it too.
   - A new Claude Code session lists the Waymark skills (`/skills`).
   - Codex: trust the four hooks in `/hooks`.
   - `node "<skills-dir>/waymark/scripts/waymark.mjs" check` reports nothing pending.

