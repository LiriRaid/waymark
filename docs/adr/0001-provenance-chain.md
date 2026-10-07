# 0001 · Provenance chain of the agent's work

**Status:** accepted (2026-10-02, Waymark 2.0.0-dev, step 1) · naming and the L2/L3-only gate superseded by [0002](0002-supply-chain-of-the-agents-work.md)

## Context
Real tests 6–10 closed tasks whose Cierre claimed steps that never ran, and the largest cost was work in the wrong direction (a whole turn on the API after the user said "solo FE"; a 2nd attempt after copying a whole rule from "like X"). The Cierre was text in a reply: nothing kept it after the session, nothing tied it to a task, and nothing recorded which option the user chose and which were ruled out. The user wants every change to carry its task ID, the user's decision, the evidence, the gates and the result, under an honest name. Constraints: hooks run locally with 0 model tokens; reply text written after a thinking block is not persisted in the transcript, tool calls and prompts are; Waymark already adds ~3,750 tokens at session start, so the routine must not grow much.

## Decision
Each L1–L3 task gets an ID `YYYY-MM-DD · T<n>[a-z]` (n per project and day; a letter for each follow-up prompt of the same task) that the per-prompt hook computes and the Cierre heading carries (`## Cierre · <id>`). At L2/L3 the agent gives the user 2–3 options (files, risk, cost; recommended first) in the choice window before the first edit, and the Cierre states `Decisión: elegida … · descartadas …`, `del usuario ("<their words>")` or `única (<why>)`; the pre-tool hook denies the first L2+ edit of a prompt once when no choice was asked. The end-of-turn hook appends one JSON line per closed task to `~/.waymark/provenance/<slug>.jsonl`, built from what the transcript proves (prompt, options and answers, files changed, commands, skills) plus the Cierre text and the claims it could not back. Step 2 moves that log into `<project>/.waymark/`.

## Alternatives considered
- **Calling it a software supply chain** (SBOM, dependency provenance): rejected, refutable; this records the agent's work, not dependencies. SLSA is the model for the idea of a provenance record, not a compliance claim.
- **The Cierre as the only record** (reply + *Work in progress*): rejected, nothing persists per task and claims stay untied to tool calls.
- **The agent writes the record into project memory:** rejected, it costs tokens on every task, grows the injected digest and depends on the agent doing it.
- **Decision gate as a note or a closing check only:** rejected, notes were ignored in tests 6–10 and a closing check comes after the edits.
- **The agent derives the task ID from memory:** rejected, numbers repeat or skip across sessions.

## Consequences
- Positive: every closed task leaves a record the user can audit; the record says which claims were not backed instead of trusting the reply; wrong-direction work is cut by the user's choice before editing.
- Negative: one extra deny per L2+ prompt when the agent skips the choice (and one retry when there is a single real option); ~25 tokens per prompt for the task ID line; a log that grows (~1 KB per task).
- Follow-up: step 2 (log and project memory in `<project>/.waymark/`, git-excluded), step 3 (smaller block), step 4 (A/B against plain Claude Code and gentle-ai). Gate of this step: `node --test tests/*.test.mjs` + one real L2 task.
