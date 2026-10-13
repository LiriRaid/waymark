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
- **Calibration.** A clean measured % (> 0) is saved as a pair (`by: "measured"`), with its model. It improves, with no question to the user, the estimate for the same model in a session without the status line (OpenCode, or Claude Code without it); another model of the same family gets an uncalibrated estimate from it (`calibrate.mjs` `estimate`: pairs of the model first, then of its family). A measured % is never asked. *Amended 2026-10-13 (2.0.3): the first version said these pairs also calibrate Codex; a Claude pair never calibrates a `gpt-*` model.*
- **Install.** `install-hooks.mjs` adds the status line to `~/.claude/settings.json` with the hooks. A status line the user already has is not replaced: its command goes to `~/.waymark/statusline.json` and runs after Waymark's, with the same input.

## Consequences
- The reading lags the turn's last response by one status update, and the % has the precision Claude Code gives. A task below it shows `<1%`.
- With a status line set, Claude Code hides some footer hints (`esc to interrupt`, `? for shortcuts`).
- Only Claude Code is measured. Codex keeps its own weekly window in its sessions, which this machine's sessions did not show; it stays estimated from its own model's pairs, never from Claude's.

## Amended 2026-10-13 (2.0.3): shares per session
Every pick below is the user's (2026-10-12 · T13d and T13e, point 8 of the 2.0.3 plan).
- **Context.** With two terminals working, both spend from the same 5-hour window. A task's difference then held the other session's use too; it was only marked `medido, con otra sesión activa`, and a terminal showed nothing of its own part. Claude Code passes each session's cumulative `cost.total_cost_usd` (estimated at list price; reset by `/clear`) to the status line. The status line runs on events and, with `refreshInterval`, every N seconds (code.claude.com/docs/en/statusline).
- **Split at each reading, by cost.** Each rise of the window's % (a new reading, in the same window) is split among the sessions by what each one spent since it was last paid for. Each session accumulates its share (`own`) in `~/.waymark/.quota.json`. A rise that no session paid for (claude.ai, Codex, another machine) goes to `outside`, never to a session. A new window starts every share at 0. A session's first sight takes its cost so far as the baseline.
- **No double count.** A re-run that brings the session's same reading (the timer) is not a new reading, so it neither replaces the newest one nor is split again.
- **Each terminal shows its part.** The line reads `5h 41% · esta sesión ≈12% · 7d … · contexto …`. The 5-hour % is the newest reading any session wrote, so a quiet terminal shows what the others spent. `install-hooks.mjs` sets `refreshInterval: 30`.
- **The close.** A task shared with another session closes with `≈ 20% de la cuota (medido, con otra sesión activa; esta sesión ≈ 12%, prorrateado por costo)`. The record keeps `quotaOwn`. A share is an estimate, so it never becomes a calibration pair; only a clean measure does.
- **Consequences.** Cost is a weight at list price, not the quota's own accounting, so a share is approximate. A session without a cost in its input (another agent) gets no share; its use shows as `outside`. Until the reinstall, a 2.0.2 status line still running in an open session rewrites its own session entry without the shares.
