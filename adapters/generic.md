# Adapter · any other agent

Use this when no specific adapter fits.

| Key | Value |
|---|---|
| `<skills-dir>` | the agent's documented user skills folder; if none, `~/.agents/skills` (cross-agent convention) |
| `<project-skills-dir>` | the agent's project skills folder; if none, `.agents/skills` |
| `<instructions-file>` | the agent's global instructions file; most agents read `AGENTS.md` |
| `<project-instructions-file>` | the agent's project instructions file; most agents read `AGENTS.md` at the project root |
| Skill loading | if the agent has no skill tool, the instructions block tells it to read `<skills-dir>/<name>/SKILL.md` |

An agent without an adapter has no Waymark hooks: its instructions file gets the pointer block (`POINTER` in `connect-agents.mjs`, written by hand after the user's yes), so it reads `.waymark/tasks.md` first and "¿por dónde voy?" shows the last task, whichever agent did it. The block's "hooks installed but no card" alarm does not apply to it. Giving it the full chain costs one module in `skills/waymark/scripts/agents/` (the exports of `claude.mjs`) plus its entry in `install-hooks.mjs` and `connect-agents.mjs`.

What changes:
- Ask the user where the agent reads global instructions if its docs do not say.
- MCP: register the servers from INSTALL §7.1 with whatever the agent supports, or skip them (`library-docs` then falls back to official docs on the web).
- Record the chosen paths in `~/.waymark/agent.md` so every department knows them.
