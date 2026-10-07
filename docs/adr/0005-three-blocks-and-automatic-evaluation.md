# 0005 · Three blocks, everything else recorded and scored

**Status:** accepted (2026-10-03, Waymark 2.0.0-dev). Refines 0003 and 0004.

## Context
Four real tests of 2.0. Each found a check the agent skipped, and each fix added a block, until the end-of-turn hook blocked for about ten different things. The user does not want "an ecosystem of hooks". They want a supply chain that is efficient, completes the task, lets them decide every real decision, learns and evaluates itself. The fourth test was right on the first try, with every decision taken by the user and 2% of the quota, yet its self-evaluation still listed four ✘. Most were wording and form, and two were bugs of ours: a search with no match counted as reading the procedure, and the Aprendido was claimed but never written. The self-evaluation prompt cost about as much as the task.

## Decision
Only three things block, once, because without them the chain is broken: (1) **the decision**, backed by the choice window or the user's words, with no sub-decision taken alone (the pre-tool gate already stops changes until the user is asked); (2) **a gate after the last change** (typecheck/lint/build after the last code change, tests after the last spec change); (3) **the Cierre complete, with its Aprendido written to the project memory**, so the next session or another agent can resume. Everything else (browser, code-review, spec next to the code, docs, pre-existing failures, procedure, department, mem_search, commit trailer) is a **finding**: recorded and scored, never blocked. Every closed task gets an **automatic evaluation** in its record (✔/✘ per routine step, score, tokens, estimated quota at ~1.35M tokens per 1% of the 5-hour quota, tunable with `WAYMARK_TOKENS_PER_PCT`), and the user sees it as one line (`systemMessage`, 0 model tokens). "Evalúa tu trabajo" becomes an optional deep audit.

## Alternatives considered
- **Keep blocking every missing action:** rejected by the user. It means more round trips, more tokens, and a new block after every test.
- **No blocks at all, only the record:** rejected. Without the decision and the final gate, the agent decides alone or delivers unchecked code, and the chain stops proving anything.

## Consequences
- Positive: fewer round trips; the evaluation costs nothing; the chain stays honest (findings are recorded, not hidden); fixes: an empty search is not a read, the chosen option counts as the user's words, a commit is not a change.
- Negative: an agent can skip code-review or the browser and only lose points. The user sees it in the one-line evaluation and in the record.
- Follow-up: step 2 moves the record, tasks and evaluation into `<project>/.waymark/`, so any agent resumes from it.
