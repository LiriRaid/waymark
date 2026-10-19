# 0042 · The public repository holds no data of the projects Waymark runs on

**Status:** accepted (2.0.18). Amends ADR 0012 (the records ride as git notes), ADR 0035 (the notes reach a remote) and the corpus of 2.0.15 (`tests/corpus.test.mjs`).

## Context

On 2026-10-19 the author found two things on the public `LiriRaid/waymark` that should never have left the machine:

- **A recorded turn from a client's project.** `tests/corpus/yalo-t1-clean-copy.json` was a session on YaloAtiendo, a private CIT project, trimmed for the regression corpus, and it still held parts of that project's source (`auth.controller.ts`, `sessions.service.ts`, `package.json`) and its paths. Four more cases held the author's prompts and the paths of their CIT folders.
- **The task records, prompts included.** The end-of-turn hook pushed `refs/notes/waymark*` to the remote on **every** push the agent made, without the per-project yes of ADR 0035: that yes only covered the push at each close (`autoPushNotes`). The author's preferences had no `Notes push:` line, and the notes reached GitHub anyway.

Waymark is an open-source supply-chain tool. If it collects the projects it runs on, nobody can contribute to it or install it without exposing their own work.

## Decision

The author's rule (2026-10-19): what Waymark learns stays on the machine of the person who installed it. A real project may be **named** (to show that Waymark ran on real work), but its code, its prompts and its paths never go into the repository.

- **Notes only with the project's yes.** The hook pushes the notes after an agent's push only in a project listed on `Notes push:` (`pushPref(slug) === 'yes'`, `stop-hook.mjs`). With no yes, the notes stay local notes and the testigo `notes` does not apply. Its claim now says so: "after a push in a project that said yes, its notes on the remote". `check` still offers the yes, with the privacy warning of ADR 0035.
- **Check 7.1 measures only what was agreed.** `notes.unpushed` counts the note commits a remote lacks only in a project on `Notes push:`; with no yes, or `never`, the records stay on the machine by design and nothing waits. The card and its lock do not change: the measure reads the same preference the hook does.
- **Fixtures are synthetic or redacted.** `tests/privacy.test.mjs` fails on any versioned fixture (`tests/corpus`, `tests/reference`, `tests/external`, `tests/conformance`) that holds the home folder of a real user (`C:\Users\<name>`, `/Users/<name>`, `/home/<name>`; placeholder names such as `dev`, `u` or `runner` pass), and on any recorded turn (`tests/corpus`, `tests/external/*.json`) that holds an address outside `example.*` and noreply. The manifests copied from public repositories in `tests/external/fixtures` keep their authors' public addresses: they are the upstream file, not a turn.
- **The history is purged.** The five cases are removed from every commit with `git-filter-repo`, limited to the commits that descend from the one that added them, so the earlier hashes do not change. With the release, the remote's `refs/notes/waymark*` are deleted, the tags of 2.0.16 to 2.0.18 are signed again, and the author asks GitHub Support to purge the pull requests that still reference the old commits (#24, #25). `waymark-t7c-reinstall-script.json`, a turn on Waymark itself, was kept with its paths redacted to `C:\Users\dev` and its message id replaced.

## Alternatives considered

- **Never push notes at all.** Simpler, but it removes `verify --remote` and the per-project yes that ADR 0035 gave a user who wants their records on their own private remote. Rejected by the author.
- **Also forbid session ids and prompts in every case.** Stricter, but every one of the 15 cases would have to change, for data that is no longer real once the paths are redacted. Rejected by the author.
- **Clean only from now on.** It would have left the client's code readable in the history of a public repository. Rejected.

## Consequences

- A project that never said yes never publishes a record, whoever pushes and wherever.
- A new corpus case from a real session must be redacted before it is committed: the privacy test names the file and the user name it found.
- The commits after 2026-10-15 have new hashes. A clone made before the purge needs `git fetch` and a `reset` to the new branches, not a `pull`.
