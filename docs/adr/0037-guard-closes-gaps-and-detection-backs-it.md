# 0037 · The guard closes the gaps it can, and the end-of-turn detection backs it where it cannot

**Status:** accepted (2.0.18, point 9). Amends ADR 0027 (the sensitive-path guard and the capability matrix).

## Context

The guard of ADR 0027 refuses, in the hook before the tool, a read or an edit of a secret-bearing path and a shell command whose arguments name one that exists. Two things were left: (1) the ways a command names a file without the guard seeing the word (a glob, a flag's value, an attached redirect, a revision, another shell), and (2) every agent but one has no hook before its read tool, so a read of `.env` went through and left no trace. The matrix called those cells *advisory*, which says "asked, not checked" for something the end-of-turn hook can check. Scorecard criterion 5 asks that each guarded action is prevented where a hook exists and detected where it does not.

## Decision

All four options below are the user's choice (2026-10-17), each the recommended one.

- **The guard closes the gaps** (`lib/guard.mjs`, used by the pre-tool hook). The guard already judged the argument and never the program, so `cat`, `type`, `Get-Content`, `head`, `tail`, `less`, `cp`, `source` and the rest were refused when they named the file; tests now name each reader. Added: a glob in the last segment of a path is matched against what exists in its folder (`cat .env*`, `head cfg/id_*`); the value of a flag or an assignment (`--env-file=.env`, `-Path:.env`); what follows an attached redirect (`cat<.env`); the path of a revision (`git show HEAD:.env`); the inside of a shell run through another (`bash -c "cat .env"`, `pwsh -Command …`, two levels); the closing bracket of a substitution (`$(cat .env)`); and `%USERPROFILE%` and `$env:USERPROFILE` like `~`. Two limits keep it from refusing the harmless: a pattern with fewer than two literal characters (`*`, `?`) names nothing in particular, so `git add *` and `ls *` pass, and a value that a flag takes as a pattern (`find -name "*.pem"`, `grep --include=*.pem`) is not a file.
- **Detection at the end of the turn** (`detectGuarded`, in the same module). The end-of-turn hook reads the normalised calls of the turn (every adapter already names them `Read`, `Edit`, `Bash`… with the same input), and for each call the hook did not refuse it records: a read or edit of a sensitive path, a shell command naming one, and a strong-format secret printed in any tool's result (`findSecrets`: private key, AWS, GitHub, `sk-`, Slack, JWT, Google; `password=` is not one, so documentation and test output do not fill the records). It is the same function for every agent, so it needs no per-agent code.
- **Recorded, not blocked.** The record keeps `observed.guarded` (`[{ kind: read | edit | shell | output, tool, path | secret, line }]`, at most 20; never a value) and a line in `findings` that says it was recorded and not blocked. The record is chained and anchored, so a finding cannot be removed afterwards. The call already happened: a block would punish a fact that cannot be undone, and would give false positives where the user had allowed the path.
- **The matrix says `prevent` or `detect`** for the sensitive-path cells (edits and shell, reads) and for a secret printed in a tool's result (a new column). `prevent`: a hook before the tool refuses the call. `detect`: nothing refuses it and the end-of-turn hook records it. A cell that would say neither is `none`, and a test fails on it; every agent with an adapter has a Stop hook, so none does. Agents with no adapter are listed apart as having nothing recorded or checked, not as guarded.

## What it proves, and what it does not

A finding proves that a call reached a sensitive path or printed a secret in that turn and that no refusal came back; it does not say the agent used the value, and a clean turn does not say none was read. Detection reads what the transcript shows: a script that opens the file by itself, a read the agent did not make through a tool, or a secret in a form the formats do not cover is invisible to it, as to the guard (the README says so). A shell command's path is judged against the files as they are when the turn ends: a file deleted or moved by then is not found. The detection is made by a hook the agent could, in principle, have disabled; a record without findings does not prove the hook ran (`check` covers that the hooks are registered and answer).

## Alternatives considered

- **Tests only.** The guard already stops the named readers, but `cat .env*` and `git show HEAD:.env` would keep passing. Rejected.
- **Block the close once on a finding.** Strict, but it punishes what is already done and misfires on an allowed path. Rejected for the finding.
- **Record only, no finding.** Quieter, but nobody would read it unless they ran `tasks` or `verify`. Rejected.
- **`password=` and `token:` as secrets.** More coverage, but examples, documentation and test output would fill the records with findings that are not leaks. Rejected for the strong formats.
- **Expand every glob.** `git add *` and `cat *` would be refused whenever a key sits in the folder. Rejected for the two-literal-characters rule.

## Consequences

- Scorecard checks 5.3 to 5.5 pass; 5.6 (a conformance case per agent) is point 11.
- Records written from this release carry `observed.guarded` (an empty list when nothing got through); older records do not, and are read as before.
- One more regular expression scan per tool result at each close (at most 200,000 characters each).
