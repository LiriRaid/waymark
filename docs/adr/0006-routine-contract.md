# 0006 · One routine contract

**Status:** accepted (2026-10-03, Waymark 2.0.0-dev). Supersedes the fixed list of blocks in 0005; the automatic evaluation of 0005 stays.

## Context
The routine lived in three places that drifted apart: the instructions block, the hooks and the self-evaluation guide. When 2.0 moved `Memoria` and `Procedimiento` out of the opener, the guide still required them, so every evaluation reported ✘ that the routine no longer asked for. Each fix changed one place and broke another. That is why every test seemed to fail something new. The fifth real test also showed the cost of blocking too little: once browser, code-review, docs and build were only recorded, the agent skipped them (score 4/7). An agent reliably does only what is enforced.

## Decision
One file, `skills/waymark/routine.json`, defines every step of the routine: the levels it applies to, the condition (`when`: code changed, UI changed, engram available, an inference from docs, a spec near the code…), and whether it **blocks** or is **recorded**. The end-of-turn hook computes each step's result from the transcript and git, blocks once for the failed `block` steps, records the rest, and scores every step that applied (the evaluation). The instructions block quotes every `block` step's `doc` text, and the self-evaluation guide defines no rubric of its own: tests fail if either drifts. The user's choice on 2026-10-03: block on the decision, a gate after the last change, the Cierre with its Aprendido written, and at L2+ `mem_search`, code-review and the build with code, plus docs behind an inference from docs. Record the procedure, the browser, the spec near the code, pre-existing failures and the commit trailer.

## Alternatives considered
- **Keep the lists in the hook, the block and the guide in sync by hand:** rejected, because this is exactly what failed four times.
- **Generate the instructions block from the JSON at install time:** possible later (step 3). For now a test enforces that the block quotes the contract.

## Consequences
- Positive: one place to change a rule; no evaluation can contradict the hooks; the user can tune strictness without touching code.
- Negative: more steps block at L2 (code-review costs a sub-agent, the build 1–2 minutes), traded for complete tasks.
