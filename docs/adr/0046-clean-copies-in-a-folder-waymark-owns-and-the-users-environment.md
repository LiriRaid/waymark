# 0046 · Clean copies in a folder Waymark owns, and the safety of the user's environment

**Status:** accepted (2.0.19). Extends ADR 0010 (every applicable step blocks once), ADR 0037 (what the guard can and cannot stop) and ADR 0045 (a permission the user gives works).

## Context

Real use showed Waymark and the agents it directs leaving things on the user's machine and acting on their accounts:

- **Clean copies left behind.** The testigos that ask for a clean copy of HEAD (a failure shown at HEAD, a spec red before its code) said `git worktree add <tmp>`; the session's scratch path was too long for Windows, so the agent invented `C:\yawt-*` folders with a full `node_modules`, and `git worktree remove` could not delete them: six orphans at the disk root. A junction to the repo's `node_modules`, made to avoid the install, let the package manager of the copy purge the project's own dependencies. The test suite left 892 `wm-*` folders in the temp folder (115 `mkdtempSync` against 83 `rmSync`).
- **The user's accounts and processes.** The agent switched the `gh` account and opened pull requests nobody asked for, wrote a migration by hand where the project has its own backup-and-migrate script, edited a repository the request never named, handed over a command with `!` for the wrong shell, and was handed an option label that said two things ("apply and run") which left the second undone under a task marked `hecho`.
- **An address in the public repository.** The release's `ALLOWED_SIGNERS` carried the author's personal e-mail as the principal.

## Decision

- **Waymark owns the copy.** `waymark.mjs copy [<ref>]` makes it in a numbered folder under `~/.waymark/tmp` (a git worktree, with the stack's install step printed: from the package store, never a link), `copy --remove <path>` takes it away with a retrying delete and checks it is gone (only a child of that root is ever removed), and `copy --clean [--apply]` plans, and with the user's yes removes, what nobody removed: the root's own copies and the improvised or test folders (`yawt-*`, `wm-*`, `waymark-*`, `tmp.*`) older than six hours in the OS temp folder and at the top of the disk. `check` says how many there are. The testigos name this command instead of `git worktree add <tmp>`, and a run in the root, or its command, counts as a clean copy. The end-of-turn hook removes the copies its task made and says how many; one it cannot remove is named.
- **A junction or link to a `node_modules` is denied** before it runs (`mklink /J`, `New-Item -ItemType Junction|SymbolicLink`, `ln -s`), with the alternative.
- **The test suite makes one root and removes it.** Each test process creates `wm-test-<pid>-…` and points `TMP`, `TEMP` and `TMPDIR` into it (its children inherit them), so every temp folder a test makes, removed or not, lives inside it and goes when the process ends; `gate-tests` fails a run that leaves a `wm-*` or `waymark-*` folder.
- **The account and the pull requests are the user's.** `gh auth switch|login|logout|refresh|setup-git` is denied always; `gh pr create|merge|ready` only passes when the task's own words ask for a pull request. Waymark reads `git config user.email` and `gh auth status` when it needs to know whose they are and never writes either anywhere; the public `ALLOWED_SIGNERS` names its key under the wildcard principal `*`, so it carries no address (a tag signed by that key still verifies with git's own check; the published history is not rewritten).
- **A repository the request does not name is asked first.** The Pedido line gains `Repos: <each repo it touches besides this one>`; a change in another repository is denied once, naming it and asking the user in the window; the repository named in the Pedido, or by the user's answer, goes through, and the end-of-turn record keeps the repos it named and a finding for one it changed without naming.
- **The project's own migration script comes first.** A Conventions line `Migrations: <command>` makes a migration file written by hand under a migrations folder denied once, naming the script. The first build only read a line somebody had written, so the guard never acted. Now the session hook writes the line itself once, marked "to confirm" and never over one somebody wrote, with the command read from the repo: a `package.json` script that makes a migration (not the ones that only deploy or report status), Prisma with no script, Rails, Django, Alembic or Laravel. `dept-data` generates migrations with it first.
- **What the user chose in the window is an item of the ask.** Each option picked and each free-text answer must be named in the Cierre (an item counts as answered when most of its significant words appear in it); one left out or marked ✘ keeps `hecho` from standing in the record (it reads `parcial`, with the reason) and is a finding, never a block; a chosen label that holds two actions is flagged.

## Alternatives considered

- **Only the message with a path, no command.** The agent made the folder itself, which is what produced the long-path orphans. Rejected.
- **Delete every `wm-*` and `waymark-*` folder older than a minute on `check`.** Another process of the user's may own one; six hours and the user's yes. Rejected.
- **The hook rewrites the e-mail out of the history.** The user did not choose to rewrite what is published. Rejected: the file stops carrying it, the history stays.
- **Block, not only record, an unanswered window choice.** The Cierre names a choice in its own words and a fuzzy match would block honest tasks. Rejected for the record and the finding.

## Consequences

- A task that uses a clean copy leaves none: the close removes it. A copy a task did not make (another task's, older than this one) is not touched.
- Every test file now sees an `os.tmpdir()` inside its sandbox; a test that checks the machine's own temp folder must say so.
- A task that really needs to edit two repositories asks once per repository and names both in the Pedido.
- A "sí" or a pull request asked in other words ("sube el cambio para revisión") is denied once, with the reason; the user says "PR" and it goes through.
