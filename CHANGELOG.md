# Changelog

The installed version is in `<skills-dir>/waymark/VERSION`. When a newer version is published the agent offers the update; you can also say *"actualiza Waymark desde https://github.com/LiriRaid/waymark siguiendo su INSTALL.md"* (INSTALL §9).

## 2.0.0 (in progress) — a supply chain of the agent's work
Waymark is now a supply chain of the agent's work: every task goes through defined stages and comes out with a verifiable record of its inputs, the user's decision, the evidence, the gates and the commits it produced (README → *A supply chain of the agent's work*; `docs/adr/0001`, `0002`). **The user decides, never the agent:** the old "the agent still decides" is gone. Step 1 of 4:
- **The user decides every real decision, at any level:** whenever there are 2+ valid ways, the agent lists the optimal options in the choice window (files, risk, cost) and marks the recommended one, which may not be what the user needs; the user picks. The pre-tool hook denies the first L1–L3 edit of a prompt once when nothing was asked; the retry passes for a single real way (`Decisión: única (<why>)`) or a choice the user already wrote (`del usuario ("<their words>")`).
- **Task ID** `YYYY-MM-DD · T<n>[a-z]`: the per-prompt hook offers the ID for a new task and for a follow-up of the last one (~25 tokens); the Cierre heading carries it (`## Cierre · 2026-10-02 · T3`), and so do the task's commits (trailer `Waymark-Task: <id>`).
- **The Cierre is the task's record:** new `Resultado:` (hecho | parcial | bloqueado) and `Decisión: elegida … · descartadas …` at every level, checked by the end-of-turn hook against the choice-window answer or the user's words; a commit made in the turn without the trailer is flagged.
- **The chain:** the end-of-turn hook appends each closed task to `~/.waymark/provenance/<slug>.jsonl`: the inputs manifest (Waymark and agent version, model, MCP servers used, hashes of the instruction files), what the transcript proves (prompt, options and pick, files, commands, skills), the commits carrying its ID, the Cierre text and the claims it could not back (`unresolved`). Each line holds the hash of the previous one, so editing or deleting a past task breaks the chain. Step 2 moves the log into the project.
- **First real test of 2.0 (L2 in a real project, 1 attempt, ~4% of the 5-hour quota) closed the gaps it found:**
  - The turn was routed as a question (Q) and then edited 8 files; every check skips Q, so there was no decision gate, no Cierre check and no record. Now a Q turn about to edit a project file is stopped once to re-route, the last routing line of the turn wins, and the end-of-turn hook checks a Q turn with changes as L2.
  - Four decisions were taken mid-task without asking, one against the user's words. `Sub-decisiones:` in the Cierre lists each one (`preguntada | del usuario ("…") | no preguntada`); one taken alone is sent back to the user, and the claimed asked count must match the choice-window answers.
  - **The department is a link of the chain:** the owner named in the routing line must have been invoked in the session (test 7 declared one that never loaded), and the record keeps `department: { declared, invoked }`. README table: new *Department* row.
  - Replayed on that session, the end-of-turn hook now flags the routing, the missing Sub-decisiones and the missing code-review.
- **Second real test (L1 in a real project, 1 attempt, ~2% of the 5-hour quota):** the first record was written, but the evaluation still marked Recordar, Enrutar and Verificar, and the transcript showed a gap the evaluation missed:
  - **The output was incomplete.** The modal files were restored with `git checkout HEAD --` through the shell: no gate stopped it and the record listed only the spec written with Write. Now the per-prompt hook takes a `git status` snapshot and the end-of-turn hook records every file that changed by any tool; shell commands that change files go through the decision gate like edits.
  - **The decision gate is strict:** no change until the user was asked in this task; a single real way is confirmed in the choice window. The retry that used to pass let the agent apply two decisions before asking.
  - **Memoria and Procedimiento move to the Cierre**, checked against real reads. The opener is written after a thinking block, which Claude Code does not persist, so `Memoria: leída` without a Read and an unread procedure passed. The owner's `procedures.md` must be read before the first change.
  - **Gates in order:** a typecheck, lint or build after the last code change, tests after the last spec change (the typecheck had run before the last edit).
  - **Re-route by tool call:** a routing line written mid-turn is not persisted either, so a question that becomes a change re-routes by invoking the owner department with args `L<n>`.
  - Replayed on that session, the end-of-turn hook flags Procedimiento, Memoria and the typecheck order.
- **Third real test (L2 across FE + API with a migration, 1 attempt, ~5% of the 5-hour quota, 26 minutes):** the agent asked the scope before editing and read the procedure, and the record listed all 13 files across both repos. But six items stayed unresolved: three sub-decisions taken alone, a `curl` instead of a browser check, "pre-existing" failures never isolated, an inference "from the docs" with no docs call, and two fields missed because they were written in bold. 13 of the 26 minutes went to two whole-project typechecks of the API.
  - **The hooks generate the provenance** (`docs/adr/0004`): the end-of-turn hook computes what it can observe and records it under `observed`: memory searched, opened and saved; the procedure read before the first change; gates after the last change with time and failure; tests; browser attempts; code-review; docs consulted; clean-copy checks; branches; time and the slowest command. The Cierre shrinks to `Resultado · Decisión · Sub-decisiones · Evidencia · Aprendido`, and bold markers are ignored. It blocks for missing **actions**, not for missing text.
  - `mem_search` is denied once before the first change at L2+ (the note was ignored for 3 edits). The decision gate names the repo's branch and asks for the foreseeable sub-decisions in the same choice-window call. An inference from docs needs a docs call, and a "pre-existing" failure needs a `git worktree` copy or "no comprobado". `Sub-decisiones` split on `;` only outside parentheses and quotes.
  - **Gates: fast while working, complete once.** During the task, lint and the related tests of the touched files (`vitest related`, `jest --findRelatedTests`, both checked in the official docs); the whole-project typecheck and the build once per repo at the end. Stack profile: Prisma migrations are generated (`migrate dev --create-only` / `migrate diff --script`), never hand-written, and applied only with the user's yes.
- **Fourth real test (L1, 1 attempt, ~2% of the 5-hour quota, every decision taken by the user) → consolidation** (`docs/adr/0005`): the self-evaluation still listed four ✘, mostly wording, and the evaluation prompt cost about as much as the task. Stop adding checks:
  - **Three blocks only:** the decision (backed, no sub-decision alone), a gate after the last change, and the Cierre complete with its Aprendido **written** to the project memory. Browser, code-review, spec next to the code, docs, pre-existing failures, procedure, department, `mem_search` and the commit trailer become findings: recorded and scored, never blocked. The pre-tool hook no longer denies for the procedure or `mem_search`.
  - **Automatic evaluation per task** in the record: ✔/✘ per routine step, score, tokens and estimated quota (`WAYMARK_TOKENS_PER_PCT`, default 1.35M tokens per 1%, calibrated on 2.19M→2%, 7.66M→5% and 1.8M→2%). The user sees it as one line at the end of the turn, at 0 model tokens. "Evalúa tu trabajo" becomes an optional deep audit.
  - **Fixes:** a search with no match no longer counts as reading the procedure; the option the user picked counts as their words; a file that a commit leaves clean, with the same content, is not a change, and a shell command counts as a change only when git saw one.
- **Fifth real test (L2, ~2% of the quota) → one routine contract** (`docs/adr/0006`): the automatic evaluation appeared on its own and matched the manual one (4/7). But once browser, code-review, docs and build were only recorded, the agent skipped them. And the self-evaluation guide still required fields the opener no longer asked for, which is why fixes kept "breaking" other steps.
  - **`skills/waymark/routine.json`** is the only definition of the routine: per step, the levels, the condition and whether it blocks or is recorded. The end-of-turn hook enforces and scores from it; the instructions block quotes each blocking step (a test fails on drift); the self-evaluation guide is now a deep audit of the record with no rubric of its own.
  - **The user's choice:** block on the decision, a gate after the last change, the Cierre with its Aprendido written, and at L2+ `mem_search` (with engram), code-review and the build with code (`Build: no (<why>)` when there is none), plus docs behind an inference from docs. Record the procedure, the browser, the spec near the code, pre-existing failures and the commit trailer.
  - The evaluation scores only the steps that applied (a label with several steps passes only if all pass). The quota calibration lives in the contract (`tokensPerQuotaPct`).
- **Project memory lives in the project** (`docs/adr/0007`, the user's choices on 2026-10-03): `<project>/.waymark/` holds `memory.md`, `provenance.jsonl` (moved byte for byte, so the chain still verifies), a generated `tasks.md` (in progress, pending, next step, done with result and routine score) and a `README.md`. It is local, excluded through `.git/info/exclude`, and plain Markdown/JSONL, so Codex, Cursor or a new session can answer "which task am I on, what is missing, what was completed" from that folder alone.
  - **One resolver** (`projectHome` in `provenance.mjs`) is used by every hook. It walks up to the nearest `.waymark/memory.md`, as git finds `.git`. The old `~/.waymark/projects/<slug>.md` is a bridge until 2.1.0, and the session hook offers the move once per project.
  - **`migrate-memory.mjs`** (`--project <path>` or `--all`) is a dry run by default; `--apply` writes. It backs up first, verifies the chain after the copy, writes the exclude line, leaves a `Moved:` stub, and points the `projects.md` row to the new file. It never overwrites.
  - **`tasks.md` is generated** by the end-of-turn hook and the agent never edits it, so it cannot drift from the record. The agent still writes its *Work in progress* line in `memory.md`.
  - **Other agents find the folder** through the Waymark block in their user-level instructions file; no tracked file of the project changes. engram keeps a task index: `mem_save` with `topic_key waymark/tasks/<slug>`, a new `Índice` step that is recorded, not blocked.
  - Edits to `<project>/.waymark/` are Waymark's own files: no decision gate, and they are not counted as project changes.
  - **`tasks.md` is short** (gate test: a new agent read ~90k characters for a ~6k answer). Tasks are the *Work in progress* lines whose task ID heads the line, shown as `ID · en curso | pendiente · paso · próximo` (≤ 300 characters each, the last `NEXT` / `Pendiente:` marker wins). The other lines are counted as notes. A memory without task IDs shows its `Task` / `Next` lines. The whole file stays within ~3,000 characters by dropping the oldest done rows. Old lines can move to `.waymark/history.md`; nothing is deleted.
  - **The last closed task, for any agent:** `tasks.md` has *Last closed* with that task's Resultado, Decisión, Sub-decisiones, Evidencia and Aprendido (~220 characters each), its evaluation (with the ✘ steps), and a pointer to its full record in `provenance.jsonl`. Another agent asked "¿por dónde voy?" finds it there.
  - **A turn that never ends still shows:** the per-prompt hook writes `.waymark/open.json` (task ID, request, time) and the end-of-turn hook removes it. When the quota runs out mid-task, `tasks.md` lists it under *Started, not closed*.
- **Other agents connected from one install:** `connect-agents.mjs` (dry run by default, `--apply` backs up first) writes one marked line (`<!-- waymark:pointer -->`) in the global instructions file of each agent found: Codex `~/.codex/AGENTS.md`, Gemini CLI `~/.gemini/GEMINI.md` and OpenCode `~/.config/opencode/AGENTS.md`. The line is "if the project has `.waymark/`, read `.waymark/tasks.md` first". It registers them in `~/.waymark/agent.md` and installs nothing in them. The session hook offers it once for each agent found and not connected. When an orchestrator already governs that agent (another framework's marked blocks, such as gentle-ai), Waymark joins as its guest. The pointer goes in as Waymark's own block, which is not Rule 0, and the orchestrator's blocks are never touched. The registry row says `invitado de <framework>`.
- **Quota calibration from your own pairs** (step 2c):
  - The record splits a task's tokens into new, cache writes, cache reads and output.
  - After a task, `calibrate.mjs "<task ID>" <percent>` stores the % it really used, per model, in `~/.waymark/calibration.jsonl`. `--list` shows the pairs.
  - With 1–2 pairs, the estimate uses their mean tokens per 1%. With 3+ pairs that have a token split, it weighs new and cached tokens apart. Without pairs it uses the contract's default.
  - The evaluation says which estimate it used (`quotaBy`).
  - First real pair: Opus 5.5, 7.12M tokens = 9%, about 0.79M per 1% (the default assumed 1.35M).
- **Work in progress is one line per task, headed by its task ID** (template, `learning.md`, bootstrap). A new memory had written the old `Task:` / `Next:` lines, and `tasks.md` could not tell its task apart from the notes.
- **Contract refinements from real test 2.0-6** (`routine.json`):
  - **Asked late:** a sub-decision marked `→ preguntada tarde` (asked after the change it decides) passes the block, because it cannot be undone, but Decision is ✘ in the evaluation and the record. If a choice-window question came after the first change and no item says *tarde*, it is recorded as a finding.
  - **Red claims:** a claim of red (*rojo*, *habría fallado*) needs a test run before the first code change or in a clean `git worktree`, or it must be written as *inferida*. The new `red` step is recorded and shares the Tests label.
  - **Angular UI:** a `.ts` with a sibling `.html` counts as UI (Angular 20+ names drop `.component`), so the browser step applies.
- **Step 3a: one agent-agnostic core, hooks only for the chain** (`docs/adr/0008`):
  - **The four hooks hold only the four links:**
    - session start: the memory digest and the pointer to `tasks.md`;
    - each prompt: the task ID, `open.json` and the reminder;
    - pre-tool: the decision gate;
    - end of turn: the Cierre check, the record and `tasks.md`.
  - **Everything else is one on-demand command:** `node <skills-dir>/waymark/scripts/waymark.mjs [check | sync | mcp-fit | skill-fit | migrate | connect | install-hooks]`. `check` only reports what is pending:
    - a newer version;
    - skills changed since the last sync;
    - MCP fit and skill fit;
    - memory still in the old location;
    - unconnected agents;
    - a framework that appeared or vanished;
    - a large idle session in the folder.
  - **A weekly pointer:** the session hook adds one line asking the agent to run `check` when the last check is older than a week, at most once a week.
  - **Removed:** the resume guard, the pending-prompt hand-over and the fragile-command checks. Each only worked by intercepting a prompt or a tool call. Their rules stay as text in `protocol.md` and `dept-qa`.
  - **Removed:** dead code (`checkEdit`) and the skill-fit plan cache.
  - **One adapter per agent:** `scripts/agents/<name>.mjs` holds the transcript reader, the pre-tool input mapping, the output shapes, and the instructions file and session folder. The hooks take `--agent <name>`, `claude` by default, so existing registrations keep working. Codex is step 3b.
  - **`install-hooks.mjs` replaces the manual merge:** it shows a dry-run plan, and `--apply` makes a backup first. It adds, updates or de-duplicates only Waymark's own entries and registers nothing in guest or skills-only mode.
  - **The record says who did the work:** each record carries `agent`, and `tasks.md` shows it next to the ID (`T4 · codex`).
  - **Questions leave a trace:** a turn routed Q in a project with memory gets a short chained record with no task ID (`kind: "Q"`), so it never takes a `T<n>`. `tasks.md` shows *Preguntas (Q) desde el último cierre: N*.
- **Step 3b: the Codex adapter** (`docs/adr/0009`):
  - **Codex CLI runs the same four hooks:** `install-hooks.mjs --agent codex` writes them to `~/.codex/hooks.json` (matcher `Bash|apply_patch`, `commandWindows`). You trust them once in Codex's `/hooks`.
  - **Rollout reader** (`agents/codex.mjs`): it turns the rollout into the core's lines:
    - prompts, assistant text and commands with their exit codes;
    - file changes and MCP calls;
    - tokens per response, model and version.
  - Checked against the 37 local rollouts (codex 0.115–0.160): 499 prompts, 2,266 commands and 1,806 file edits, with no failure.
  - **Skills in Codex:** reading a skill's `SKILL.md` counts as invoking it. The reminder and the gate tell Codex the absolute skills path.
  - **Decisions without a choice window:** `request_user_input` counts when Codex has it (Plan mode). Otherwise, a turn that ended with a question in the chat plus the user's reply count as one decision (`source: "chat"`).
  - **Steps an agent lacks do not apply:** each adapter lists them (`lacks`; Codex: code-review). They are recorded as `na`, never block and do not count in the score.
- **Step 3c: fixes from the real Codex → Claude test** (`docs/adr/0010`, all the user's rules and picks):
  - **Every routine step that applies must pass:** procedure, engram index, browser, spec next to the code, red claims and pre-existing claims now block once like the decision and the gate. Only the commit trailer stays recorded, because fixing it means rewriting a commit.
  - **The user owns the branch and the browser.** The gate no longer pushes the branch, and the end-of-turn hook ignores a branch listed as a sub-decision. The browser check is offered in the first choice window, with a test user + Playwright when there is a login or OTP. Navegador fails only if it was never offered, or accepted and not done; `Navegador: omitido (usuario: "<option picked>")` passes.
  - **Decisions:** every decision that shapes the work goes in the first choice window. A later question that only confirms is `→ confirmada` and passes. `preguntada tarde` is kept for a work decision asked after applying it.
  - **Pre-existing failures are checked at that moment** (`git worktree` or `no comprobado (<why>)`). The reminder says so, and the block says how.
  - **Quota:** while a model has fewer than 3 calibration pairs, the end-of-turn line asks for the real % with the exact `calibrate.mjs` command.
  - **Routing:** `Waymark → L0|Q` counts as a question. A reply with no routing line inside a task that has not written its Cierre keeps the task's routing. Before, a Codex reply in the chat opened an L0 turn and skipped the gate.
  - **Codex:** every question line of the last message counts as a decision asked in chat, not only the last one.
  - **Replay of the real Codex rollouts** found two more gaps, now fixed:
    - Codex's default-mode choice window, `request_user_input_async`, counts once the user answers, through their next message. The options that message names are taken as picked. A call Codex sent with bad arguments never counts.
    - Questions written in the chat count from every message after the turn's last action, so a closing summary without "?" no longer hides them.
    - Before these fixes, the inherited L2 gate would have denied an edit after the user had already decided.
  - **The gate no longer reads a ">" inside quotes, a heredoc body or a PowerShell here-string as a redirect.** Before, `node -e "…x=>{…}"` was gated as a file change.
  - **Test A fixes** (`docs/adr/0011`):
    - **Browser verification runs only when the user asks.** Waymark never offers or recommends it, there is no Navegador step, and the departments, stacks and UI skills say so. It cost many tokens and misread screens.
    - **No secrets in the chained log.** A record keeps only the picked option labels; a typed answer is stored as `(respuesta escrita, N caracteres)`. Passwords, tokens and keys are masked in prompts, commands and the Cierre. A test password that reached a record was removed, and the chain was recomputed.
    - **False ✘ removed:**
      - `Decisión` continues on the next lines, and a quoted multi-select answer counts.
      - Sub-decisions split on ` · `.
      - `→ única (<why>)` marks a technical step with one real way.
      - `memory.md` written by any tool counts.
      - A follow-up that applies the review's findings needs no second review.
    - **Turns counted right.** The hooks read back until the turn's prompt is in view; a pasted image of megabytes pushed it out before. A turn resumed by a background notification counts from the last close. A recorded 22% turn was really ~2%.
    - **Tasks outside the project** (install, cleanup) are recorded in the session's project.
  - **Re-test A:** the task scored 9/10 at ~5% (T2d was ~17%), and its follow-up 7/7 at ~1.4%. The browser was never offered and the branch never asked. Two fixes came out of it:
    - The sub-decision block names the honest ways out, with an example: answered in the choice window → `preguntada`; one real way → `única (<why>)`; otherwise ask now.
    - A Cierre counts only as a heading at the start of a line, and a turn with no project change is recorded only when it was routed L1–L3. Before, a Q answer that named `## Cierre` inside a sentence was checked as a closed task.
  - **Sonnet 5.5 test** (three tasks, ~7% of the quota for ~6.1M tokens, ≈0.87M per 1%, about the same as Opus per token). The fixes:
    - **Background agents:** a skill or agent still running in the background holds the close, with no block and no record. The task closes in the notification's turn. A background shell command is never waited for. Before, the hook judged the task while its code-review ran and marked Cierre and Build ✘.
    - **Subagent tokens** (`<session>/subagents/*.jsonl`) are added to the turn's usage.
    - A quote of the user's fragments joined with "…" counts. "Docker" is no longer read as "docs".
    - A command that writes `.waymark/` is not a gate.
    - **New marker** `→ propuesta (<what>)` for what was named but not applied.
    - **No invented rules:** a user rule or preference exists only where it is written (their message, `memory.md`, `preferences.md`). The agent cites it or asks; the agent had claimed a backup rule the user never set.
    - The time the choice window waits for the user is recorded as `userWait`, outside the agent's minutes and the slowest step. A question left open overnight made a 2-minute turn read 432 minutes.
  - **tasks.md:** `próximo` keeps every pending part in order (the last `Pendiente:` used to win, and "paso 2" was lost). A marker inside quotes is text. `open.json` records the agent, so a turn shows "started in codex".
- **Step 3e-1: testigos, one decision, secrets** (`docs/adr/0012`, all the user's picks). The 3c tests kept producing false ✘ from reading the agent's prose; now each check executes:
  - **`routine.json` is the catalog of testigos:** each one states its `claim` and returns ✔ / ✘ / not applicable with its evidence. New testigos: **Secretos** (blocks) and **Cadena** (recorded). `node waymark.mjs testigos [<task ID>]` re-runs the ones that execute: chain, commit + trailer, secrets in the task's commits, typecheck now.
  - **One decision:** the user's answer in the choice window, recorded as is with its position (before or after the task's first change). ✔ when the first answer came before the first change; a later question is recorded and does not count against it. `Decisión` and `Sub-decisiones` leave the Cierre, along with their markers (`confirmada`, `preguntada tarde`, `única`, `propuesta`, `del usuario`). An edit the gate denied is not a change.
  - **The Cierre is `Resultado · Evidencia · Aprendido`**, plus optional exception lines: `Tests: no (…)`, `Build: no (…)`, `no comprobado (…)` and `Secretos: no (…)`.
  - **Gate testigo:** the exit of the agent's last gate after its last code change. With none, the hook runs the repo typecheck: memory.md *Quality gates* → package.json `typecheck` with the lockfile's manager → `tsc --noEmit` when TypeScript is installed. The limit is 40 s, the whole process tree is killed on timeout, and the hook never runs the full build. A failing gate now blocks once. It no longer applies when no code changed.
  - **Secrets testigo:** looks for unambiguous formats (PEM private key, AWS, GitHub, `sk-`, Slack, JWT, Google) in memory.md when the turn wrote it, in `mem_save`, in the lines the task added (untracked files whole) and in its commits. It blocks once and names where and the kind, never the value. Every string of the record is masked for those formats too.
  - `tasks.md` → *Last closed*: `Decisión` shows the user's recorded picks.
  - Replayed on three real tasks of the earlier tests, the false Decision ✘ from prose parsing are gone.
- **Hook tests in the repo:** `node --test tests/*.test.mjs` (no dependencies, temporary `WAYMARK_HOME`).
- **Fix:** `protocol.md` → *Closing report* was an empty, unclosed code block that turned *When stuck* into code; it now shows a full Cierre and the decision gate.
- **Fix:** a multi-select answer in the choice window joins labels with "," (no space); the record no longer lists chosen options as discarded.

## 1.9.0 — evidence labels that match what happened
Ninth real test (1.8.0, an L1 bug in a real project: 1 attempt, no hallucinations, ~3% of the quota) still showed fields claiming more than was done, and two Waymark bugs:
- **Fix: no more false "no opener" notes.** The pre-edit opener note (1.8.0) fired three times in one task with the opener written: Claude Code does not persist reply text written after a thinking block. Removed; the `mem_search` note stays (tool calls are reliable).
- **Fix: `measure.mjs`** merges a prompt that got no response (recorded twice, or resent before any answer) into the next one, so it no longer counts as an attempt.
- **`Memoria: digest | leída | creada`**: `digest` when only the injected summary was used, `leída` only when the file was opened.
- **`Evidencia: observada <what you saw> | inferida de <source> (check: …)`**: a cause deduced from code or docs is *inferida*, with the user's check before the fix (replaces *hipótesis*).
- **`Cambia:`** in the opener: a visible behavior the user did not ask to change (order, layout, a default) is asked before it is implemented (it happened in tests 8 and 9).
- **Specs next to the changed code, at any level:** the end-of-turn hook asks for a `Tests:` field (a regression spec, or why not) when a spec sits next to the changed code, also at L1; `rojo→verde` must be backed by a spec edited and a test command run in the turn.
- **"Pre-existing" needs proof:** a Cierre that calls a failure pre-existing must say `comprobado en copia limpia de HEAD` or `previo: no comprobado (<why>)`.

## 1.8.0 — fewer wrong-direction attempts, checks that run themselves
Seventh real test (1.7.0): the largest cost is not the size of each step but attempts in the wrong direction. A small front-end bug cost ~9% of the 5-hour quota, ~6% of it in the API after the user had said "solo FE" (3 attempts, 14.1M tokens); an L2 with 1 attempt cost ~7%. Skipped checks repeated from test 6 (no browser-verify/code-review and no reason given, opener skipped in a turn, inferred evidence labelled "observed").
- **`Capa:`** in the opener: a layer the user named ("solo FE", "no toques la API") is binding; evidence pointing elsewhere → ask before leaving it.
- **Quick bug triage** (dept-qa) new step: a stale view after an action → check what reloads it (another tab via `window.open`, a cache in a service, a reused route) before blaming the backend. It was the real cause.
- **Sharper fields:** `Evidencia: observada <what you saw>` (code you read is not observed behavior); `Memoria: … · mem_search "<query>"` at L2+; `Navegador: … | no (requiere <physical action>; check: …)`; `Review: code-review <task's files> …` (a review without paths reviewed someone else's changes).
- **Cierre check** (`stop-hook.mjs`, Stop): a turn routed L1–L3 that changed project files must end with the Cierre; at L2+ `Navegador`/`Review` name browser-verify/code-review or say why; otherwise the agent is asked once to complete it.
- **Pre-tool checks** (`tool-hook.mjs`, now also on edits): recursive `grep`/`find` that walks `node_modules` is denied with the fix (hung 120 s, four times); an edit in an L1–L3 turn with no opener found gets a one-line note. Not a denial: Claude Code does not persist reply text written after a thinking block (checked on 2.1.286), so the transcript cannot prove the opener is missing.
- **Context notices:** the resume guard (150k tokens + 60 min idle, unchanged) now saves the stopped prompt and a new session in the same folder within 30 min takes it over, so nothing is retyped. While a session is active nothing is blocked: past 300k tokens of context (and every 200k more) a notice shown only to the user (`systemMessage`, 0 model tokens) says a new task is cheaper in a new session.
- **Claims checked against tool calls** (eighth real test, on 1.8.0-dev: the Cierre passed the format check while declaring a procedure never read, "sin infra" next to an existing spec, "Navegador: no (requiere login)" without trying, which is how a stuck tooltip reached the user, and "Review: omitido (revisión propia)"). `stop-hook.mjs` now requires the Read of the declared `procedures.md`, no spec next to the changed files for "sin infra", a real browser attempt when UI files changed (L2+), `code-review` when code changed (L2+; docs/config-only exempt) and a `mem_save` for "engram: guardado". `tool-hook.mjs` adds a note before the first L2+ edit when engram is available and no `mem_search` ran. Replayed on that session: it flags the spec, the missing browser attempt and the missing code-review.
- **The user can skip a check, for one task:** "no hagas tests", "sin navegador", "no corras code-review" → `omitido (usuario: "<their words>")` in that Cierre field and in the task's *Work in progress* entry. The end-of-turn hook accepts it only when those words are in the user's messages (prompts are persisted reliably; accents and case ignored); the next task, or "ahora sí", returns to the defaults (build, specs, unit tests, browser, code-review).
- **Pre-existing failures proven without touching the user's work:** a clean copy of HEAD (`git worktree add <tmp> HEAD` → rerun → remove) instead of `git stash`, which can lose the staged state; not allowed to run it → "no comprobado (sin permiso para <command>)" without retrying. `tool-hook.mjs` denies `git stash` (not `list`/`show`) with that method.
- **Self-evaluation guide in the repo** (`references/evaluation.md`): aligned with the current fields (Copia, Capa, mem_search at L2+), a "declared ≠ done" rule and a *Declaraciones sin respaldo* line; the local `~/.waymark/evaluation.md` becomes a pointer, so it no longer goes stale.
- **`measure.mjs`:** background-task notifications are no longer counted as prompts (they inflated attempts); a shared `transcript.mjs` reads transcripts for the hooks and `measure.mjs`.

## 1.7.0 — fewer tokens per session and per prompt
Measured in a real 500k-token session: resuming it after an hour idle cost 502k tokens of cache writes (8% of a 5-hour quota) for a one-line message; the Rule 0 reminder was re-sent in full on every prompt; the skill listing (Waymark's and the user's unused ones) is paid in every session.
- **Resume guard** (`rule0-hook.mjs`): reads the session transcript; with ≥ 150k tokens of context and ≥ 60 min idle (the prompt cache expired), it stops that one prompt (0 tokens; the user sees why) and suggests a new session or `/compact`; resending continues. `WAYMARK_RESUME_TOKENS` / `WAYMARK_RESUME_MINUTES` (0 = off).
- **Adaptive reminder:** the full Rule 0 reminder (~120 tokens) only when the last reply did not open with `Waymark →`; otherwise one line (~35).
- **Shorter triggers:** the 17 Waymark descriptions went from 8,558 to 4,407 characters (~1,000 tokens per session); procedural notes moved to the bodies they already lived in; templates and the devex procedure cap them at ~300 characters.
- **Skill fit** (`skill-fit.mjs`, Claude Code): skills you added (claude.ai synced, `~/.claude/skills`) with no invocation in 30 days → `skillOverrides: "name-only"` (still invocable); plugins with no skill used → `enabledPlugins: false`. Plan by default, `--apply` after a yes, `--restore`; never Waymark's skills, `skill-map.json` providers or bundled skills; needs 14 days of history. The session hook computes it in the background and offers it at most once a month. Verified: `name-only` drops a synced skill's description from the listing.
- **Token economy** (`protocol.md`): small tool outputs, sub-agents are not free, `/compact` is safe with L3 checkpoints, new session over resuming a large idle one.
- **`measure.mjs`:** new *Ctx* column, the context each prompt started with, to see growth per prompt.

**Sixth real test (measured on 1.7.0-dev): L1 593k tokens, 1 attempt (~1% of the 5-hour quota); L2 1.7M + a 572k second attempt.** ~95% is cached context re-read on every response, so the levers are fewer round trips and fewer attempts. The fields the agent skipped become checkable:
- **`Copia:`** in the opener when the ask is "like X": only the properties the user named (the second attempt copied X's whole rule).
- **`Procedimiento: <section> (procedures.md:<line>)`**: shows the section was read, not just named.
- **Cierre:** `Aprendido` quotes the rewritten *Work in progress* line (never "ninguno"); L2+ `Tests: rojo→verde <spec> | sin infra (<proof>)`, `Navegador: browser-verify <result> | no (<what failed when tried>)`, `Review: code-review <findings> | omitido (<why>)`.
- **Batch independent tool calls** in one response (instructions and both reminders): each response re-reads the whole context.
- **`mem_search`** only at L2+ or for a topic the injected digest lacks (the digest already covers L1).
- **Inline-script guard** (`tool-hook.mjs`, PreToolUse): denies an inline `node -e` with backticks, `${` or regex escapes (mangled by shell quoting, twice in real tests) and asks for a script file; `# waymark:allow` skips it.
- **Angular stack:** `ng build --configuration development` as the L1 compile check (templates included) instead of the full build.
- The instructions block's index is one line instead of a table (same entries).

## 1.6.0 — guest mode, third-party skills, one attempt per task (measured)
Changes accumulate on `develop` and reach `main` in one release, so installs see one update notice per release instead of one per change.

**Guest mode: Waymark adapts to whoever arrived first.** A real install next to gentle-ai showed that 1.5.0's `other-leads` still competed: the same Rule 0 block (only moved below) and Waymark's hooks kept claiming the turn. Waymark is not an orchestrator, so it now fits inside one:
- **Orchestrator already installed → `guest`** (recommended): no Waymark hooks, no Rule 0 block. The skills are registered through the orchestrator's own registry (gentle-ai: `gentle-ai skill-registry refresh`, INSTALL §7.4) and project memory travels through engram (`topic_key waymark/<slug>/…`).
- **Departments work without the block:** each `dept-*` runs a *Guest entry* (recall project memory, apply its rules and one procedure, reply in the orchestrator's format, update memory) when no Waymark block is in context.
- **Waymark first, orchestrator later → `waymark-leads`:** the session hook asks once whether to keep leading (its skills become *Fallback* via `skill-registry.md`) or step down to guest; when the listed orchestrator's markers disappear it offers the full install back.
- `other-leads` from 1.5.0 is read as `guest`; updates offer to remove the block and hooks it left.

**One attempt per task, measured.** A task costs *attempts × cost per attempt*; the four real tests went from ~20 messages per task to 1–2. This release closes the gaps that still cost attempts and adds the way to prove it:
- **Pedido · Captura** (opener): the request in the user's terms and, per image, the screen, element and state it marks; two readings → one question before editing. The one second attempt in the tests was the right fix on a misread target.
- **Third-party skills are used:** `sync.mjs` indexes other agents' skill folders (`~/.cursor`, `~/.codex`, `~/.agents`, Gemini, OpenCode) and project skill folders, guesses each one's capability, records its path (agents read and follow that `SKILL.md`), lists the six replaced community skills as *Replaced (not used)* and drops uninstalled auto entries. The session hook refreshes the registry in the background when skill folders change.
- **L3 checkpoints:** the plan lives in the task's *Work in progress* (`✔1 · ▶2 · 3`, next gate, *Descartado*) so a compaction or a new session resumes from disk instead of guessing (`protocol.md` → *L3: plan as checkpoints*).
- **Memory hygiene:** the injected memory is labelled *pointers, not facts* (the code wins and the entry gets fixed); *Work in progress* older than 14 days is flagged; entries record `decision ← evidence`; stale *Solved problems* are deleted; the project file is the source of truth over engram (`learning.md` §7).
- **Decision chain:** a fixed hand-off line between departments (`hecho · necesita · evidencia · abierto`, `protocol.md`).
- **Framework MCP servers only where the framework is used:** your servers stay registered where they are (nothing is moved or removed). `mcp-fit.mjs` reads each known project's manifests (none up to the repository root = no framework) and adds a deny rule (`mcp__<server>`) to that project's `.claude/settings.local.json` for each framework server it does not use (Angular, PrimeNG, React, Vue, Tailwind, NestJS, Prisma, Rails, Django…), lifting only its own rules when the project adopts the framework; `--apply` after a yes merges with a backup and never touches a file it cannot parse. Measured: the rule hides the server from tool search and its names/instructions from context (~120 tokens per server per request) and stops calls to the wrong framework. The session hook offers it per folder, at most once a week. Docs and memory servers are never blocked.
- **`measure.mjs`:** per prompt, responses, tool calls, images, new vs cached input, output and sub-agent tokens, the fixed context at session start, and attempts for a range of prompts. Responses streamed over several transcript lines are counted once (earlier ad-hoc counts summed them 2–3×).

## 1.5.0 — coexistence with other agent frameworks
A real install met gentle-ai (persona, engram protocol, SDD orchestrator, review triggers) and could only offer "skills only" or "full install with conflicting rules". Now Waymark adapts instead of competing:
- **Detect and classify** (INSTALL §1.1, `references/coexistence.md`): every rule of the other framework becomes *Adopted* (Waymark follows it), *Fallback* (its skill backs a capability, or *When stuck*) or *Resolved* (same-moment conflict, per mode).
- **Who leads [ask]:** `waymark-leads` (recommended), `other-leads` (block below theirs, no opener, session hook only) or `skills-only`. The user can move any rule.
- **Their files are never edited;** the adaptation lives in `~/.waymark/coexistence.md`.
- **Session hook** injects it (≤ 1,800 chars) and, when the instructions file carries a framework marker the file does not list, asks the agent to offer configuring it before the task.
- **Rule 0 hook** follows the mode (full, support reminder or silent).
- Updates re-check new frameworks and rules; uninstall leaves the other framework untouched; `sync.mjs` never creates `coexistence.md` on its own.

## 1.4.0 — memory injected at session start
Fourth real test: right decision on the first try (4/4), department first, procedure sections read, tests 10/10 + build, Solved problems and engram saved. Gaps: the opener asked for "Memoria: leída" before any tool call (impossible to fill truthfully), Environment was not read (python tried again), L2 checks skipped, code from another task deleted without asking.
- **Session memory hook** (`session-hook.mjs`, SessionStart): injects this machine's *Environment* and the project's memory digest (Solved problems symptoms, gates, Work in progress), capped at 2,500 chars. Recall no longer depends on the agent.
- **Opener in two moments:** routing line first; `Memoria · Reutiliza · Evidencia · Procedimiento` before the first edit.
- **L2+ Cierre fields:** `Tests: rojo→verde | sin infra · Navegador · Review`.
- **API verification:** official docs or the installed package source, cited.
- Removing code not written in this task needs a yes.
- INSTALL registers both hooks; updates add the new one.

## 1.3.0 — template instead of rules
Three real tests: the right decision on the first try 3/3. What sits in the **first text and first tool call** is always done; rules placed "in the middle" (brief lines, procedure, memory search) kept being skipped, and every evaluation proposed more rules. So 1.3.0 turns rules into **fields**:
- Every turn opens with two lines: the routing line and `Memoria · Reutiliza · Evidencia · Procedimiento`; every change closes with `Gates · Aprendido · engram`. Each field is a step that must be filled truthfully.
- Evidence that cannot be observed is declared as *hipótesis* with the user's one-line check **before** the fix.
- Only skills that will be invoked are listed; a support department only if its Quick ref was read; library internals count as API → `library-docs`.
- Visual bugs route to `dept-frontend`; `dept-qa` owns tests, review and bugs with no clear layer.
- *Work in progress* is per task; other tasks' pending items are kept.
- Instructions block 5.7k → 4.7k characters; hook reminder matches the template.

## 1.2.0 — lessons from the second real test
The second test confirmed 1.1.0 (routing line first, department skill as the first tool call, Spanish narration, build gate, reuse found, right result first try). Remaining gaps:
- **Environment knowledge:** `profile.md` gets an *Environment* section (OS, shell, missing tools, how to edit files), read at Recall and filled by the learning loop, so no session wastes attempts (e.g. heredoc → missing python → Edit).
- **Verifiable memory step:** the brief states `Memoria: leída | creada <file>` before the first edit.
- **Announced skills are invoked** with the skill tool; no announcing skills that are not used.
- **No unrequested behavior:** extras are proposed, not implemented.
- **Gates after the last edit;** L2 without a spec: add one where the project tests that kind of file, else say "sin infraestructura de test" and give a one-line check.
- `dept-frontend` Quick ref lists the key UX musts.

## 1.1.0 — lessons from the first real test
The first real test fixed in one attempt a bug that had failed over 20 times, but the agent skipped the "expensive" parts of the routine on a quick fix. This release makes them cheap and concrete:
- **First actions are explicit:** first text is the routing line, first tool call is the owner `dept-*` skill; all text in the user's language (block and hook).
- **Minimal bootstrap:** a missing project memory is created in one step (identity + gates from the project's own docs or manifest); the full scan is for L2+.
- **L1 minimum gate:** lint or typecheck of the changed files (UI: quickest compile check).
- **Evidence plan B:** without a browser or behind a login, give the user a one-line DevTools/console check and mark the fix *no verificado*.
- **Learn always:** a missing memory file is no reason to skip *Work in progress* and *Solved problems*.
- **Quick bug triage** procedure in `dept-qa`.
- Instructions block rewritten shorter.

## 1.0.0 — first release as Waymark
- **Departments:** 10 department skills (`dept-product`, `dept-architecture`, `dept-frontend`, `dept-ux-ui`, `dept-backend`, `dept-data`, `dept-security`, `dept-qa`, `dept-devops`, `dept-devex`) plus the `waymark` core and 6 tool skills (`ui-build`, `ui-refine`, `ui-system`, `ui-audit`, `browser-verify`, `library-docs`).
- **Rule 0 on every request:** recall → route → skills → verify → learn; questions in read-only consult mode; routing line at the start of every reply; per-prompt reminder hook.
- **Layered loading:** instructions block → one department → one procedure → one mode; references only when needed.
- **Right decision, faster:** reuse before create, minimal project scan with a project map, evidence before change, two-strike rule, official docs escalation, *Solved problems* with dead ends.
- **Self-filling memory** in `~/.waymark/`, shared by every agent, with *Work in progress* so another session or agent resumes where the last stopped.
- **Grows with use:** missing skills are created (global or project, asked), unknown architectures get a generated profile, the user's own MCP servers are mapped and used.
- **Install, update and uninstall** written for the agent (INSTALL.md), multi-agent, with choice windows, backups and daily update notices.
