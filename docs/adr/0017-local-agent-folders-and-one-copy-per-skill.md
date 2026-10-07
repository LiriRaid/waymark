# 0017 · The agents' folders stay local, one real copy per skill, fewer extra responses

**Status:** accepted (2026-10-06, Waymark 2.0.0-dev). Every pick below is the user's (2026-10-06 · T10). It amends 0015 (engram travels with the repo) and 0016 (the project-skills mirror). It also carries out the skill tiers the user set on 2026-10-06 · T9.

## Context
The three-agent test after 0016 ran four tasks in `landing-flujo`: Claude Code ("Volver arriba"), Codex (the `landing-section` project skill), OpenCode (the FAQ search) and a commit by each. One Cierre per task held, and so did the trailers, the card's learned lines across agents and the skill mirror. Seven gaps showed up:
- **`.engram/` in the commits read as a mistake.** OpenCode saw `.engram/` staged by the hook and offered to amend the commit and ignore the folder. The user's answer: the agents' folders stay out of git, like `.waymark/`.
- **The skill was copied, not shared.** The mirror left a second real copy in `.claude/skills`. It was untracked, so it showed in every `git status`, and it cost Codex one more question before its commit.
- **Agents still ran `pack`.** The hook handed the pack over, yet Claude Code and Codex also ran it, because the testigo read "the project memory searched (waymark.mjs pack) before the first change".
- **OpenCode saved to engram by hand.** engram's MCP instructions ask for `mem_save`, so OpenCode called it and three `mem_judge`. The hook already saves the same Aprendido, so that is four responses for a duplicate.
- **Codex waited on its own question.** After `request_user_input_async` it ran `sleep 30s` and `wait`, and the answer still came as the user's next message.
- **A commit-only task scored ✘.** For "haz commit" the user's order is the decision, but Decision applied and scored ✘ (T5b 6/7).
- **A follow-up ID for unrelated work.** Codex titled a new skill task as a follow-up of Claude's footer task (`T5c`). The hook recorded it as `T6`, so the Cierre and the record disagreed.

Two smaller items from earlier tasks: a project skill's `name` must equal its folder (`landing-section` was named `landing-flujo-landing-section`), and the context brake left `next-prompt.md` behind when the user resent in the same session.

## Decision
**The agents' folders stay local.**
- `ensureLocal` adds `.waymark/`, `.engram/`, `.agents/` and `.claude/skills/` to the project's `.gitignore`, each line once. The rest of `.claude/` (settings, launch.json) stays the project's.
- The pre-tool hook no longer runs `engram sync` or stages `.engram/` before a commit (`stageForCommit` removed).
- engram keeps the learned memory in its local store. Every agent on the machine reads and writes the same store through the hooks.
- What travels with the repo: commits, trailers and git notes. What stays on the machine: the learned memory and the project skills.

**One real copy per shared skill (`skill-links.mjs`).**
- **Project skills.** The skill lives in `<project>/.agents/skills/<name>`, and `name` equals the folder. The session hook links `<project>/.claude/skills/<name>` to it: a junction on Windows (no admin rights needed), a relative symlink elsewhere.
- **Waymark's skills (tier 1).** They live in `~/.agents/skills`, and `~/.claude/skills/<name>` links to each one. The installer and `node skill-links.mjs --user [--apply]` do it. Only Waymark's own skill names move. A per-agent skill (tier 2) stays where the user put it.
- **A real folder on Claude Code's side.** If it is a copy or a skill written there, it moves to `.agents/skills`, and the newer content wins. The folder it replaces goes to `~/.waymark/backups/skills-<date>/`, never deleted.
- **No link possible.** A copy is kept, as the fallback. Like the link, it is ignored by git.

**Fewer extra responses.**
- **Recordar.** The testigo now reads "each file's memory pack, handed by the hook at its first edit (never run pack)". The card says the same.
- **engram.** The instructions block says the hook saves to engram; the agent never calls `mem_save`.
- **Codex.** After `request_user_input_async`, Codex ends its turn, with no sleep and no wait.
- **Decision.** It does not apply to a task that changed no project file (a commit, a push, an install the user ordered). The pre-tool gate still asks before any file change.
- **Task ID.** The per-prompt line says a follow-up "continues that task's files".
- **Card.** A learned line whose body repeats its title shows the body alone.
- **Context brake.** A resend in the braked session removes `next-prompt.md`.

## Consequences
- A teammate's clone and the user's other machines do not get the learned memory or the project skills. Moving them is a manual step (engram export/import, copying `.agents/skills`).
- The four agents' user-level folders were verified before the move (see *Verified folders*). On this machine the 17 skills moved to `~/.agents/skills` with a backup, and Claude Code reaches them through junctions. The hooks keep their `~/.claude/skills/waymark/scripts` path, which resolves through the junction.
- OpenCode reads both `.claude/skills` and `.agents/skills`: one skill through two paths only logs its duplicate warning (0016).

## Verified folders (2026-10-06)
| Agent | User skills it reads | Links | Source |
|---|---|---|---|
| Claude Code | `~/.claude/skills` only | a skill folder "can be a symlink" (docs). A junction is unverified without a model call: check `/skills` in a new session | code.claude.com/docs/en/skills |
| Codex 0.160.1 | `$CODEX_HOME/skills` (deprecated), `~/.agents/skills` | directory links followed (a junction observed); a linked `SKILL.md` file is skipped | `codex-rs/ext/skills/src/host_roots.rs` |
| OpenCode 1.18.35 | `~/.claude/skills`, `~/.agents/skills`, `~/.config/opencode/skills` | followed (glob `follow: true`, a junction observed) | `packages/opencode/src/skill/index.ts` |
| Gemini CLI 0.62.0 | `~/.gemini/skills`, then `~/.agents/skills` (wins a clash) | junctions followed (`gemini skills link` makes them) | `skillManager.ts`, `docs/cli/skills.md` |

## Follow-up (2026-10-07 · T1): hooks through a link
**What broke.** After the move, every hook was still registered as `~/.claude/skills/waymark/scripts/<hook>.mjs`, which is a junction to `~/.agents/skills`. Node runs a linked main script from its real path. Each script's guard compared `process.argv[1]` with `import.meta.url`, so the two never matched and the hook exited without doing anything, in all four agents. Three tasks were never recorded: T10 (Claude) and two Codex tasks. Codex's commit `dab8811` got no note.

**Decision (the user's picks):**
- Every script's main guard compares real paths, and a test runs two hooks through a link.
- `install-hooks.mjs` re-registered the hooks of the four agents from `~/.agents/skills`. Codex asks to trust them again in `/hooks`.
- The missing records were rebuilt from the transcripts, as the hook would have judged them, and marked `reconstructed`:
  - T10 (Claude), 8/10, the note on `dab8811`;
  - T11 (Codex, its Cierre said T10), 6/10;
  - T12 (Codex), 3/4.
- Recordar does not apply to a task that changed no project file: with no first edit, there is no pack to hand over. Decision already did not apply in that case.
- INSTALL §11 replaces a 1.x install with a clean 2.0. Waymark is released as 2.0.0.
