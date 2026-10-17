# 0033 · Precedent: a similar task starts from the evidence of an earlier one

**Status:** accepted (2.0.18, point 5). Amends ADR 0031: the scorecard now names this ADR (`adr`), whose lock replaces the one in 0031.

Scorecard-Lock: 3e09fccc7c55fe0c443c8e5b52c7601c8af5427ebf2bb354c6baad1bbec05e8b

## Context

Every task leaves evidence: what was asked, the files it changed, the gates it needed and what it learned. A later task that resembles it can start from that instead of rediscovering it, which saves time and tokens and keeps what was learned from being learned twice. The plan asks for it to be deterministic (no embeddings, no model, no network), small (about 400 characters), silent when nothing resembles the ask, and evaluated on tasks held out from the search.

## Decision

`scripts/precedent.mjs` (and `waymark.mjs precedent`):

- **Search.** BM25 over the words of each earlier task's ask (the first 600 characters) and its Aprendido, against the words of the new ask. Words are lower case, without accents, tags or stop words (Spanish and English, with the interrogatives); a path or a dotted version keeps its parts; a plural loses its `s`. The Aprendido is what the learned layer holds (the end-of-turn hook saves it to engram), so the search does not call the engram binary and stays offline. The file names are not indexed: in a repository where most tasks touch the same few files they only add noise (measured in the exploration that chose the indexed text: 0.826 with them, 0.884 without).
- **Hand-over.** At a task's first prompt only (`taskStartMark` is not yet set), the best earlier task is handed over if it shares at least two words with the ask and its score is at least 0.9 × ln(1 + n), n being the tasks searched (4.5 at 140 tasks, 1.6 at 5: a rare word weighs more among many tasks, so the minimum grows with the history). One rare word in common is a coincidence, not a precedent; with the history short, little qualifies and nothing is handed over. The text is at most 400 characters: the task, its level and type, the ask in 70 characters, up to three file names, up to two gate commands, what it learned (taking what the rest leaves), and the words "earlier evidence, not fact: check it against the code". It goes in the reminder of that prompt, after the repository line, so it is outside the fixed context and costs about 100 tokens only when something resembles the ask. A later prompt of the same task gets nothing; an ask of fewer than two significant words gets nothing; `WAYMARK_PRECEDENT=0` turns it off.
- **The record.** `precedent: { task, score, chars, files, used }` on the task's record, written by the stop hook from the state the first prompt kept (`~/.waymark/.precedent.json`). `used` is `cited` when the task names the earlier one, `files` when a call touched one of its files, null otherwise. Without a hand-over the field is absent.
- **The evaluation.** `waymark.mjs precedent --eval` searches each task with its own ask against the tasks before it, in date order, and asks whether the best three include an earlier task on the same files. It reports precision@3, the same measure for a random choice, the lift, how often a hand-over is made, how often its first task is the right one, the longest hand-over and an estimate of the searches a hand-over could spare. The scorecard reads precision@3 and the longest hand-over (checks 10.3 and 10.4).

**Threshold frozen** (the user's choice, 2026-10-17): precision@3 of at least 0.85, from a baseline of 0.87 on this project's 69 tasks that have an earlier task on the same files.

## What the evaluation shows

On 140 recorded tasks, 69 of them with an earlier task on the same files:

| Measure | Value |
|---|---|
| precision@3 | 0.87 |
| the same for a random choice | 0.656 |
| lift over random | +0.21 |
| tasks that would get a hand-over | 58 of 69 (84 %) |
| hand-overs whose task is on the same files | 0.69 |
| longest hand-over | 400 characters (the cap) |
| an ask with no word in common with any task (a question about another subject) | nothing handed over |

The random figure is high because most tasks in this repository touch the same few files (`waymark.mjs`, `stop-hook.mjs`, the README): "the task on the same files is in the top three" is an easy target here, and the lift is the number that says how much the search adds. A third of the hand-overs are for a task that did not touch the same files, which is not the same as a useless one.

**What it would have spared** (an upper bound, on the 6 of the 40 matched tasks whose transcript is still on this machine): 14 searches on the matched files before the first edit, about 3.3 % of those tasks' cost units. The hand-over names the files and says what was learned; it does not hold their content, so how many of those searches it would have avoided is not measured, and the 1 read that an edit needs anyway is not claimed.

## Limits, in these words

One project, one author, 140 tasks; the held-out set is the same history that built the search, in date order, so it measures how well the search would have worked, not how well it will. The words of this author's asks (Spanish, short, often "continue with point N") are what it is tuned to by default; the parameters are the standard ones and were not tuned on the data. An ask of one or two common words ("sigue con el punto 5") gets nothing. Whether the agent uses a hand-over is recorded, not judged; a hand-over it ignores still costs its 100 tokens.

## Alternatives considered

- **Embeddings or a model call.** Better on paraphrase, but a cost, a dependency and a result that is not reproducible. Rejected by the plan.
- **Index the file names too.** Worse here (0.826).
- **Hand over the top two.** More coverage and more noise; the second matches less. Rejected by the user's choice.
- **Hand over at every prompt.** The task already has the context and would pay again. Rejected.
- **Call the engram binary for the learned layer.** The memories are the Aprendido that the records already hold; a second path would add latency and a dependency for the same text.

## Consequences

- Checks 10.2 to 10.5 of the scorecard pass; 10.3 is frozen at 0.85 and holds with a margin of 0.02 over 69 cases, so it can fall when new tasks are added: that is the instrument working.
- Every hand-over is outside the fixed context; `size.mjs` lists its cap as an outside-the-cap row.
- The saving is not claimed; the estimate is an upper bound with its n, and the field `precedent.used` accumulates the evidence of whether it is used.
