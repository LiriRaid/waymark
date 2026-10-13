# 0022 · Agents as data, and the agents Waymark does not know

**Status:** accepted (2026-10-12). Every pick below is the user's (2026-10-12 · T13, point 4b of the 2.0.3 plan). It extends `0021` (every agent with one install).

## Context
- **The user's rule.** Waymark installs once, at user level, and every agent on the machine uses it. That includes an agent Waymark does not know (MiniMax, Qwen or another) and one installed later. When it finds a new agent, Waymark prepares what that agent needs, and only for agents that are installed.
- **The gap in 2.0.3 point 4.** That rule held for the five known agents only. The list was fixed in code, in `connect-agents.mjs` (`AGENTS`) and in `install-hooks.mjs` (`SETTINGS`, `EVENTS`, `MATCHER`, `FLAT`).
- **This machine.** The home folder holds Kiro (`~/.kiro`, its CLI on the PATH), Copilot CLI (`~/.copilot`), Antigravity (`~/.gemini/antigravity`, sharing `~/.gemini` with Gemini CLI) and `~/.quickwork`, an agent no list names. Waymark saw none of them.
- **The documentation** of Kiro, Windsurf, Copilot CLI, Qwen Code, Antigravity, Droid, Amp and Crush was checked on 2026-10-12. Each entry cites its URL. Three facts shape the design:
  - Hook formats differ. Some are nested like Claude Code (Qwen, Droid), some flat like Cursor (Copilot, Windsurf, Crush), some a plugin (Amp), and some their own JSON (Kiro, Antigravity).
  - Not every agent reads `~/.agents/skills`. Kiro, Qwen and Antigravity read only their own folder.
  - Two agents can share one instructions file: Gemini CLI and Antigravity both read `~/.gemini/GEMINI.md`.

## Decision
- **Agents as data.** `skills/waymark/scripts/agents/agents.json` lists every known agent with these fields:
  - its folder and the variable that moves it;
  - its global instructions file, and the files it writes itself (`marks`, for shared folders);
  - whether it reads `~/.agents/skills`, or which folder it reads instead;
  - its hooks (file, format, events, matcher, extra events);
  - its adapter module (`null` when there is none yet);
  - its documentation and the date checked.

  `paths.mjs`, `connect-agents.mjs`, `install-hooks.mjs` and `uninstall.mjs` read this list. Claude Code is in it too, as `primary`, since its `CLAUDE.md` is the install's job and not `connect-agents`'.
- **Unknown agents are detected.** A hidden folder in the home, or a folder in `~/.config`, counts as an agent when it has an agent's signals and is not in `agents.json`. The signals are an `AGENTS.md` or `<NAME>.md`, a `skills/` folder, or a settings file with `hooks`. The shared skills folder (`~/.agents`) and Waymark's own folders are never counted. A tool's folder (`.vscode`, `.docker`) has no signal, so it is not counted either.
- **Minimal level first, with the user's yes.** `connect-agents.mjs` writes the pointer to `.waymark/tasks.md` for every agent found: known ones, and unknown ones whose instructions file it finds. So "¿por dónde voy?" works there from the first prompt.
  - An agent that does not read `~/.agents/skills` gets a step saying where it reads skills.
  - An instructions file two agents share is written once, by the first agent listed. The other is shown as `shares … with …`.
- **The adapter is written, not guessed.** `check` names every agent with documented hooks and no adapter, and every unknown one, in its `agents:` line. The agent running Waymark offers the adapter one agent at a time, and writes it only after the user's yes. It follows `dept-devex` procedures → *Add an agent*:
  1. Research the agent's documentation with `library-docs`.
  2. Write `scripts/agents/<key>.mjs` from `templates/agent-adapter.template.mjs`.
  3. Add its entry in `agents.json` and in `agents/index.mjs`.
  4. Write `adapters/<key>.md` and a spec.
  5. Run `install-hooks --agent <key>`.

  `install-hooks` offers hooks only to agents that have an adapter. For any other agent it names the procedure.
- **Detection does not wait for `check`.** The session hook of any agent with hooks compares the agents found with the ones already seen (`~/.waymark/agents-seen.json`). It names a new one that is not prepared once in the card. The check costs a directory listing and a few stat calls, with no network.

## Consequences
- **New known agents** with no adapter on 2.0.3: Kiro, Copilot CLI, Windsurf, Qwen Code, Antigravity, Droid, Amp and Crush. Each one gets the pointer now, and its hooks once its adapter is written and tested against its documentation.
- **Copilot CLI has its adapter** (2026-10-13, `agents/copilot.mjs`, `adapters/copilot.md`): its hooks under Claude Code's event names give Claude's payload, and its session log (`session-state/<session>/events.jsonl`) is the turn. Built from the documentation; its first live session checks the points listed in `adapters/copilot.md`.
- **Kiro and Antigravity have their adapters** (2026-10-13, `agents/kiro.mjs`, `agents/antigravity.mjs`, `adapters/kiro.md`, `adapters/antigravity.md`): their hooks files have their own shape (format `own` in `install-hooks.mjs`), and each command carries `--event`, since Antigravity's payload names no event. No hook of theirs carries the reply and neither documents its transcript, so the turn is a journal of their hooks (`agents/journal.mjs`), and the Cierre is not applicable there (`lacks`; on Kiro the choice window too, with no question tool). Kiro reads plain text and exit codes: the hooks answer through `answer()` (`agents/index.mjs`), which uses an adapter's `emit()` when it has one.
- **Kiro's and Antigravity's own hook formats, and Amp's plugin,** also need a branch in `install-hooks.mjs` when their adapters are written, as OpenCode's plugin has.
- **The first session after updating** names the agents already installed and not prepared, once. On this machine those are Antigravity, Kiro, Copilot CLI and `~/.quickwork`.
- **A false signal** (a tool that keeps a `skills/` folder in the home) is named once in the card and in each `check`. Nothing is written without the user's yes.
