# 0066 · A newer Waymark is said in every session from a cached version, and updating is the clean reinstall

**Status:** accepted (2.0.22, in the making). The user, 2026-11-19: on a machine with an old Waymark, asking for a task showed no notice that a newer version exists.

## Context

The notice lived in `waymark.mjs check` (`update()`: a 3 s fetch of main's `skills/waymark/VERSION`). The session card only reminded the agent to run `check` once a week (`checkPointer`, `.check.json`), and the agent had to run it and choose to mention it. A machine that had seen the pointer or run `check` in the last seven days, with no network at that moment, or whose agent skipped it, said nothing; the update path (INSTALL §9) was an in-place copy, not the clean reinstall that leaves nothing of the old version.

## Decision

- `lib/latest.mjs` keeps the newest published version in `~/.waymark/.latest.json` (`{ latest, at }`). The session hook reads it (no network, no wait) and, when it is newer than the installed `VERSION`, adds `updateLine` to the card in **every** session until the install is updated: the two versions, the three answers ("Actualizar ahora", "Más tarde", "Ver cambios") for the agent's choice window, and that "Actualizar ahora" is the clean reinstall of INSTALL.md §12 read from the new version.
- The cache is refreshed by `latest.mjs`, started **detached** by the session hook when the cache is missing or older than six hours (`refreshDue`); it asks main with the 3 s limit, and a failed answer keeps the last known version and only dates the attempt, so a bad network is not asked again at once. `waymark.mjs check` still reports the notice.
- `WAYMARK_NO_REFRESH=1` stops the refresh; the test sandbox sets it, so no test asks GitHub.
- INSTALL.md §12 is rewritten as what was actually done on 2026-10-30 and 2026-11-19: a signature-verified `git archive origin/main`, backup, uninstall, skills replaced (links left alone, a removal that cannot expand to nothing), the skill map merged back, hooks in every agent, the Kiro IDE per project, the Claude Code block by hand, sync, `verify --require-signature`, `check`, cleanup. §9 says that "Actualizar ahora" is §12.

## Consequences

A machine whose Waymark is behind says so at the start of each session as soon as its cache knows, and the cache is at most six hours old when a network exists; with no network nothing is shown (the last known version still is). The card grows by one line only while an update is pending. A Waymark older than this release has no `latest.mjs`, so the notice reaches it only after the reinstall that brings it (the weekly pointer and `check` remain its way until then). Specs in `tests/update-notice.test.mjs`.
