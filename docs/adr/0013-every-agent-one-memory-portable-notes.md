# 0013 · Every agent in the chain, one memory, notes that travel

**Status:** accepted (2026-10-05, Waymark 2.0.0-dev, steps 3d and 3f). Every pick below is the user's (2026-10-05 · T13). It extends 0008 and 0009 to Gemini CLI and OpenCode. It narrows 0012's *Work in progress*, and it replaces 0012's manual-only push of notes.

## Context
After the 3e tests, three gaps kept Waymark from being one supply chain:
- **Two agents were outside the chain.** Gemini CLI and OpenCode had only the pointer line: no gate, no testigos, no record.
- **Redundancy.** A closed task's Aprendido lived twice: its record (git note or log) and its *Work in progress* line. engram worked as a second memory that the Recordar testigo required whenever it was installed.
- **Records stuck to one commit.** Notes travelled only with `waymark.mjs notes push`. A rebase or amend left a note on a commit the branch no longer has.

## Decision
**Gemini CLI (`scripts/agents/gemini.mjs`).** Gemini 0.39 has command hooks almost like Claude Code's. This was verified in the hooks reference and in the installed bundle:
- **Where and which events:** `~/.gemini/settings.json`, with `SessionStart`, `BeforeAgent`, `BeforeTool` and `AfterAgent`.
- **What the hooks answer:** `additionalContext` adds context. `{"decision":"deny","reason"}` denies a tool, or, from AfterAgent, sends the reason back so the agent continues. `systemMessage` is shown to the user.
- **Tools:** `run_shell_command`, `write_file`, `replace`, `read_file`, and `ask_user` (the choice window).
- **Transcript:** append-only JSONL. The last line of each message id wins, and `$rewindTo` drops later messages.
- **The adapter:** maps all of this to the core's shape. A `read_file` of a `SKILL.md` is the department's invocation. `install-hooks --agent gemini` writes the four hooks with Gemini's own event names.

**OpenCode (`scripts/agents/opencode.mjs` + `opencode-plugin.js`).** OpenCode has no command hooks, only JS plugins (verified in the plugin docs and the hook types).
- **The plugin:** `install-hooks --agent opencode` installs it as `~/.config/opencode/plugins/waymark.js`. It runs the same four scripts:
  - `session.created` and `chat.message` → context added through the system transform;
  - `tool.execute.before` → a deny throws, so the tool does not run;
  - `session.idle` → a block is sent back once as a prompt.
- **What the adapter reads:** before each call, the plugin writes the session's messages from the SDK, so the adapter reads them, not the undocumented database. It reads:
  - the `question` tool (the choice window) and its `metadata.answers`;
  - the `skill` tool (the invocation);
  - `apply_patch` files;
  - the tokens.
- **Risk:** the system transform is marked experimental by OpenCode. If it changes, the context stops reaching the model, but the gate and the record keep working.

**One memory.**
- **Work in progress** keeps only open (▶) tasks. A task done, or confirmed with `done`, leaves its line: its Aprendido lives in its record and in `tasks.md`. Older ✔ lines move to `history.md` at the next close.
- **Recordar** applies at L2+ always, with or without engram. Waymark's own memory satisfies it (`waymark.mjs pack`, `memory`, `tasks`, or reading `.waymark/memory.md`). `mem_search` also counts, for whoever uses engram.

**Notes that travel and survive.**
- **With the push:** when the agent pushes the task, the end-of-turn hook pushes `refs/notes/waymark` to the same remote. Pushing at all is the user's request. A failure is reported, never forced.
- **After a rebase or amend:** at session start, one `git log` of HEAD finds each task whose note sits on a commit the branch no longer has. It copies that note to the branch's commit carrying the same `Waymark-Task`. The note is copied, not moved, so the chained stub still matches. Git's config is never changed.

## Alternatives considered
- **OpenCode through its SQLite database:** rejected. It is not documented; the SDK is.
- **Keep ✔ lines (the newest 5):** rejected by the user. It is the duplication this step removes.
- **`notes.rewriteRef` and a push refspec in each repo's git config:** rejected by the user. It changes the user's repos. The copy-by-trailer repair needs no configuration.
- **Gemini only, OpenCode later:** rejected by the user. The chain would not cover every agent on the machine.

## Consequences
- Claude Code, Codex, Gemini CLI and OpenCode run the same four links and write one chained record per task, each with its agent.
- A closed task appears once: in its record. *Work in progress* is what is still open.
- Projects without engram are now held to a memory search at L2+. `pack` is the cheap way to meet it, and the context card already asks for it.
- **Verified only by tests** (synthetic transcripts in the formats read from each CLI's code and from local OpenCode sessions): the Gemini transcript reader and the OpenCode plugin's live behavior. The final test runs one L1 task per agent.
