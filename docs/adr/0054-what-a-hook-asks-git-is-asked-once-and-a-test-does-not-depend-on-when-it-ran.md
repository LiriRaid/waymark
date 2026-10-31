# 0054 · What a hook asks git is asked once, and a test does not depend on when the checkout was made

**Status:** accepted (2.0.20). Builds on ADR 0032 (token levers measured before kept) and the refs read from files (2.0.19).

## Context

`~/.waymark/latency.log` of 230 closes showed the Stop hook at a median of 1 s and a p95 of 10 s, and the per-prompt hook at 144 ms (p95 1.4 s). Measured on a clean clone, the typecheck the hook re-runs was already cached by tree; what was left was git: the per-prompt hook started six git processes (218 ms of about 400) and the close seven (264 ms), among them `git log -n 500 --name-only` (74 ms) and a `rev-parse` for the root and another for HEAD.

The CI of the release tag failed on Ubuntu in two of three runs: `tests/latency.test.mjs` called `latencyLine(now)`, which ignores the rows older than `MANIFEST.json`'s date; on a fresh checkout that date is seconds old and the test's rows (a minute old) fell before it.

## Decision

- The last 500 commits of HEAD are kept on disk by HEAD (`<WAYMARK_HOME>/cache/headlog/<worktree>.json`); a commit never changes, so the log of a HEAD never does. A file that is damaged or for another HEAD is a miss.
- The working-tree snapshot takes the root from the per-run memo (`topOf`) and HEAD from the repository's files (`headSha`), so it starts one git process (the state) plus the root once, where it started three. A repository with no commit has HEAD `null` (it was the text `HEAD` that git prints when it fails).
- The latency test passes `since = 0`, as the other cases of that file do: its result must not depend on when the checkout was made.
- No testigo changes: the full suite (1394) and the card give the same verdicts. `tests/speed.test.mjs` counts the git processes and checks the cache against a moved HEAD and a damaged file.

## Measured (clean clone, same machine, 10 runs each)

The per-prompt hook: median 503 → 310 ms. The pre-tool hook: 167 → 146 ms.

## Consequences

- One JSON file per worktree in the cache folder (a few hundred KB at most); nothing removes the old ones.
- What stays slow is a typecheck the hook must re-run when the agent ran none: that is the testigo, not an overhead.
