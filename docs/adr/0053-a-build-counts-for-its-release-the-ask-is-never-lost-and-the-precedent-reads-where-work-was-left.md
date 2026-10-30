# 0053 · A build counts for its release, the ask is never lost, and the precedent reads where work was left

**Status:** accepted (2.0.20, completion). The lock of ADR 0049 does not move: no weight, criterion or threshold changed.

## Context

With `VERSION` at 2.0.20-dev the card measured the release on three tasks: the tasks made with the build's hooks before the bump (from its first install on 2026-10-29) carry the stamp of the previous release, because the stamp is the `VERSION` file at that moment. Checks that read records (1.2, 5.1, 8.6, 8.7) judged a sample of three and moved by one task: 1.2 read 0.667, 5.1 0.870, 8.6 0.103 and 8.7 could not be measured. Two real defects sat under the numbers. A user message that carries a status note of the app (`<system-reminder>…`) in its text was not read as a prompt at all, so a task whose messages all began with it kept an empty ask (the record of one task read 1.2 down). And ego on the app's sign-in page counted as a look at the screen, so the sign-in gap never reached the close in the real flow, only in the unit test. Check 10.3 read 0.757 against 0.85.

## Decision

1. **`skills/waymark/BUILD_START`** holds the time the build of the measured release was first installed. A record stamped with an older release and written from that time counts as the release (`writtenBy`, `lib/version.mjs`); a newer stamp, an unstamped record and a record before the time keep what they had. Records are never rewritten (the chain and the signatures hold). The file is shipped and listed in the manifest; a release that starts a build writes it once.
2. **The ask is the words of the user.** `promptText` removes `<system-reminder>…</system-reminder>` blocks: a message with words after the note is a prompt, a message of the note alone is none. For a record already saved with an empty ask the card takes the first prompt of its session when the transcript is on this machine (read-only, only in the card; without the transcript nothing changes).
3. **A look at the sign-in page is no look.** `afterLastChange` is false while the newest look landed on the app's `/login`; the page counts only when it is the address the call landed on (the first thing ego prints), so a `/login` link inside a list of links or a line of source pauses nothing. The gap asks in the choice window ("Ya inicié sesión" / "Aún no") and waits, with no Cierre.
4. **Check 10.3 reads where work was left.** The precedent search adds three signals to the words: the two folders above each file a task changed (an ask names an area before it names a file), the start of the task's Cierre, and a third ranking of the 30 newest tasks fused by rank (RRF, same constant). A task found only by being new has no score and is never handed over; the hand-over is the first of the three best that resembles the ask. Held-out on this repository: 0.757 → 0.856; the hand-over reaches the right task first in 0.698 of its cases (was 0.615). The parameters were chosen on this author's own tasks (136 eligible): a different set of tasks may read lower, and the check says so by being measured again.
5. **Small ones.** A `hecho` that left testigos unresolved says how many and the first, in the line the user reads; the real-use report shows per project how many tasks that used ego went back at every finished step.

## Alternatives considered

- Wait for twelve more perfect tasks: honest but the release could not be measured at the close.
- Rewrite the stamps of the records: breaks the hash chain and the signatures.
- Count a hub file (the changelog, the manifest) as no relevance in 10.3: measured, it lowers the number (0.757 → 0.56 at 10 %), so the hubs were not the limit and the metric was not touched.
- Recency alone for 10.3: 0.794; folders alone 0.772; together with the Cierre text 0.853.

## Consequences

- Positive: the card judges the build on every task made with it; the empty ask and the sign-in look are fixed at the cause.
- Negative: a pre-release stamped older and written after `BUILD_START` is counted as the release even if it was written by an older copy left installed; `BUILD_START` is a maintainer's date to set once per release.
- Follow-up: check 9.9 (a real task on another agent) and the other agents are 2.0.21.
