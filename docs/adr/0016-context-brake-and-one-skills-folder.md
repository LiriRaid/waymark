# 0016 · Context brake, one project-skills folder, no-change tasks recorded

**Status:** accepted (2026-10-06, Waymark 2.0.0-dev). Every pick below is the user's (2026-10-06 · T8). It amends 0015.

## Context
- **Large sessions cost the most.** A session past ~150k tokens took about 8% of the plan quota per task. Every response re-reads the whole session, even when the new task has nothing to do with the old ones. The card, tasks.md, engram and the git notes already carry the work over, so a new session loses nothing.
- **Project skills were per agent.** Claude Code reads only `<project>/.claude/skills`. Codex, OpenCode and Gemini CLI read `<project>/.agents/skills`. A skill Codex generated was invisible to Claude Code.
- **A push blocked for a decision.** In a task that changed no project file (a `git push` the user asked for), the end-of-turn hook blocked for a choice-window answer. The action had already run, and its message said "changed files".

## Decision
**Context brake.** Updated in T11 at the user's request: the default threshold is 300k tokens, up from 150k, to prioritize longer sessions while stopping before context grows too large. It costs 0 tokens and happens once per session. The message is kept in `.waymark/next-prompt.md`, and the next session's card brings it, after the card's cap so it is never cut. Sending it again in the same session continues there. `WAYMARK_BRAKE_TOKENS` tunes the threshold, and 0 turns it off.

How each agent stops the message, verified at the installed versions:

| Agent | How the message is stopped |
|---|---|
| Claude Code | `{"decision":"block","reason"}` |
| Codex 0.160 | the same shape (`user_prompt_submit.rs`) |
| Gemini CLI | BeforeAgent `{"decision":"deny","reason"}` |
| OpenCode | the plugin shows the reason as a toast and throws from `chat.message`, which runs before the message is saved or the loop starts |

An agent with no way to stop a prompt gets one line in the reminder instead.

**One project-skills folder.**
- A project skill is written to `<project>/.agents/skills/<slug>-<topic>/`.
- The session hook mirrors every project skill between `.agents/skills` and `.claude/skills`. The `.claude/skills` side is kept only where Claude Code is installed. The newer copy wins, timestamps are preserved, and nothing is deleted.
- OpenCode reads both folders; identical copies only log its duplicate warning.

**No-change tasks.** A task that changed no project file records a missing choice-window answer (✘ in the evaluation) instead of blocking. The pre-tool gate still stops file changes before the user is asked. The block message names such a task as "task (no project file changed)".

## Consequences
- The first message to a large session is held once. The user decides whether to move to a new session or to resend the message and stay.
- `.agents/skills` and `.claude/skills` both hold project skills. Whether they are committed is the project's choice; the skill procedure offers `.gitignore`.
