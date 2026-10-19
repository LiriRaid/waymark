# 0040 · Every hook runs through a launcher that finds a Node able to run it, and the update notice is tested

**Status:** accepted (2.0.18, point 12). Amends ADR 0008 (how hooks are registered) and ADR 0028 (what the result section says about check 1.10).

## Context

Ten tasks of 2.0.18 (T19 of 2026-10-16 to T1 of 2026-10-18) have a commit and a `Waymark-Task` trailer and no record: the chain verifies and the detail does not exist (check 1.10, 0.533). The first reading was that those tasks were closed before the full-record hooks were installed. The transcripts say otherwise. In the sessions of points 3 to 11 the end-of-turn hook failed 13 times each with `SyntaxError: Unexpected token '??='` from `stop-hook.mjs`, marked by the agent as a non-blocking error. The agent starts a hook with the first `node` on the PATH, and the author's version manager had been left on Node 14 while working in other projects. Observed on this machine: under Node 14 the session and per-prompt hooks run, and the end-of-turn hook does not parse. A task whose end-of-turn hook does not run is not recorded, its Cierre is not checked, its notes are not written and its anchor is not signed, and nothing says so. The same thing happens in every other project of the author whenever the active Node is old.

The notice that a newer release exists was never tested: `check` compares the installed `VERSION` with `main/skills/waymark/VERSION` and the session hook only points to `check` when the last one is more than a week old.

## Decision

The choices are the user's (2026-10-19): a launcher, the lost records left as a documented gap, and a tested notice that requires the signature on update.

- **`scripts/hook-run.cjs`.** Every hook is registered as `node "<scripts>/hook-run.cjs" "<scripts>/<hook>.mjs" …` (`hookCommand` in `install-hooks.mjs`; the OpenCode plugin and `hooksHealth` do the same). The launcher is plain CommonJS and ES2015, so any Node that can start it can read it (a test fails on `??`, `?.`, `async`, `await`, spread or an optional catch binding). With Node 18 or newer it imports the hook in the same process, with `process.argv` as if the hook had been started directly: no second process per call. With an older Node it hands the hook, with the same stdin, arguments and exit code, to the first of `WAYMARK_NODE`, the Node `install-hooks --apply` pinned in `~/.waymark/node` (its real path, not the version manager's link, which moves with `nvm use`), and the newest nvm version of 18 or more (nvm for Windows and for Unix). With none it prints a `systemMessage` saying that the hook did not run and that the task is not recorded, writes the same words to stderr and exits 0, so it never breaks the agent.
- **The hook script stays in the command.** Everything that recognises Waymark's entries by `waymark/scripts/<hook>.mjs` (`ours`, `OURS_ANY`, `registered()`, `uninstall`, `connect-agents`) keeps working, and a hook registered the old way is updated to the new form by the same plan, never duplicated.
- **The minimum is 18** (`MIN` in the launcher and `MIN_NODE` in `install-hooks`, one test keeps them equal). INSTALL already asked for it; now a hook enforces it. The suite runs on Node 24 in CI and on Node 18 once for this release (see the changelog).
- **The lost records stay lost.** A record rebuilt afterwards from a transcript is not what the hook observed, and a chain that holds it would present as proof something nobody saw. Check 1.10 rises with the tasks that are recorded from now on; this ADR and the README say what the gap is and why.
- **The notice.** `update()` is exported and its source is `WAYMARK_UPDATE_URL` when set, so a test serves versions from localhost: newer is offered with its three answers; equal, older, an error page, a 404 and no server say nothing. INSTALL §9 now ends by running `verify --install --require-signature` before the update is reported as done: the notice is a comparison of two numbers, the signature is the proof.

## What it proves and what it does not

A hook registered by this version runs on any machine that has a Node of 18 or more reachable by one of the three routes, whatever `nvm use` left active, and says so when none is. It does not cover hooks registered by an older version until `install-hooks --apply` runs again (INSTALL §9 does it for every agent), the status line (it is not a custody hook and shows its own error), or an agent that cannot run a command at all. `check`'s probe runs under the Node that runs `check`, so it cannot see the old-Node case; the launcher's message is the signal. The notice still arrives only when `check` runs, which the session hook asks for once a week.

## Alternatives considered

- **Make every hook parse on Node 14.** A `??=` here and a missing `fetch` there: a chase with no end, for a Node that is past its support. Rejected for a minimum that is enforced.
- **Register the absolute path of the Node that installed the hooks.** Fixes the nvm switch and breaks when that version is uninstalled, silently. Rejected; the pin is only one of the routes.
- **Only report the gap (`check` and `verify` say "N tasks have no record").** Cheaper, and after the fact. Kept as what `tasks` and check 1.10 already show.

## Consequences

- Hooks run through one more file; in-process the cost is a dynamic import, with an old Node one more process per call.
- The author's installed hooks keep the old form until the clean reinstall of this release registers the new one.
- The scorecard is unchanged (check 1.10 reads the records, which only new tasks can improve), and its lock is untouched.
