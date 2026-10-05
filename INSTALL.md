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

## 1. Detect the agent and its paths

Identify which agent **you** are, and **every other agent installed on this machine** (config folders such as `~/.claude`, `~/.codex`, `~/.cursor`, `~/.gemini`, `~/.config/opencode`, or the agent's CLI on the PATH). Waymark can be installed in all of them at once; they share one private layer, so work started in one agent can be resumed in another. For each agent, open `adapters/<agent>.md` from the repository (`claude-code`, `codex`, `cursor`, `gemini-cli`, `opencode`, or `generic` if none fits). It gives:

- `<skills-dir>` — user-level skills folder (e.g. `~/.claude/skills`)
- `<project-skills-dir>` — project-level skills folder (e.g. `.claude/skills`)
- `<instructions-file>` — global instructions file (e.g. `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`)
- how to register MCP servers

If the adapter marks a path as *verify*, check it against your own documentation or the filesystem before using it. Tell the user in one line per agent what you detected:

```
Agente: Claude Code · skills: ~/.claude/skills · instrucciones: ~/.claude/CLAUDE.md · capa privada: ~/.waymark
También encontré: Codex (~/.codex) · Cursor (~/.cursor)
```

**1.1 Orchestrators and other agent frameworks.** Before the plan, check whether another framework already governs each agent (e.g. gentle-ai): marked blocks in `<instructions-file>` that are not Waymark's (`<!-- <name>:<section> -->`), hooks in the agent settings that do not run Waymark scripts, orchestrator/persona/trigger skills, its own skill registry. Waymark is not an orchestrator: **if one is already installed, Waymark becomes its guest** (no hooks, no Rule 0 block; its skills and memory reach the orchestrator through the orchestrator's own registry and engram). Follow the repository's `skills/waymark/references/coexistence.md` §1–§4: read its sections, write each rule as one line and classify it (Adopted · Fallback · Resolved), and find how its registry is refreshed. **Never edit that framework's files.** Tell the user in one line:

```
Orquestador ya instalado: gentle-ai (bloques gentle-ai:*, hooks propios, registro .atl/skill-registry.md) → Waymark entra como invitado: sin hooks ni bloque, sus skills por el registro de gentle-ai, memoria por engram. No toco sus archivos.
```

Nothing found → the normal plan below; Waymark leads.

**1.2 Plan and confirm [ask].** Before downloading or touching anything, show the user the plan and wait for an explicit yes:

```
Voy a instalar Waymark así:
1. Skills (17)            → ~/.claude/skills/            (respaldo previo si ya existe algo)
2. Instrucciones generales → ~/.claude/CLAUDE.md          (bloque marcado arriba; el resto no se toca)
3. Capa privada            → ~/.waymark/             (fuera de .claude; sirve para cualquier agente y se completa sola)
4. Hooks              → ~/.claude/settings.json      (memoria del proyecto al iniciar sesión ~400 tokens; recordatorio por mensaje ~120 tokens, ~35 si la respuesta anterior ya siguió la rutina; frena una vez el primer mensaje al reanudar una sesión grande inactiva más de 1 h y lo pasa a la sesión nueva; avisa sin frenar cuando el contexto pasa de 300k; revisa comandos frágiles y el Cierre al terminar el turno)
5. Agentes: Claude Code (este) + ¿también Codex, Cursor…? (los que encontré; misma memoria compartida)
6. Te preguntaré antes de: quitar skills de terceros, mover contenido de tu archivo de instrucciones y registrar MCP.
```

Ask it with your **choice window** if the agent has one (Claude Code: `AskUserQuestion`), the plan in the question, options as buttons:
- **Instalar (Recomendado)** — this agent, as in the plan.
- **Instalar en todos mis agentes** — only if §1 found others; lists them.
- **Instalar aquí y conectar los demás** — only if §1 found Codex, Gemini CLI or OpenCode. This agent gets the full install; the others get only one marked line in their global instructions file ("if the project has `.waymark/`, read `.waymark/tasks.md` first"), with no hooks or skills in them: `node <skills-dir>/waymark/scripts/connect-agents.mjs` shows the plan, `--apply` writes it after a backup and registers them in `~/.waymark/agent.md`. After the install, `waymark.mjs check` reports each agent that appears later.
- **Cambiar algo** — the user says what (another folder, skip the hook, skip a step).
- **Cancelar**.

**§1.1 found an orchestrator →** the plan becomes the guest plan (items 2 and 4 disappear; a new step refreshes its registry) and the question offers, one question only:
- **Invitado de <framework> (Recomendado)** — skills + private layer; no block, no hooks; `<framework>` keeps its flow and loads Waymark's departments through its registry; memory through engram.
- **Waymark lidera, <framework> de respaldo** — full plan; its compatible rules adopted, its skills as fallback, turn conflicts resolved for Waymark (the user prefers Waymark's routine).
- **Solo skills** — skills + private layer; no registry step, no block, no hooks.
- **Cancelar**.

Then show the lists (Adopted · Fallback · Resolved) and let the user move any rule **[ask]**; they become `~/.waymark/coexistence.md` in §6.1 with `Mode: guest | waymark-leads | skills-only`.

Agents without a choice window: show the plan and end with *"¿Continúo?"*.

Use the real paths from the adapter. **Several agents chosen** → run §3–§7 once per agent with its own adapter (skills, instructions block, hook if supported, MCP in its own config), and §6.1 (private layer) only once. If the user says no or changes something (another folder, skip a step), adapt and show the plan again.

## 2. Get the files

Clone into a temporary folder (do not clone inside `<skills-dir>`):

```bash
git clone --depth 1 https://github.com/LiriRaid/waymark "<tmp>/waymark"
```

No git? Download `https://github.com/LiriRaid/waymark/archive/refs/heads/main.zip` and extract it. If the user gave you a local path to the repository, use that instead.

Requirement check: `node --version` must be 18 or newer (only `sync.mjs` needs it). If Node is missing, tell the user and continue; skip §7 and say so in the report.

## 3. Back up **[ask if anything exists]**

Create `~/.waymark-backups/<YYYY-MM-DD-HHmm>/` and copy into it whatever already exists of:

- `<skills-dir>/waymark`, `<skills-dir>/dept-*`, and the tool skills listed in §5
- `<instructions-file>`
- `~/.waymark/`

Report the backup path. If nothing exists, say "instalación limpia" and continue.

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

Copy every folder in the repository's `skills/` into `<skills-dir>`, replacing existing folders with the same name:

```
waymark  dept-product  dept-architecture  dept-frontend  dept-ux-ui  dept-backend
dept-data  dept-security  dept-qa  dept-devops  dept-devex
ui-build  ui-refine  ui-system  ui-audit  browser-verify  library-docs
```

Copy real files (no symlinks). If this is a reinstall and the user's installed copies have entries under `## Learned rules` / `## Learned notes`, or files in `patterns/`, `rules/`, `facts/` that the repository does not have, keep those entries: merge them into the new files instead of overwriting.

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
| `engram` | recommended: persistent memory across sessions (the instructions block uses it to search before re-reading and to save decisions) | `https://github.com/Gentleman-Programming/engram` — if the binary is missing, offer to install it following its README **[ask]**; register it with the adapter's command |
| stack-specific servers | only when the user works with that stack | entries in `skill-map.json` → `mcp` with a `stack` field |

The stack-specific entries shipped today are **examples** for Angular (`angular-cli`: `npx -y @angular/cli mcp`, `primeng`: `npx -y @primeng/mcp`). On a fresh machine the stack is usually unknown: skip them, and let `dept-devex` propose the right server later, when a project of that stack is detected (`waymark` §5).

**Framework servers only where their framework is used.** The user's MCP servers stay where they registered them (user scope, `.mcp.json`, local); nothing is moved or removed. A framework's server (Angular, PrimeNG, React, Vue, Tailwind, NestJS, Prisma…) is visible in every project, so in projects that do not use that framework the agent can waste calls on it and its names and instructions sit in context. `node "<skills-dir>/waymark/scripts/mcp-fit.mjs"` reads each known project's manifests (`package.json`, `Gemfile`, `pyproject.toml`, `composer.json`, `pom.xml`, `.csproj`…; none up to the repository root = no framework) and plans a permission deny rule (`mcp__<server>`) in that project's own `.claude/settings.local.json` (private, normally git-ignored) for each framework server it does not use, and lifts the rules it added when the project adopts the framework. Show the plan **[ask]**; on yes re-run it with `--apply` (it merges into the existing settings file with a `.waymark-bak` copy, never overwrites one it cannot parse, and never removes a rule the user wrote). Generic servers (`context7`, `engram`) are never blocked. Afterwards `waymark.mjs check` reports the same for the project it runs in (§7.2). Takes effect in the next session. Measured on Claude Code 2.1.287: a deny rule hides the server from tool search and drops its names and instructions from context (~120 tokens per server per request); the larger saving is the calls the agent no longer makes to the wrong framework.

**Skills you never use (Claude Code).** Every listed skill sends its name and description in every session. `scripts/skill-fit.mjs` reads the agent's own transcripts (offline) and, for skills you added (claude.ai synced skills, `~/.claude/skills`) with no invocation in 30 days, proposes `skillOverrides: "name-only"` in `~/.claude/settings.json` (still invocable by name; only the description leaves the listing), and `enabledPlugins: false` for plugins with no skill used. Waymark's own skills, the providers in `skill-map.json` and skills bundled with the agent are never touched; it needs 14 days of history; `--apply` after a yes (backup `.waymark-bak`), `--restore` lifts only its own entries. `waymark.mjs check` reports the plan's size (§7.2). Verified on Claude Code 2.1.286: `name-only` drops a synced skill's description from the listing.

**7.2 Hooks (installed by default): the four links of the chain** (`docs/adr/0008`). Four small local scripts, 0 tokens to run, one per link, the same for every agent:
- **Session start** (`session-hook.mjs`, also after `/clear` and a context summary): a capped digest (≤ 2,700 chars, usually ~400 tokens) of this machine's *Environment* and the project's memory, with the pointer to `.waymark/tasks.md`, so Recall never depends on the agent remembering to read it. With `coexistence.md` it also injects its rules (≤ 1,800 chars). When the last `waymark.mjs check` is older than a week, one line (~30 tokens, at most once a week) asks the agent to run it.
- **Each prompt** (`rule0-hook.mjs`): the Rule 0 reminder (~120 tokens, ~35 once the previous reply opened with `Waymark →`) and the task ID (`2026-10-02 · T3`, ~25 tokens). It takes a `git status` snapshot (≤ 1.5 s) so the end-of-turn hook knows every file the turn changed, and marks the turn open in `.waymark/open.json` (a turn that never ends still shows in `tasks.md`). It never changes the prompt.
- **Decision gate** (`tool-hook.mjs`, before shell commands and edits): every L1–L3 change to project files (edits, and shell commands that change files such as `git checkout --`, `sed -i`, `rm` or a redirect) is denied until the user was asked in the choice window in this task. A single way is confirmed there too. A turn routed Q is told once to re-route by invoking the owner department with args `L<n>`. The message asks for every decision that shapes the work in the same call and never offers browser verification (only when the user asks); the branch is the user's and is never pushed as a sub-decision. A reply with no routing line inside a task that has not closed keeps the task's routing.
- **End of turn** (`stop-hook.mjs`): a turn routed L1–L3 that changed project files must end with `## Cierre · <task ID>` (`Resultado`, `Evidencia`, `Aprendido`); the decision is the user's answer in the choice window, recorded as is. Everything it can observe is computed and recorded under `observed`: memory, procedure, gates after the last change with time and failure, the gate testigo's run, secrets found (where and kind, never the value), the chain, tests, browser, review, docs, branches, time.
  - What blocks (once) and what is only recorded and scored is one file, the catalog of testigos `skills/waymark/routine.json` (`docs/adr/0006`, `0012`). Each testigo executes instead of reading prose: when the agent ran no gate after its last code change, the hook runs the repo typecheck (memory.md *Quality gates* → package.json → tsconfig, 40 s, never the full build). Every testigo that applies blocks once; only the commit trailer and the chain are recorded (`docs/adr/0010`). `node waymark.mjs testigos [<task ID>]` re-runs the ones that execute.
  - Every task gets an automatic evaluation (✔/✘ per step, tokens, estimated quota from your own pairs: `calibrate.mjs "<task ID>" <percent>`) that the user sees as one line.
  - The record (with the agent's name) goes into the hash-chained `<project>/.waymark/provenance.jsonl`; a task with a commit keeps it whole as a git note on that commit (`refs/notes/waymark`) and a stub in the log (`docs/adr/0012`). The hook writes the task's *Work in progress* line from the Aprendido (≤200 characters) and regenerates `tasks.md` (`docs/adr/0007`). `node waymark.mjs tasks [<task ID>]` lists the records; `node waymark.mjs notes push` sends the notes to origin (only when you run it).
  - A turn routed Q in a project with memory leaves a short record with no task ID.

**On demand, not in the hooks:** `node "<skills-dir>/waymark/scripts/waymark.mjs" check` (read-only) reports, one line each, what is pending:
- a newer Waymark version (§9);
- skills changed since the last sync;
- MCP fit and skill fit (§7.1);
- memory still in `~/.waymark/projects/`;
- other agents not connected;
- a framework that appeared or vanished;
- a large idle session in the folder (resuming one after an hour re-writes its whole context).

The agent offers each item with the choice window. `waymark.mjs sync | mcp-fit | skill-fit | migrate | connect | install-hooks` run the matching script after the user's yes.

- **Claude Code:** `node "<skills-dir>/waymark/scripts/install-hooks.mjs"` shows the plan for `~/.claude/settings.json` **[ask]**, then re-run it with `--apply`. It makes a `.waymark-bak` backup first and never writes a file it cannot parse. It adds, updates (path, matcher) or de-duplicates only the entries that run `waymark/scripts/<hook>.mjs`; every other key and hook stays, and new entries go after the existing ones. Run it from the installed copy (`<skills-dir>`), never from a checkout of the repo, because it registers the path it runs from. The result is:

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
- **Gemini CLI:** `node "<skills-dir>/waymark/scripts/install-hooks.mjs" --agent gemini` shows the plan for `~/.gemini/settings.json` (its event names: SessionStart, BeforeAgent, BeforeTool, AfterAgent) **[ask]**; then re-run it with `--apply`. A new Gemini session picks them up.
- **OpenCode:** `node "<skills-dir>/waymark/scripts/install-hooks.mjs" --agent opencode` shows the plan for `~/.config/opencode/plugins/waymark.js` **[ask]**; then re-run it with `--apply` and restart OpenCode.
- **Other agents:** the same four scripts with `--agent <name>`, once that agent has an adapter in `scripts/agents/`. Until then the instructions block and the pointer line (`connect-agents.mjs`) apply; say so in the report.
- Report it under *Archivos modificados* (`settings.json — hook Rule 0 agregado`).

**7.3 Sync.** Run:

```bash
node "<skills-dir>/waymark/scripts/sync.mjs"
```

It indexes installed skills (this agent's, other agents' skill folders such as `~/.cursor/skills` or `~/.agents/skills`, plugins and project skill folders, each with its path) and MCP servers into `skill-registry.md`, applies the department precondition to tool skills and creates the private layer folders. Show its output. Entries marked `auto: true` or under *Unassigned* are third-party skills it found; report them, do not fix them silently. In `waymark-leads` this is how the other framework's skills become available as *Fallback*. Afterwards `waymark.mjs check` reports when skill folders changed, and `waymark.mjs sync` re-runs it.

**7.4 Orchestrator registry (`guest` only).** Run the orchestrator's refresh so it indexes the copied skills (`coexistence.md` §4; gentle-ai: `gentle-ai skill-registry refresh`). Check that its registry now lists `waymark` and the `dept-*` skills and report it. If it does not scan `<skills-dir>`, tell the user where it scans and ask **[ask]** before copying the skills there too. Never edit its registry by hand.

## 8. Verify and report

1. Confirm these exist: `<skills-dir>/waymark/SKILL.md`, `<skills-dir>/dept-frontend/SKILL.md`, `<skills-dir>/ui-build/SKILL.md`, `~/.waymark/agent.md`, `~/.waymark/preferences.md`, and the block in `<instructions-file>` (in `guest`: `~/.waymark/coexistence.md` and the orchestrator's registry listing the skills, instead of the block).
2. Tell the user that skills load at session start: **they must restart the agent** (new session).
3. Smoke test for the new session: *"quiero crear un modal de confirmación"* → the agent must load `dept-frontend`, print Waymark brief, then use `ui-build`. In `guest`: the orchestrator's flow runs as before and loads `dept-frontend` from its registry, with no Waymark opener.
4. Report, listing **every file created or modified** (from §6 on), so the user knows what changed:

```
## Waymark instalado
- Agentes / rutas: … (uno por línea)
- Versión: <skills-dir>/waymark/VERSION
- Respaldo: ~/.waymark-backups/<fecha>/
- Skills: 17 copiadas · de terceros eliminadas: …
- Archivos modificados según INSTALL.md:
  - <instructions-file> — bloque agregado arriba / reemplazado (resto intacto)
  - ~/.waymark/agent.md — creado / fila agregada
  - ~/.waymark/{profile,preferences,subagents,projects}.md — creados (se completan solos al trabajar)
  - …
- Movido a la capa privada con tu permiso: …
- Coexistencia: <framework> · modo … · adoptadas N · respaldo N · resueltas N · sus archivos: sin cambios   (solo si §1.1 encontró otro)
- MCP: registrados … · omitidos …
- Sync: … (skills de otros agentes: N) · Medir una tarea: node <skills-dir>/waymark/scripts/measure.mjs --turns a-b
- Pendiente: reiniciar el agente y probar la frase de humo
```

## 9. Update

1. **Compare versions.** Read the installed `<skills-dir>/waymark/VERSION` (missing = older than 0.3.0) and the repository's. Same version → say it is up to date and stop unless the user insists. Otherwise show the user the `CHANGELOG.md` entries between both versions and wait for a yes **[ask]**.
2. Get the files (§2) and back up (§3) — always, because installed skills may have learned content. Update every agent where Waymark is installed (§1), unless the user names one.
3. For each skill folder: copy new and changed files, delete files the repository removed (only inside the 17 Waymark skills), but **merge** `## Learned rules`, `## Learned notes`, `patterns/`, `rules/` and `facts/`: keep the user's entries, add the repository's.
4. `~/.waymark/`: only create missing files or folders from the templates; never edit existing ones. Existing `projects/<slug>.md` files gain new template sections (e.g. *Work in progress*) the next time a task runs there; do not rewrite them now. From 2.0 project memory lives in `<project>/.waymark/` (docs/adr/0007): `waymark.mjs check` reports the move per project; `node <skills-dir>/waymark/scripts/migrate-memory.mjs --all` shows the plan for every project (dry run) and `--apply` migrates (backup first, hash chain verified). The old location keeps working until 2.1.0.
   `skill-map.json`: take every entry from the repository, then add back the installed entries the repository does not have (skills and MCP servers the user created or mapped, project skills).
5. Re-run §1.1: a framework or rules that `~/.waymark/coexistence.md` does not list yet → classify only those and ask **[ask]** (no such file yet and a framework found now → the §1.2 question: keep leading or become guest). `Mode: other-leads` from 1.5.0 → offer to switch to `guest`: remove Waymark's block and hooks (backup first).
6. Per mode: leading → replace the instructions block (§6.2) and make sure both hooks are registered (§7.2; versions before 1.4.0 only had the Rule 0 one); `guest` → no block, no hooks, re-run the orchestrator's refresh (§7.4). Then run sync (§7.3).
7. Report with the same list of modified files as §8, plus `Versión: <old> → <new>`.

## 10. Uninstall **[ask]**

1. Back up (§3).
2. Remove from `<skills-dir>`: `waymark`, `dept-*` and the six tool skills from §5.
3. Remove the block between the `waymark` markers from `<instructions-file>`; leave the rest. Remove the hook entries that run `rule0-hook.mjs`, `session-hook.mjs`, `tool-hook.mjs` and `stop-hook.mjs` from the agent settings.
4. Ask whether to keep `~/.waymark/` (it is the user's memory; default: keep). A coexisting framework needs nothing: its files were never changed. In `guest`, re-run its registry refresh so it stops listing Waymark's skills.
5. MCP servers: list the ones the install registered and ask before removing any.
