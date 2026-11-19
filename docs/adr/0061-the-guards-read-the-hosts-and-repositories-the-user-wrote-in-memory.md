# 0061 · The guards read the hosts and the repositories the user wrote in memory.md

**Status:** accepted (2.0.21, in the making). Failure 17 of `docs/plans/2.0.21.md`: 166 denials of the pre-tool hook in 65 real sessions, none a bug of the guard, but three of them could not be lifted by anything the user wrote.

## Context

The eyes guard (ADR 0047) let an ego script open only the local server and the links of the request (and of the session); the `check` proposal to write the design link in Conventions did nothing. The other-repository guard (ADR 0046) asked once per session for a related repository the user had already listed. The `.env*` denial (ADR 0027) gave no way to find a port or a URL.

## Decision

- **Design hosts:** `memoryHosts` (`eyes.mjs`) reads the hosts of every URL in the Conventions section of the project's `memory.md` (a `Design link: <url>` line or any URL there; not other sections, comments or local hosts). The pre-tool hook (`checkEyes`) and the end-of-turn hook (`observeEyes`) count them like a link of the request.
- **Related repositories:** `confirmedRepos` (`lib/paths.mjs`) reads the `Related projects:` line and returns the names followed by `(confirmed …)`. `checkRepo` (pre-tool) and `reposNotNamed` (end of turn) treat them as named. `(to confirm)`, the mark Waymark writes for a guess, gives nothing.
- **`.env*` denial:** the message adds one sentence pointing to `.env.example`. Who may allow what does not change.

## Consequences

The user's words in `memory.md` now lift two guards. The file is editable by the agent like any `.waymark/` file, so "only the user writes the mark" rests on the user's review, as with `Push: the user` and `PRs:`. Specs "17a", "17b", "17c" in `tests/real-use-2021.test.mjs`.
