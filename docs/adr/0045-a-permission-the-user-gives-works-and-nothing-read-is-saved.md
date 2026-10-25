# 0045 · A permission the user gives works, only the user can give it, and nothing read is saved

**Status:** accepted (2.0.19). Extends ADR 0027 (the guard) and ADR 0037 (what it can and cannot stop).

## Context

The sensitive-path guard blocks `.env*`, keys and credentials. Real use showed four ways it failed the person it protects:

- **A permission the user gave did not work.** The user said, in the chat, that the agent could read their development env files. The guard kept blocking: the only lift was a `Sensitive allow:` line in a private file, and the block message said "they add it", so the agent asked the user to edit a file it could not name.
- **The guard failed open.** A command with a bracket in it (`L[i-1]`, `['x-1']`) threw inside the guard, the hook logged an error and let the command through, so the same input that crashed it skipped the check (fixed first, in point 3c).
- **It stopped what shows nothing.** `ls .env*`, `git check-ignore .env`, `test -f .env`, `grep -c KEY .env` and `node --env-file=.env` were denied like `cat .env`, although none prints the content.
- **Nothing guaranteed that a value read stayed unsaved.** The masker knows a few secret formats; a password or a connection string read from a `.env` has none.

## Decision

- **Only the user gives the permission, and only through the choice window or a line they write.** The block tells the agent to ask in a window whose question contains `Sensitive allow: <path>` and whose options are fixed: "Solo esta tarea", "Esta sesión", "Siempre este nombre de archivo" and "No". The hook reads the user's answer from the transcript (never the agent's text, never a chat message) and writes the line to `~/.waymark/preferences.md` with its scope: `Sensitive allow: <path> · task <ID> · <time>`, `· session <id> · <time>`, or `Sensitive allow: <name>` for always (the name of the file, in every project). The task's close removes its lines; a session's lasts at most a day. The block message says that a chat message does not grant it and shows the exact line.
- **What exposes no content passes.** A command whose program prints only names, metadata or a count (`ls`, `stat`, `test -f`, `file`, `wc`, `git check-ignore | ls-files | status`, `grep -c | -l | -q`) and the file a program is told to load itself (`--env-file`) are not reads. `cat`, `grep`, `sed`, `head`, `Get-Content` and a redirect to the file stay denied.
- **A value read from a sensitive file is never saved.** Waymark reads the `KEY=value` pairs of the project's sensitive files and masks those exact values in everything it writes (records, notes, engram, the Aprendido, `memory.md`), and the testigo "sin secretos" reports one that reaches a diff, a commit or a `mem_save`. The values live in the process for the length of the hook and are never written.
- **A guard that cannot judge denies** (3c); the shell the user runs is checked before a command with `!` is handed over; no project name, path or prompt appears in the rule, the template or the tests (ADR 0042).

## Alternatives considered

- **Only the line, by hand.** The safest and the simplest, but the user had decided that their answer in the window writes it, and a line to edit is the friction that made the permission fail. Rejected.
- **A permission in the agent's own words ("the user said yes").** An agent can claim it, and a model that hallucinates one defeats the guard. Rejected: the answer must come from the user's side of the transcript.
- **Mask only known secret formats.** What the masker already does; it leaves out the password or URL read from a `.env`, the case of the plan. Rejected.
- **Block `grep -c` and `ls` too, for safety.** They name the file and print no content; denying them made the agent look for a way around the guard. Rejected.

## Consequences

- A task that needs a sensitive file asks once, in a window, with a scope; the permission ends with the task unless the user chose longer.
- The end-of-turn detection (ADR 0037) still records what reached the agent although no hook stopped it; this ADR only lets the allowed and the harmless through.
- Masking exact values needs the sensitive file to be readable by Waymark at the project's root; a value set elsewhere is masked only if its format is known.
- A quoted value shorter than six characters, or a trivial one (`true`, `localhost`, a port), is not masked: it would mask the prose around it.
