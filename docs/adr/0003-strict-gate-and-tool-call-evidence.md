# 0003 · Strict decision gate, evidence from tool calls only

**Status:** accepted (2026-10-02, Waymark 2.0.0-dev). Supersedes the "denied once, the retry passes" gate of 0002.

## Context
Two real tests of 2.0 in a real project. First test: routed as a question (Q) and then edited 8 files, so every check skipped it. Second test: the agent called itself "única opción", retried past the gate and applied two decisions before asking. It restored the main files with `git checkout HEAD --` through the shell, which no gate saw, so the record listed only one of the files changed. It declared `Memoria: leída` and a `Procedimiento` it never read. Claude Code does not persist reply text written after a thinking block, so the hooks never see the opener or a routing line written mid-turn. Tool calls and the final reply are persisted.

## Decision
1. **Strict gate.** No change to project files, by edit or by shell command, until the user was asked in the choice window in this task; a single real way is confirmed there too.
2. **Evidence comes only from what is persisted.** Re-routing is a tool call (the owner `dept-*` skill invoked with args `L<n>`). `Memoria` and `Procedimiento` go in the Cierre (the final reply), checked against real reads. The owner's `procedures.md` must be read before the first change.
3. **The output is what git saw.** The per-prompt hook takes a `git status` snapshot with content hashes, and the end-of-turn hook records every file that changed, whatever tool changed it.
4. **Gates in order:** a typecheck, lint or build after the last code change; tests after the last spec change.

## Alternatives considered
- **Keep the gate at once per prompt and mark the override in the record:** rejected by the user. The record would show the skip, but the decisions would already be applied.
- **Parse the opener for Memoria and Procedimiento:** impossible while the opener is not persisted.
- **List only the files from the edit tools:** rejected, because the second test changed its main files through the shell.

## Consequences
- Positive: the user decides before anything changes; the record's outputs are the real outputs; the opener claims that kept failing are now backed or flagged.
- Negative: one confirmation question even when there is one way; a `git status` per prompt (≤ 1.5 s timeout); two more lines in the Cierre.
