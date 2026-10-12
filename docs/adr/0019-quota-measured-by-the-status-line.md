# 0019 · The quota % measured by the status line

**Status:** accepted (2026-10-12). Every pick below is the user's (2026-10-12 · T4). It amends the quota estimate of `calibrate.mjs` (2.0.0).

## Context
- **The % was always a guess.** The end-of-turn line estimated a task's share of the quota from the user's own pairs, which were the tokens of a closed task and the % the user read and typed. With no pairs there is no %, only the question. A clean reinstall moved `~/.waymark/calibration.jsonl` to the backup, and the next task (YaloAtiendo-Chat, 2026-10-12 · T1, 2.93M tokens) showed no % at all.
- **Claude Code knows the real value.** The JSON it passes to a status line holds `rate_limits.five_hour.used_percentage` and `resets_at`, plus the 7-day window. They are present for claude.ai Pro and Max, after the session's first response (code.claude.com/docs/en/statusline). Hooks do not get them.
- **The window is the account's.** Every session, and claude.ai itself, spends from the same 5 hours, so a difference between two readings holds whatever ran in between.

## Decision
- **Waymark's status line** (`scripts/statusline.mjs`) prints `5h 23% · 7d 41% · contexto 18%` and keeps `~/.waymark/.quota.json`. That file holds the last reading and the last time each session's tokens moved. Each session's task start lives in `~/.waymark/.quota-starts.json`, written only by the hooks, so a status update never overwrites a start. Writes go to a temporary file renamed into place, because several sessions write them.
- **Start and end.** The per-prompt hook keeps the reading at the task's first prompt; a later prompt of the same task keeps it. A reading whose window ended before the prompt starts a new window at 0. The end-of-turn hook subtracts the start from the latest reading, and the start is cleared when a record is written (task or question), as the token count is.
- **No clean measure, no measured %.** There is no measure when no reading came after the start, when the window reset during the task, or when the difference is negative. The estimate is shown as before.
- **Shared.** When another session's tokens moved during the task, the line says `medido, con otra sesión activa` and no pair is saved. The user's use of claude.ai cannot be seen.
- **Calibration.** A clean measured % (> 0) is saved as a pair (`by: "measured"`). The estimate for Codex, OpenCode and a session without the status line improves with no question to the user. A measured % is never asked.
- **Install.** `install-hooks.mjs` adds the status line to `~/.claude/settings.json` with the hooks. A status line the user already has is not replaced: its command goes to `~/.waymark/statusline.json` and runs after Waymark's, with the same input.

## Consequences
- The reading lags the turn's last response by one status update, and the % has the precision Claude Code gives. A task below it shows `<1%`.
- With a status line set, Claude Code hides some footer hints (`esc to interrupt`, `? for shortcuts`).
- Only Claude Code is measured. Codex keeps its own weekly window in its sessions, which this machine's sessions did not show; it stays estimated from pairs.
