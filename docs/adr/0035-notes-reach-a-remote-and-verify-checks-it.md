# 0035 · The notes reach a remote without a manual step, and `verify --remote` checks the copy

**Status:** accepted (2.0.18, point 7). Amends ADR 0012 and 0025 (when the notes are pushed, and what a remote copy adds to the anchors).

## Context

The anchors in git catch a log rewritten and chained again, but only while the anchors survive: someone who can rewrite the repository can rewrite the notes that hold them. A copy on a remote that the attacker does not control is what makes that visible, and a copy only exists if the notes were pushed. Until now the hook pushed them after a push the agent made, and `check` listed the rest as a pending item the user had to act on; nothing compared the remote's anchors with the local ones.

## Decision

- **The user's yes, per project** (the user's choice, 2026-10-17). The notes hold the user's requests and Cierres, and a public remote publishes them, so the consent is a list of projects, never a global switch: `Notes push: waymark, other-project` in `~/.waymark/preferences.md`, and `Notes push never: some-project` for a project that must not be offered it again. `check` offers three answers with the choice window: push once and keep pushing this project's notes at each close (`waymark.mjs notes push --always`), push once (`notes push`), or never for this project (`notes push --never`). Once the project is on either list, `check` stops listing its unpushed notes. A remote that has no notes yet is offered too: its notes were never pushed.
- **The push at the close.** With the yes, the end-of-turn hook pushes the notes the remote lacks to `origin` at every close, not only after a push the agent made. It never prompts (`GIT_TERMINAL_PROMPT=0`), waits at most 15 seconds and never blocks: a failure is said in the line of the close and the next close tries again. A project with no remote pushes nothing.
- **`verify --remote [<name>]`** (default `origin`). It fetches the remote's anchor ref into a temporary ref, so the local notes are never touched, and runs the remote's anchors for this log through `verifyChain` against the local records, the same check the local anchors get: since the last rewrite anchor, each must still name the line it anchored. A record rewritten and chained again, even with the local anchors rewritten to match, no longer matches the anchor the remote kept, and the first task that differs is named; an anchor changed on the remote does the same from the other side (the line says one of them was rewritten after it was anchored, not which). The exit code is 1 when they differ. Local anchors the remote lacks are a warning with their number: they were not pushed yet.
- **What is a warning.** With no remote, `verify` says `no remote copy of the records` (always, with or without `--remote`); with a remote it cannot reach, `not checked (could not reach it: …)`; with a remote that holds no anchors of this log, `holds no anchors of this log yet`. None fails the exit code and none is silent: a person offline can still verify, and a pass is never claimed for what was not checked.
- **A clone with no local records** rebuilds them from the remote (`notes setup` then `rebuildFromGit`, since 2.0.14) and `verify` on it passes; the anchors of another machine's log carry another id and are not checked against the clone's own.

## What it proves, and what it does not

A match proves that the remote held, at the time of the fetch, the anchors that this log still has, so a rewrite made after the push shows. It does not prove the remote itself is honest or out of the attacker's reach (a rewrite that also force-pushes the notes to that remote erases the evidence; a remote with force-push disabled, or a second one, is what stops that), nor that the notes were pushed before the rewrite: an attacker who rewrites before the first push leaves nothing to compare. The comparison is by anchor (a log length and a hash), not by the contents of each note.

## Alternatives considered

- **A global yes.** One answer, but it publishes the requests of every project whose remote is public. Rejected for the list.
- **Push only after the agent's push (as before).** Leaves most tasks unpushed; the criterion asks for no manual step.
- **Fail the exit code with no remote or no network.** Stricter, but breaks `verify` offline and for a project that has no remote by choice. Rejected for a warning that is always said.
- **Compare the notes' contents, not only the anchors.** More to fetch, and the anchors already commit to each log's last hash. Left for later.

## Consequences

- Scorecard checks 2.4 to 2.6 and 7.2 pass; 7.1 (no unpushed note commits) depends on whether this machine has pushed, and is the author's to keep.
- Every close of a project that said yes costs one `git push` of the notes refs (a fraction of a second when there is nothing new, up to the 15 seconds' wait when the remote is slow).
- `check` no longer lists unpushed notes for a project that answered; the author's own project should answer once.
