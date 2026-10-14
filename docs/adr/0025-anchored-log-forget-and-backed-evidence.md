# 0025 · The log anchored in git, forget for the removals you ask for, and an Evidencia backed by a check

**Status:** accepted (2026-10-13). Every pick below is the user's (2026-10-13 · T9). It continues `0012` (git as the source of truth) and `0020` (testigo integrity).

## Context
- **A rewritten log went unseen.** A task with a commit keeps its record as a git note, and its stub in `provenance.jsonl` holds the note's hash. A task without a commit lives only in the local log. Each line holds the hash of the one before it, so a hand edit breaks the chain. But a rewrite that chains the rest again from `prev = null` passes `verifyChain`. That happened on 2026-10-13 · T8, when the user asked to remove an old YaloAtiendo session: three lines were dropped, the rest was chained again, and nothing showed it.
- **The Evidencia was the one part read as text.** The hook only checked that the field existed. «observada» could follow a change that nothing checked, and the facts it cited (`84/84`, `exit 0`, a hash) were never compared with what the tools printed.
- **Kiro and Antigravity** carry no reply in any hook, so their Cierre was already marked not applicable (`0022`). The Evidencia lives in the Cierre.

## Decision
- **Anchors in git.** Each record appended to the log (task, Q, confirmation) also appends one line, `{m, n, hash, at}`, to a note on HEAD under its own ref, `refs/notes/waymark-anchor`:
  - `n` is the log's length with that line, and `hash` is the line's hash;
  - `m` names the log (this machine and this log's path), so the anchors of another clone or machine are not checked against it;
  - `n` comes from the same read that gave `prev`, so another session appending meanwhile cannot shift it;
  - a repo with no commit yet has nothing to hold an anchor, so it records without one.

  `verifyChain(records, notes, anchors)` checks each anchor since the last rewrite anchor. The line at `n` must still hold `hash`, or the chain breaks with `{ anchor: true }`. A log rewritten and chained again, or cut below an anchor, no longer passes.
- **Anchors travel like the notes.** The same fetch glob (`refs/notes/waymark*`) brings them. `pushNotes` pushes both refs, and `unpushedNotes` counts both. `mergeNotes` joins the anchor notes line by line (`cat_sort_uniq`), so both sides' lines on one commit are kept.
- **`waymark.mjs forget`** is the way to remove what the user asks to remove: `forget "<task ID>" | --session <id> --reason "<why>"`. It shows the plan, and `--apply` writes it.
  - It removes exactly that task ID (a follow-up is named on its own) or every record of a session.
  - It chains the rest again and appends a rewrite anchor `{kind: "rewrite", n, hash, reason, removed, from: {n, hash}}`, so the removal shows in git instead of hiding. The anchors before it describe the log it replaced.
  - A reason is required. A task with a commit is refused, because its record is the commit's git note.
  - Removing every record leaves a rewrite anchor with `n: 0`, which checks nothing.
- **Testigo `evidence` (blocks once):** an Evidencia «observada» needs a check after the last change.
  - A check is a read, a search or a run, including a failing one, because it saw the state.
  - None of these is a check: an edit, a question, a skill load, a commit, an add, a push or a tag, or a call a hook or the user's permission stopped.
  - «inferida» needs no check.
- **What the Evidencia cites is looked up.** That means text in backticks, and outside them `84/84`, `exit N` and commit or blob hashes. The lookup covers the inputs and outputs of the tool calls since the last close, never the agent's own edits.
  - `exit 0` counts when a shell call after the last change succeeded; `exit N` counts when one failed, or when its output shows that code.
  - A fact no call shows is **sin respaldo**. It stays in the record (`observed.evidence.unbacked`) and in the findings, but it does not block, because an honest paraphrase may not match. Amended in 2.0.9 at the user's request (2026-10-14): the step shows ⚠ (`warn`) and counts as passed, instead of ✘.
  - A `file:line` is also backed by a call that named the file (`login.ts`, never `auth-login.ts`) and printed that line without the name: `grep -n` over one file (`45:`, `45-`) or Read (`45→`). Added in 2.0.9: YaloAtiendo 2026-10-13 · T3f had read `auth-callback.ts:45` that way and scored ✘.
  - The output searched is the first 20,000 characters of each result (`raw`), not the 800 kept for the other testigos.
- **Kiro and Antigravity:** `evidence` joins `cierre` in their `lacks`, so it is recorded as not applicable there.
- **The block** quotes the new claim. Its Evidencia bullet keeps only what the testigo does not cover (observe before changing), and the block stays under 6,500 characters.

## Consequences
- A rewrite of the log, by hand or by a script, now breaks the chain the next time it is checked. A removal the user asks for shows up as a rewrite anchor with their reason.
- Each close makes one extra git call (`notes append`), plus one read of the anchor notes when the chain is checked.
- The anchors of a clone on another machine are kept but not checked. A hostname change makes earlier anchors look like another machine's.
- Anyone who can write the repo can still write a forged rewrite anchor. It shows in the history of `refs/notes/waymark-anchor`, which travels with the remote; signing the anchors is not part of this decision.
- The evaluation has one more step, Evidencia, so a full score is 10/10 where it was 9/9.
- The live test of Kiro and Antigravity (their real session files) is the user's, on `wm-agent-test`. What it shows goes into their adapters.
