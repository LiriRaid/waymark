# Self-evaluation (deep audit)

Every closed task is already evaluated automatically: the end-of-turn hook judges it with the testigos of the catalog `waymark/routine.json` (each one executes: tool calls, git, a re-run) and writes the result into the task's record in `<project>/.waymark/provenance.jsonl` (`evaluation`: ✔/✘ per testigo that applied, score, tokens, estimated quota). `node <skills-dir>/waymark/scripts/testigos.mjs [<task ID>]` re-runs the ones that execute. The user sees it as one line. **The contract is the only rubric:** this guide adds none. When the user asks for **"evalúa tu trabajo"**, do a deeper audit of that record against the transcript.

## 1. Start from the record
- `evaluation.steps`: the ✔/✘ per contract step that applied. Report them as they are; do not re-score with other criteria.
- `unresolved`: what blocked and stayed missing after the one block. `findings`: recorded steps that failed (not blocking).
- `observed`: what the hooks computed (memory, procedure read, gates after the last change with time and failure, tests, browser, code-review, docs, branches, time). Cite it instead of re-deriving.
- `decisions`: the user's answers in the choice window as recorded, each with its `position` (before / after the task's first change). A decision applied without a question in the transcript is a decision taken alone.
- **Declared ≠ done:** check the Cierre's own claims (Resultado, Evidencia, Aprendido and its exception lines) against the calls: an "inferida de la doc" with no docs call, a "hecho" with a testigo ✘, an Aprendido that is not in the project memory file, a `Secretos: no (…)` on a real value. Each is a false declaration.
- **User decisions win, per task:** a check the user asked to skip is ✔ when the Cierre quotes their words (`omitido (usuario: "…")`) and those words are in their messages.

## 2. Right decision: did it get there without guessing?
- **Understood the ask:** the element the user meant (screenshot included); no correction needed for fixing the right thing in the wrong place or layer.
- **No hallucination:** every API, prop, path or command exists in the code or in the official docs for the installed version.
- **Attempts:** how many user prompts the task took; if ≥ 2, why.
- **Scope:** only what was asked; behavior preserved; a visible behavior change was asked first.
- **L3:** plan in checkpoints in *Work in progress*, resumed from it after a compaction.

## 3. Consumption
`node <skills-dir>/waymark/scripts/measure.mjs --turns <a>-<b>` in the project folder: attempts, responses, tool calls, tokens, the context at session start and its growth. Compare the record's estimated quota with the % the user noted before and after.

## 4. Report format
```
## Evaluación Waymark · <task ID>
Contrato (del registro): <label ✔/✘ · … · score>
Declaraciones sin respaldo: ninguna | <campo: lo declarado → lo que muestran las llamadas>
Decisión correcta: ✔/✘ — intentos: N — alucinaciones: ninguna | <lista>
Consumo: <measure.mjs> · cuota estimada X% · real A% → B% (si la anotó)
Qué mejorar en Waymark: <un cambio en routine.json, un hook o una plantilla — no reglas en prosa>
```
If you maintain Waymark (its repository has a `.waymark/memory.md`), add the improvements to that file → *Work in progress → Open*; otherwise list them in the report only.
