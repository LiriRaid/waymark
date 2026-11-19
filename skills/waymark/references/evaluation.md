# Self-evaluation (deep audit)

Every closed task is already evaluated automatically: the end-of-turn hook judges it with the testigos of the catalog `waymark/routine.json` (each one executes: tool calls, git, a re-run) and writes the result into the task's record in `<project>/.waymark/provenance.jsonl` (`evaluation`: ✔/✘ per testigo that applied, score, tokens, `links`: responses and tokens of the task split into routine, work and reply, estimated quota). `node <skills-dir>/waymark/scripts/testigos.mjs [<task ID>]` re-runs the ones that execute. The user sees it as one line. **The contract is the only rubric:** this guide adds none. When the user asks for **"evalúa tu trabajo"**, do a deeper audit of that record against the transcript.

## 1. Start from the record
- `evaluation.steps`: the ✔/✘ per contract step that applied. Report them as they are; do not re-score with other criteria.
- `unresolved`: what blocked and stayed missing after the one block. `findings`: recorded steps that failed (not blocking).
- `observed`: what the hooks computed (memory, procedure read, gates after the last change with time and failure, tests, browser, code-review, docs, branches, time). Cite it instead of re-deriving.
- `decisions`: the user's answers in the choice window as recorded, each with its `position` (before / after the task's first change). A decision applied without a question in the transcript is a decision taken alone.
- **Declared ≠ done:** check the Cierre's own claims (Resultado, Evidencia, Aprendido and its exception lines) against the calls: an "inferida de la doc" with no docs call, a "hecho" with a testigo ✘, an Aprendido that is not in the project memory file, a `Secretos: no (…)` on a real value. Each is a false declaration.
- **User decisions win, per task:** a check the user asked to skip is ✔ when the Cierre quotes their words (`omitido (usuario: "…")`) and those words (3 or more) are in their messages. An exception line (`no comprobado (…)`, `Tests: no (…)`, `Build: no (…)`, `Secretos: no (…)`) is `exception` (⚠) in `evaluation.steps`: declared, not proven, never a ✔ in the score.

## 2. Right decision: did it get there without guessing?
- **Understood the ask:** the element the user meant (screenshot included); no correction needed for fixing the right thing in the wrong place or layer.
- **No hallucination:** every API, prop, path or command exists in the code or in the official docs for the installed version.
- **Attempts:** how many user prompts the task took; if ≥ 2, why.
- **Scope:** only what was asked; behavior preserved; a visible behavior change was asked first.
- **L3:** plan in checkpoints in *Work in progress*, resumed from it after a compaction.

## 3. Consumption
`node <skills-dir>/waymark/scripts/measure.mjs --turns <a>-<b>` in the project folder: attempts, responses, tool calls, tokens, the context at session start and its growth. Compare the record's estimated quota with the % the user noted before and after.

## 3b. What the gates read as of 2.0.21

- A spec written after the code it tests is recorded ("written after the code") and asks no clean copy; it must pass after it. The clean copy (`W copy HEAD`) is asked only when the spec cannot run before the code in the working tree.
- The Stop hook re-runs the repo's typecheck only when the agent ran none; one that took 10 s or more last time is skipped for a day (`WAYMARK_SLOW_GATE_S`) and the agent is asked to run it. A gate's time is never a failure (`W testigos` shows it as not judged).
- Ojos (the eyes) is judged only when the request asked for the screen, a browser or ego, or carried a screenshot or a design link.
- The record keeps the level the routing line declared (`declared`) next to the measured one, and what the hook handed of each procedure (`observed.procedure.deliveries`).

## 4. Report format
```
## Waymark evaluation · <task ID>
Contract (from the record): <label ✔/✘ · … · score>
Unbacked claims: none | <field: what was stated → what the calls show>
Correct decision: ✔/✘ — attempts: N — hallucinations: none | <list>
Consumption: <measure.mjs> · estimated quota X% · real A% → B% (if the user noted it)
What to improve in Waymark: <one change in routine.json, a hook or a template — not prose rules>
```
(The report is written in the user's language.)
If you maintain Waymark (its repository has a `.waymark/memory.md`), add the improvements to that file → *Work in progress → Open*; otherwise list them in the report only.
