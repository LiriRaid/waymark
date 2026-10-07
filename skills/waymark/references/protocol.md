# Entry and Exit protocol (full)

Part of the `waymark` core skill. Paths are relative to the core skill folder (`<skills-dir>/waymark/`). Read only when the instructions file or a department points here.

The compact version lives in the instructions file and is enough for L1. Read this file at L2+ or when unsure.

## Entry

1. **Project memory.** Identify the project root (nearest folder with a manifest: `package.json`, `Gemfile`, `pyproject.toml`, `go.mod`, `pom.xml`, `*.csproj`, `Cargo.toml`, `composer.json`, `pubspec.yaml`). Read `<project>/.waymark/memory.md` (the session hook names the file; before migration it is still `~/.waymark/projects/<project-slug>.md`) and `.waymark/tasks.md` (where the work stands). If it does not exist, read `~/.waymark/profile.md` (the user's defaults), run `references/project-detection.md` and create the memory from `templates/project-memory.template.md`. If the memory exists but has no *Project map*, run the minimal project scan of `references/project-detection.md` once and add it. Any private-layer file missing (`profile.md`, `preferences.md`, `subagents.md`, `projects.md`, `agent.md`) → create it from `templates/private-layer/` without asking.
2. **Stack profile.** Read `stacks/<stack>.md` (L1: *Commands* + your department's section; L2+: full). Unknown stack → `stacks/generic.md`.
3. **Architecture profile** (L2+). Read `architectures/<architecture>.md`. Unknown → derive it from the project and generate the profile (`references/project-detection.md`); ask only if the code is ambiguous. Record it in project memory.
4. **Learnings.** Read `~/.waymark/learnings/<department>.md` if it exists.
5. **Tools.** Read `skill-registry.md` → your department section. Pick the skills/MCP whose *When* matches the task and whose *Level* ≤ current level. Missing provider → `references/skills.md`.
6. **Brief.** Print before the first edit:

```
Waymark → L2 · dept-frontend (+dept-ux-ui) · skills: ui-build · library-docs
Pedido: confirmar antes de borrar un contacto · Captura: /contacts, fila de la tabla, botón papelera rojo marcado con un círculo
Memoria: leída .waymark/memory.md · Reutiliza: shared/components/app-modal · Evidencia: observada (botón borrar sin confirmación en /contacts) · Procedimiento: New component / screen
Qué: modal de confirmación para eliminar contacto · Para qué: evitar borrados accidentales · Dónde: features/contacts/components/delete-contact-dialog/
```
At L2+ add the *Qué · Para qué · Dónde* line; at L1 the opening lines are enough. *Captura* names what the image points at (screen, element, state, the mark the user drew), not a description of the whole picture; if the image and the text disagree, ask once.

## L3: plan as checkpoints

Long tasks fail when the conversation is compacted and the agent loses what was done, what is next and what was ruled out; it then fills the gaps by guessing. Keep that state on disk, not in the conversation:
1. Plan first (`Plan` agent or plan mode) and split it into steps that are each an L1/L2 change with its own gate.
2. Write the steps into the Cierre's Aprendido (≤200 characters; the end-of-turn hook makes it the task's *Work in progress* line): `✔1 <step> · ▶2 <step> · 3 <step> — next gate: <command>`.
3. Mark a step ✔ only after its gate passed; what was ruled out goes in the ADR or the commit (the whole Cierre stays in the task's record).
4. After a compaction or a new session, the session hook re-injects the line: resume from `▶`, re-run its gate before continuing (`waymark.mjs tasks <task ID>` shows the whole record).
5. Delegate only broad searches (an exploration agent returns the conclusion, not files); the main agent keeps the plan and the edits.

## Token economy

Every response re-reads the whole context, so what enters it is paid again on each later step (`measure.mjs` → *Ctx* column shows the growth per prompt):
1. **Small tool outputs and searches.** Search with the Grep/Glob tools (they skip `node_modules` and ignored folders); a recursive shell `grep`/`find` from the root hung 120 s in real tests. Ask for the part you need: `head`/`tail`, `grep -n` with `-m`, line ranges when reading, `git diff --stat` before the full diff, `--json` + a filter instead of whole dumps. Never print a log, lockfile or build output in full. Write a script to a file and run it instead of an inline `node -e` holding backticks, `${` or regex escapes (shell quoting mangles it and it "succeeds" broken). Never `git stash` the user's changes: prove a pre-existing failure in a clean `git worktree` copy (`dept-qa`).
2. **Sub-agents are not free.** Each one re-reads its own context on every step (measured: one broad research task cost 6.5M sub-agent tokens). Use one only for a broad search whose conclusion is all you need; read known files yourself.
3. **`/compact` is safe mid-task** once the plan and its state are in *Work in progress* (L3 checkpoints above): the session hook re-injects them.
4. **A large idle session is expensive to resume.** After about an hour without messages the prompt cache expires and the next message re-writes the whole context as new input (measured: 502k tokens for one line). A new task is cheaper in a new session; project memory carries over. `waymark.mjs check` reports a large or idle session in the folder.
5. **Unused listings cost every session:** `skill-fit.mjs` (skills never invoked) and `mcp-fit.mjs` (framework servers a project does not use); `waymark.mjs check` reports both.

## Hand-off between departments

When a task moves to another department (each department's *Hand-offs* says when), pass one line in this form, so the next one starts from facts instead of re-reading:
```
Hand-off → dept-<x>: hecho <what is decided/done> · necesita <what the next department must decide or build> · evidencia <paths, file:line, outputs> · abierto <open questions | ninguno>
```
The receiving department checks the evidence it relies on (memory and hand-offs point, the code decides) and continues with its own Entry.

## Exit (Definition of Done)

1. **Quality gates** — run them yourself with the commands from project memory (or the stack profile): typecheck · lint (changed files) · tests (related at L1/L2, full at L3) · build (L2+). **Fast while working, complete once:** during the task only lint and the related tests of the files you touch (`vitest related`, `jest --findRelatedTests`, the spec by path); the whole-project typecheck and the build once per repo, at the end, after the last change; never rerun a full gate with no change in between (a real L2 spent 13 of 26 minutes in two whole-project typechecks). The end-of-turn hook records each gate's command, time and failure. Report real output. If a failure is pre-existing, prove it in a clean copy of HEAD (`git worktree add <tmp> HEAD` → rerun → `git worktree remove <tmp>`; never stash the user's changes) and say so; not allowed to run it → say "no comprobado (sin permiso para <command>)" instead of retrying. **The user can skip a check for the current task** ("no hagas tests", "sin code-review"): write `omitido (usuario: "<their words>")` in that field and record it in the task's *Work in progress* entry; the next task, or "ahora sí", returns to the defaults. The end-of-turn hook accepts it only when those words appear in the user's messages. Never claim done with red gates. **L1 minimum:** lint or typecheck of the changed files (UI changes: also the quickest compile check the project has); never zero gates. Re-run the gates after the **last** edit, not only after the first one. L2+ with no spec for the changed code: add one where the project already tests that kind of file; otherwise state "sin infraestructura de test" and give the user a one-line check.
2. **Architecture conformance** (L2+) — run the *Conformance checklist* of the architecture profile against the changed files. Report ✔/✘ with `file:line`.
3. **Review** (L2+) — `code-review` skill on the diff. L3 — also `simplify` and, if security-relevant, `security-review`.
4. **Department DoD** — tick the department's Definition of Done.
5. **Learn** — `references/learning.md`; rewrite project memory → *Work in progress* (or mark it idle).
6. **Closing report** — the Cierre of the instructions block, headed by the task ID the per-prompt hook offered. It holds only what the agent alone knows; the end-of-turn hook computes the rest from the tool calls (memory, procedure, gates and their order, tests, review, docs, branches, time, tokens), blocks once for the testigos the catalog `waymark/routine.json` marks as `block`, scores every testigo that applied and appends its record to the hash-chained `<project>/.waymark/provenance.jsonl`, the supply chain of the agent's work (docs/adr/0002, 0004, 0012):

```
## Cierre · 2026-10-02 · T3
Resultado: hecho
Evidencia: observada borrado sin confirmar en /contacts (spec en rojo antes del cambio)
Aprendido: "confirmación con app-modal ← observado: borrado sin confirmar en /contacts"
```
**Decision gate (any level):** the user decides, never the agent. Before changing anything, ask in the choice window: the approach with its optimal options (files, risk, cost; mark the recommended one, which may not be what the user needs) and, in the same call, every decision that shapes the work you can foresee (data design, visual style, behavior, defaults). Never offer, recommend or run browser verification (browser-verify, Playwright) unless the user asks for it. The branch is the user's, never asked as a decision. Later questions only confirm. The record keeps the user's answers as they were given, each with its position (before / after the first change); the Cierre does not restate them. A choice the user already wrote, or a single real way, is confirmed there too. Commits of the task carry the trailer `Waymark-Task: <task ID>`.

## When stuck (two-strike rule)

The second failed attempt on the same problem means guessing has started. Stop varying the fix and switch method:
1. **Observe, do not assume.** Get the real state: the rule that wins in the stylesheets, the actual runtime value, the full error and stack, the real request/response, the version installed. **The browser is the user's** (`browser-verify` only when they ask for it; never offered or recommended) → give the user one copy-paste check (e.g. `getComputedStyle(document.querySelector('.x')).transform` in DevTools) with the expected value before and after the fix, and mark the fix *no verificado* until they confirm.
2. **Re-read the source of truth.** Official docs for the exact API and version (`library-docs`), and the code that actually runs (not the file you think runs: check imports, overrides, themes, generated files).
3. **Hypotheses.** List 2–3 possible causes; test first the check that rules out the most of them with the least effort. One change at a time.
4. **Ask once, precisely.** Still unclear → one concrete question to the user (which element / screen / input, a screenshot of the inspector, the exact steps), not a list of guesses.
5. **Record it.** When solved, the Cierre's Aprendido holds symptom, root cause, fix and what did not work; the end-of-turn hook saves it to engram.
