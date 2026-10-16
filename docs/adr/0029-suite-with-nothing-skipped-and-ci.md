# 0029 · A suite with nothing skipped, todo or failing, and a CI that runs it

**Status:** accepted (2.0.18, point 1)

## Context

A skipped test reads as green and proves nothing. At 2.0.17 the suite had one: the live measurement of the external corpus, which ran only when someone cloned eight repositories and set an environment variable, so in practice it never ran. A second path, `redUntil`, let a regression case be "expected red" and be reported as `todo`. There was no CI: the suite, `verify` and `verify --install` ran only when the author remembered to run them. The scorecard (ADR 0028, checks 4.2 to 4.5) asks for a suite that cannot hide a test and for a place where it runs without the author.

## Decision

1. **Nothing skipped, todo or only.** `tests/gate.test.mjs` fails if any `tests/*.test.mjs` skips, marks todo or restricts a test (the pattern is the scorecard's check 4.2, read from `docs/scorecard.json` so the two cannot drift), and if a corpus case carries `redUntil`. The `todo` option and the `redUntil` field are gone from `tests/corpus.test.mjs`: every case must be green.
2. **`scripts/gate-tests.mjs`** runs the suite three ways and fails unless each run reads `skipped 0, todo 0, fail 0` with at least one test and a runner summary: the default run, `--test-concurrency=1`, and a copy of the working tree under the OS temp folder (tracked and untracked files that git does not ignore, as its own git repository), so no test depends on running beside another or on where the repository lives. `--once` runs only the first, for the loop of a change. A cancelled test or a run with no summary is not clean.
3. **Fixtures instead of clones.** The live test is replaced by two tests over `tests/external/fixtures/`: the committed trees of the eight repositories that `tests/external/corpus.json` already pins. Stack detection reads only the names at the top of a repository (and an Android module's manifest one level down) and the text of a few manifests, so a fixture is those names as empty files, the manifests with their real text at the pinned commit, and an empty stand-in for the task's sample file; no source code is copied (93 KB in total). `tests/external/make-fixtures.mjs` rebuilds them from the pinned commits with a blobless fetch (network, once); `fixtures.json` records, per repository, the commit and the file list, and a test fails if a fixture differs from it or from the commit the corpus pins. The measurement runs on a copy of each fixture as its own git repository, outside this one, so no project memory is shared.
4. **CI** (`.github/workflows/verify.yml`): on every push to any branch, every pull request and every `v*` tag, on Ubuntu and Windows with Node 24, with a read-only token: the gate script, `waymark.mjs verify`, and `verify --install`. On a release tag only, `verify --install --require-signature`: the manifest is regenerated, and so unsigned, at every point that adds a file, so requiring its signature on a branch would keep it red until the release. The two third-party actions are pinned to a commit with the tag in a comment (`actions/checkout` v7.0.1, `actions/setup-node` v7.0.0, chosen as the latest release more than two weeks old); `tests/gate.test.mjs` fails on an action pinned to anything else.

## What this found

- The measurement's scripted task claimed an Evidencia "observada" for a documentation edit with no check after it. The stop hook has since learned to refuse that, so the recorded 2.0.16 results ("no block on the scripted tasks") were stale for the documentation task. The instrument now writes an honest `inferida de … (check: …)` when there is no gate to run; the recorded result files are history and stay as they were.
- The CI has never run on GitHub. It was validated by running its three commands locally and by the test that reads the workflow; its first run on a pushed branch is the first real one.

## Alternatives considered

- **Keep the live test, run it in CI with clones.** Needs the network and eight clones on every run, and a clone moves when a repository is rewritten. Rejected for pinned fixtures.
- **Copy each repository's real README and sample source into the fixtures.** Closer to the clone, but copies other projects' text into this repository for nothing the detection reads. Rejected.
- **Require the manifest's signature on every push.** Stricter, but red from the first point of a release until the author signs at the end. Rejected for tags only.
- **Pin actions by tag.** A movable tag is not a pinned input. Rejected.

## Consequences

- Scorecard checks 4.2 to 4.5 pass. Check 9.x and the rest are unchanged.
- The suite takes about three times as long under `gate-tests.mjs`; `--once` is for the loop of a change and the three runs are for the end.
- A test that needs the network or a tool that is not on every runner has nowhere to hide: it must be a fixture or it does not belong in the suite.
- The fixtures name the eight repositories only by the ids and commits already in `corpus.json`; no new project is named.
