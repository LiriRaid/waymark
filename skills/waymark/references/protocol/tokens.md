# Protocol · Token economy

Read when a session grows large, before launching a sub-agent, or when `W check` reports the session size.

Every response re-reads the whole context, so what enters it is paid again on each later step (`measure.mjs` → *Ctx* column shows the growth per prompt; `size.mjs` shows what Waymark itself adds):
1. **Small tool outputs and searches.** Search with the Grep/Glob tools (they skip `node_modules` and ignored folders); a recursive shell `grep`/`find` from the root hung 120 s in real tests. Ask for the part you need: `head`/`tail`, `grep -n` with `-m`, line ranges when reading, `git diff --stat` before the full diff, `--json` + a filter instead of whole dumps. Never print a log, lockfile or build output in full. Write a script to a file and run it instead of an inline `node -e` holding backticks, `${` or regex escapes (shell quoting mangles it and it "succeeds" broken). Never `git stash` the user's changes: prove a pre-existing failure in a clean `git worktree` copy (`dept-qa`).
2. **Sub-agents are not free.** Each one re-reads its own context on every step (measured: one broad research task cost 6.5M sub-agent tokens). Use one only for a broad search whose conclusion is all you need; read known files yourself.
3. **`/compact` is safe mid-task** once the plan and its state are in *Work in progress* (`protocol/l3.md`): the session hook re-injects them.
4. **A large idle session is expensive to resume.** After about an hour without messages the prompt cache expires and the next message re-writes the whole context as new input (measured: 502k tokens for one line). A new task is cheaper in a new session; project memory carries over. `W check` reports a large or idle session in the folder.
5. **Unused listings cost every session:** `skill-fit.mjs` (skills never invoked) and `mcp-fit.mjs` (framework servers a project does not use); `W check` reports both.
