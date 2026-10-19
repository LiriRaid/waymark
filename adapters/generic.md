# Adapter · any other agent

Use this when no specific adapter fits.

| Key | Value |
|---|---|
| `<skills-dir>` | the agent's documented user skills folder; if none, `~/.agents/skills` (cross-agent convention) |
| `<project-skills-dir>` | the agent's project skills folder; if none, `.agents/skills` |
| `<instructions-file>` | the agent's global instructions file; most agents read `AGENTS.md` |
| `<project-instructions-file>` | the agent's project instructions file; most agents read `AGENTS.md` at the project root |
| Skill loading | if the agent has no skill tool, the instructions block tells it to read `<skills-dir>/<name>/SKILL.md` |

An agent without an adapter has no Waymark hooks: its instructions file gets the pointer block (`POINTER` in `connect-agents.mjs`, which writes it after the user's yes: for an agent listed in `skills/waymark/scripts/agents/agents.json`, and for an unknown one whose `AGENTS.md` or `<NAME>.md` it finds), so it reads `.waymark/tasks.md` first and "¿por dónde voy?" shows the last task, whichever agent did it. The block's "hooks installed but no card" alarm does not apply to it. `W check` names it, and the session card says it once. Giving it the full chain: `dept-devex` procedures → *Add an agent* (a module from `templates/agent-adapter.template.mjs` and its entry in `agents.json`, `docs/adr/0022`).

What changes:
- Ask the user where the agent reads global instructions if its docs do not say.
- MCP: register the servers from INSTALL §7.1 with whatever the agent supports, or skip them (`library-docs` then falls back to official docs on the web).
- Record the chosen paths in `~/.waymark/agent.md` so every department knows them.
