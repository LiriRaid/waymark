# 0064 · A gate's time is no failure, a lost notice file is a finding, and the small seen failures are read against the code

**Status:** accepted (2.0.21, in the making). Failure 20 and the leftovers of failure 10 of `docs/plans/2.0.21.md`.

## Decision

- **A gate's time is no verdict.** `runGate` returns `ok: null` when the limit (40 s) was hit; `W testigos` shows `— typecheck now … over 40 s (not judged)` and its exit does not fail for it (`gateLine`, `gateFails`). A gate that failed (`ok: false`) is still ✘. The stop hook already asked the agent to run its own gate when the hook's re-run timed out; that stays.
- **A lost notice file leaves a finding.** A completed background notice credits a build only after its output file is read; when the file is gone, the build stays owed as before and the record now says why: "a background build's notice named an output file that is gone (…): run it again in the foreground". Nothing new blocks.
- **Failure 20, read against the code, built nothing else.** The 27 tasks were read with the current hook. Evidencia "observada" with no check (9): of the 9, 5 re-judged with today's hook have a check after the last change (replayed on each session's transcript; the earlier verdict came from the hook of the time, cause not proven), 4 cannot be replayed from the transcript; no hole of the hook found. Procedure read after the first change (10): 3 were handed by the hook at the load of the department, which came after the first edit (`handed` and not before the change, by the code's own rule); in 7 the hook handed nothing for the declared department and the agent read the file itself after the first change, and the records do not say why the hook handed nothing (the packed state keeps only each session's last task). First window after the first change (8): 1 OpenCode, 1 Codex, 4 L2 and 2 L1 in Claude Code; the records do not show whether the first edit came before a routing line or under a `Camino:`. Neither group shows a defect of the hook that the records or the code prove; both go to `docs/plans/2.0.22.md` with this evidence, to be read again with tasks of the installed release.

## Consequences

Specs "10:" at the end of `tests/real-use-2021.test.mjs`. The 2.0.22 candidates, none decided: keep the packed state per task so a late procedure can be explained; read the transcripts of the 10 and the 8 with the hook's own attachments.
