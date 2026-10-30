# 0051 · What the first real tasks of checkpoint B showed, and the measures of the card

**Status:** accepted (2.0.20, level 3: points 5, 6, 24 and 29 to 33). Amends ADR 0050 (a Cierre over a review still running is deferred, and the end-of-turn hook blocks once per task, not once per turn) and ADR 0047 (the eyes read a script given by stdin). The lock of ADR 0049 is untouched: no weight, criterion or threshold of the scorecard moved.

## Context

The first real task of checkpoint B (the real-use project, Claude Code, `2.0.20-dev`, two repos, ego, two screenshots) closed 10 of 12 with Build and Ojos red although the agent had built both repos and used ego; it showed four Cierre-like messages and two blocks; it applied 4 of the 10 findings of its review and left 6 without asking. Twelve days of real transcripts (434 ego calls) gave the shapes the detectors had to read: 151 calls handed the script by `ego-browser nodejs < file`, which was not read, and two real build forms (`tsc -p tsconfig.build.json --outDir <temp>`, `node …/@angular/cli/bin/ng build`) that were not credited.

## Decisions

1. **The eyes read the script ego is given** (29): a file redirected into stdin (`< file`, absolute or relative to the command's `cd`) or piped by `cat`, as it stood at that call. The verdict lines of the Cierre also count with a dot, a comma, a parenthesis or the end of the line after igual, parecido or falta.
2. **A build is read by what it emits** (30): `tsc` with `-b`, a tsconfig named build or an `--outDir`, unless `--noEmit`; `node` running a framework CLI (`ng`, `nest`, `vite`, `next`, `nuxt`, `astro`, `tsc`…) is judged as that CLI by its verb. A task that changed two repos is told which one has none.
3. **One Cierre, one block** (31): a turn with background work pending is deferred even when its reply holds a Cierre; a task is blocked once, a later turn that still lacks something is recorded in red with what was left unresolved, and a close with no Cierre is always blocked. The first change of an L2+ task hands the order: code and spec, code-review waited for, its findings, the final gate, the build of every repo and the eyes, one Cierre last.
4. **Every decision and every finding is answered** (32): over 4 items the agent lists all and asks in calls of 4; the review's findings are the user's to decide, listed with `file:line`, severity and a recommended action. A rule in the block and in the L2 protocol, not a testigo: the hook cannot know how many decisions were foreseen.
5. **Two small ones** (33): a task keeps the ID its prompt was handed across midnight; a folder that ends in a role word (`-api`, `-web`…) is named by that word in what the user chose in the window.
6. **The held message arrives whole** and `held-full.md` is no longer made; an earlier one is removed.
7. **The card measures what it says** (24): 8.2 counts Waymark's own skills (itself, the `dept-*`, the owned tool skills), not every skill the machine has; 8.3 reads the reminder with the typical task and git line, not this working tree's; 10.3 takes as relevant only the earlier tasks of other sessions, the ones the hand-over searches (a miss no search could avoid is no miss: 0.712 to 0.750); `W check` reads the latency of the installed copy since its MANIFEST.json was written, not seven days across a reinstall (finding 62).
8. **CI runs on every push to develop** (5), and INSTALL.md gets the clean-reinstall recipe in the order that worked (6).

## Not built (listed so none is lost)

Check 9.9 needs real tasks on OpenCode (the repo card alone reads one agent) and the user's list of projects in `~/.waymark/projects.md`; the OpenCode adapter's images and token split (25); the Node installer (7, waits for the design traits the user has not written); 13.5 defined by the files and not by the letter, 1.10 without the phantom task of a signing commit and one test per class for 11.2 (24, they pass today); the algorithm of 10.3 (0.750 against 0.85); the review of the tests for Linux and Windows runner differences (5, only a run on the runners shows it). `VERSION` is still 2.0.19: raising it to 2.0.20 leaves the card with no record of its own version (81.8 % in a simulation) until tasks run on it, so the close decides how a version with few tasks is read.

## Consequences

The instructions block is 6,480 of 6,500 characters. A turn that waits for its review is never blocked for the Cierre it wrote early, and a task shows one block at most, so the second Cierre the user saw cannot come from the hook again. The scorecard on this repo reads 99.1 % with only 9.9 and 10.3 red.
