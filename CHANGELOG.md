# Changelog

The installed version is in `<skills-dir>/waymark/VERSION`. When a newer version is published the agent offers the update; you can also say *"actualiza Waymark desde https://github.com/LiriRaid/waymark siguiendo su INSTALL.md"* (INSTALL §9).

## 2.0.18 — a scorecard that cannot move, and Waymark measured against it
Every review of 2.0.17 found different gaps because "95 %" was never written down. This release writes it as 13 weighted criteria computed by checks and builds what the failing checks asked for: the total went from 33.2 % to 98.9 % when its last point closed, and reads 98.1 % at the close of the release, with token efficiency and provenance below their own targets (README, ADR 0028 *Result at 2.0.18*).
- **The scorecard (ADR 0028).** `waymark.mjs scorecard` runs 81 deterministic checks and prints each criterion and the total, never rounded up; `docs/scorecard.json` is locked by a hash, so a weight, a check or a threshold changes only with a new ADR.
- **A suite with nothing skipped, todo or failing, and a CI (ADR 0029).** `scripts/gate-tests.mjs` runs it three ways and fails otherwise; the live external test became two tests over committed fixtures; `.github/workflows/verify.yml` runs the gate and `verify` on push, pull request and tag.
- **Record schema v2 (ADR 0030).** `taskType`, `asked`, options with their attributes, `reworkFiles`, `cost.byCall`; v1 and v2 are read together.
- **Cost, measured (ADR 0031, 0032).** `waymark.mjs cost` per version and level, `bench/replay.mjs` over the same recorded tasks, thresholds frozen from the baseline. What Waymark injects is about 0.9 % of a task and the routine 8 to 13 %; the fixed context went from 11,815 to 10,888 characters and the per-prompt reminder from 245 to 211.
- **Precedent (ADR 0033).** A similar earlier task is handed over in at most 400 characters, offline, no model: precision@3 0.87 held out against 0.66 by chance.
- **Signed anchors and attestations (ADR 0034).** The anchor is signed when the task closes, `attest --out` writes a signature, and `verify` reports signed by a key, revoked, outside its validity, or unsigned.
- **The notes reach a remote (ADR 0035).** With the author's per-project yes the stop hook pushes them at each close; `verify --remote` compares the remote's anchors with the local records and names the first task that differs.
- **Inputs pinned (ADR 0036).** The engram release (`engram.pin.json`) and the vendored third-party skills (`skills.lock`); a test fails on a dependency of our own.
- **The guard and its detection (ADR 0037).** A shell command that names a protected path is refused through globs, flags, redirects, revisions and other shells; where no hook can refuse, the end-of-turn hook reads the transcript and records what got through. The matrix says *prevent* or *detect* for every guarded action and agent.
- **Done as asked, and decisions you can judge (ADR 0038).** The ask is kept as numbered items and the Cierre answers each one; the first choice window is judged on its options carrying risk, files or cost and a recommendation; `tasks.md` shows the claims a call backs and the tasks whose files came back.
- **Conformance, handoff, drafts and a reference bench (ADR 0039).** 35 behavioural cases run through the real hooks for each of the eight agents (it found four defects between an adapter and the hooks); a task is handed round all eight agents; `adapter-new` and `stack-new` draft an adapter and a stack profile and judge the draft by the same list; `bench/reference.mjs` measured eight read-only reference repositories and its findings are fixtures.
- **Hooks that no longer die in silence (ADR 0040).** Ten tasks have a commit and no record because the end-of-turn hook failed to parse on the Node 14 a version manager had left active, and the agent treated it as a non-blocking error. Every hook is now registered as `node hook-run.cjs <hook>`: the launcher (plain CommonJS) runs the hook in its own process on Node 18 or newer, hands it to `WAYMARK_NODE`, the Node pinned by `install-hooks --apply` (`~/.waymark/node`) or the newest nvm version of 18 or more on an older Node, and says so in a message the agent shows when there is none. Checked here under Node 14; the suite on Node 18.20.8 passes 809 of 812 (the three are test-runner differences, ADR 0040). The ten records stay a documented gap.
- **The update notice, tested (ADR 0040).** `check` offers a newer release found on `main` (observed against GitHub); a test serves versions from localhost, and INSTALL §9 now ends with `verify --install --require-signature` before an update is reported as done.
- **Qwen Code, Droid and Amp (ADR 0041).** Three adapters written from their documentation, with a driver in the conformance list each: Qwen Code (`~/.qwen/settings.json`) and Droid (`~/.factory/hooks.json`, the events as top-level keys) speak Claude Code's protocol with their own tool names; Amp is a plugin (`~/.config/amp/plugins/waymark.js`) that runs the hooks on its plugin events. All three journal their events, judge no Cierre or choice window, and enforce the card, the guard, the trailer, the record and the end-of-turn block. Check 9.1 goes from 8 of 13 to 11 of 13; none has run in a live session, and each `adapters/<agent>.md` lists what the first one must confirm.
- **No data of the projects Waymark runs on (ADR 0042).** The end-of-turn hook pushed the task notes, prompts included, on every push the agent made; now it pushes them only in a project on `Notes push:`, and with no yes they stay local. `tests/privacy.test.mjs` fails on a fixture with a real user's home folder or, in a recorded turn, a real address. Five corpus cases from real sessions, one with a client project's code, were removed from the whole history; the commits since 2026-10-15 have new hashes.
- **CI green on Linux and Windows.** The first runs of `verify.yml` found what the author's machine could not: Windows runners reach the temp folder through an 8.3 short name while git reports the long one, so the git root is now spelled the way the folder the agent works in is, and the scratch rule, the secret scan and `sameDir` compare paths as the filesystem spells them (`lib/paths real`); on a case-sensitive filesystem `mcp-fit --restore` finds a project by its lower-case key (`realFolder`); a relative path keeps its meaning in the scratch rule; `gate-tests` prints why each test failed. The notes testigo is shorter (check 8.2) and check 7.1 counts notes waiting only in a project that said yes (ADR 0042). The suite passes its three runs on both systems.
- **What Waymark is, and how to help.** The README and INSTALL name it the supply chain of AI-agent work. `CONTRIBUTING.md` explains the difference between a pattern (what the work taught about Waymark, reusable by anyone) and a case (your code, prompts and paths, which stay with you), and how to share one with the *Pattern report* issue form or send a change against `develop`. Every task recorded so far ran on Claude Code, so reports from other agents matter most; 2.0.19 is the baseline the next releases are measured against.
- **Not in this release.** Adapters for Windsurf (no session start, no way to hand the model context) and Crush (one event, before a tool): they could carry no record or Cierre, so check 9.1 stays at 11 of 13; the routine-share thresholds 8.6 and 8.7; a live A/B of tokens, an adapter in a live session of its own agent, several models, and machine learning over the records (3.0.0).

## 2.0.17 — stable tests, an install that verifies itself, and Waymark measured on real work in eight other repositories
2.0.16 left four things short of the level the author wants: a suite that gave different results on different runs, an install that reported `DIFFERS` after a normal `sync`, a validation outside the author's projects that measured detection but never an agent at work, and commands in the documentation that failed when typed. Design and limits: `docs/adr/0027` (amendments in sections 6 and 13).
- **Stable tests.** A project whose root lives under a scratch folder (the OS temp folder, `/tmp`, a scratchpad) is a project: `exemptPath(file, root)` in `lib/paths.mjs` replaces two copies of the same rule, so the `2b` spec no longer depends on where the checkout is. Waymark's own `.gitignore` lines are written before the per-prompt snapshot: the first turn of every new project read them as its own change, and the tests had hidden it because their repositories sat under temp. Every test file imports `tests/helpers/isolate.mjs` first: a throwaway home, and none of the session's `WAYMARK_*`, `CLAUDE*`, `CODEX_*`, `GEMINI_*`, `CURSOR_*`, `COPILOT_*` or `XDG_*` variables. The suite passes with `--test-concurrency=1`, with the default and from a checkout under the OS temp folder. The two intermittent failures of 2.0.16 did not reproduce in three runs, so their cause is not claimed; the isolation removes the ones that were suspected.
- **An install that verifies itself.** The manifest leaves out the two files `sync` rewrites for each machine (`skill-map.json`, `skill-registry.md`, checked against their generator instead) and the body of the `## Learned rules` / `## Learned notes` sections the learning step writes. The release carries `MANIFEST.json.sig`, made with `manifest.mjs --sign <ssh key>` and checked with `ssh-keygen -Y verify` against `ALLOWED_SIGNERS`: `verify --install --require-signature` passes on a clean install that is no git clone, and fails on an edited manifest (`BAD signature`), an edited file (`DIFFERS`) and a key nobody trusts.
- **No other project is named.** Documentation, decision records, changelog, comments and tests say "an orchestrator already installed" and use `acme-orch` as a sample namespace; a test fails if the name of another project appears in a tracked file. Detection was already generic (any `<!-- name:section -->` block), so no marker list moved to a data file.
- **Commands are written the way they run.** `waymark.mjs` is a script, not a program on the PATH. The messages the hooks print carry `node "<path>/waymark.mjs" <command>` (`WAYMARK_CMD`); README and INSTALL show the same form; text the agent reads says `W`, the command the session card defines. No launcher is installed. A test fails if a document shows the bare name as a command. The instructions block did not grow.
- **Waymark used on real work in eight repositories.** Five public repositories became eight (a Kotlin Android app, a multi-language monorepo and an embedded C library added) and in each an agent made one small real change twice, before and after the fixes below: `tests/external/results-2026-10-16.json`, with what was not measured. `Verificar` failed in 6 of 8 runs before and 2 of 8 after. What changed: a change that only touches comments owes no gate, spec or build (`lib/comments.mjs`; a directive to a tool such as `@ts-ignore` counts as code); a gate whose tool is not installed, or a run that was refused, is "the gate could not run here" and is accepted with `no comprobado (<why>)` or, after the block, `Resultado: parcial (<why>)`, instead of counting as a failure or as nothing; stacks `c` (CMake, Make) and `android` (Gradle with a manifest) with their detection; `cmake --build`, `ctest`, `make` and the Gradle `assemble*`, `test*`, `lint*` and `compile*` tasks are gates, tests or builds; the measuring script no longer holds a fixed task ID. Six real transcripts, trimmed, are regression cases in `tests/corpus/`.
- **Not in this release.** No toolchain of those repositories was installed on the machine of the run, so whether a gate passes there is not measured; each run happened once with one model; creating `.waymark/memory.md` stays the agent's job (6 of 8 runs wrote one, then 3 of 8); no token comparison with any other tool and no saving is claimed. Candidates for a later release: a hook that writes the memory bootstrap from the detected stack, an A/B of tokens, signing each record; machine learning over the records stays for 3.0.0.

## 2.0.16 — a chain anyone can verify, a cheaper routine, documentation that cannot drift
The record of each task was chained by hash and anchored in git, but only a test could check it, the cost of the routine was argued and not measured, and a claim in the README had no source. Design and limits: `docs/adr/0027`.
- **Cost per link.** The evaluation keeps `links` (schema v1): the task's responses and tokens split into routine, work and reply, measured on six real sessions (`docs/audit-context.md` §3).
- **Review by risk.** The review testigo applies at L2+ only for L3, a sensitive or critical path (secrets, migrations, auth, payments, CI), more than 4 code files or 100 lines, or a size that cannot be counted; a small change records `omitido: riesgo bajo`. Limits and paths are `risk` in `routine.json`; a project overrides them in `.waymark/risk.json`; `WAYMARK_REVIEW_MODE=always` restores the old rule.
- **Procedures by the hook.** At the task's first change the hook hands the owner department's `procedures.md`, once per task; the procedure testigo counts the delivery as the read and still blocks when nothing was delivered or read.
- **Less injected.** Skill descriptions 4,888 → 3,492 characters; the per-prompt reminder 475 → 221 here (the rule line 279 → 99); the held message 1,306 → 637, its whole text kept in `.waymark/held-full.md`. The fixed context per session went from 13,029 to 11,494 characters (`size.mjs`). No token comparison with any other tool was made.
- **`waymark.mjs verify [--install] [--require-signature] [<task ID>]`.** Checks the chain (naming the first broken task and why), the installed files against `skills/waymark/MANIFEST.json`, and the release tag against `skills/waymark/ALLOWED_SIGNERS` with git's own verification. Each record keeps the signature state of its commits.
- **`waymark.mjs attest <task ID>`.** One task as an in-toto statement; `verify --attestation <file>` checks it. The file itself is not signed.
- **Sensitive-path guard.** Reading or editing `.env*`, `~/.ssh`, `~/.aws`, `~/.config/gcloud` and key files is blocked where the agent's hook runs before the tool (Claude Code's `Read` joins the matcher: register the hooks again after updating), with the `.env.example` family, the project's `allow` and the user's `Sensitive allow:` line as exceptions. The bypasses a search or a script can use are tested and stated.
- **Pinned inputs.** Each record pins by hash the department's `SKILL.md` and `procedures.md`, `routine.json`, the profiles read, the project's risk override and the manifest; `verify <task ID>` compares them with the release. Records carry `schema` (`waymark.record/v1`) and an `outcome` label.
- **Capability matrix.** README and INSTALL carry a table, generated from `agents.json` and the adapters, of what each agent enforces and what it is only asked to do.
- **Validation outside the author's projects.** Five public repositories (Rust, Laravel, Terraform, Python data science, documentation only) are measured read-only. The first run found Rust, PHP and Terraform undetected, a Laravel repository classed Node and gates unrecognised; closed with detection, three stack profiles generated from the template (`rust`, `php`, `terraform`) and classifier verbs. The rest of the ecosystems planned (mobile, a multi-language monorepo, embedded C) move to 2.0.17.
- **Documentation.** The README says what Waymark is and what it is not, with each statement tied to a test; its size table and ADR index are generated; INSTALL's sample messages and the evaluation template are in English. `tests/docs.test.mjs` fails on a version mismatch, a drifting figure, Spanish prose outside the quoted phrases, a missing ADR in the index or a command that does not exist.
- 384 tests (329 → 384), one skipped (the live external run, which needs clones).
- **Not in this release:** signing each record or the attestation file, a token A/B against another tool, any published cost comparison.

## 2.0.15 — one command classifier, an open failure, and no copies
Every release since 2.0.7 patched a different testigo for a false ✘ or ⚠ (`docs/adr/0026`). This one removes the cause and the redundancy behind it.
- **A regression corpus first.** `tests/corpus/` holds real turns (YaloAtiendo T1 and five waymark turns with a false ⚠) and `tests/corpus.test.mjs` replays them through `cierreGaps`. A fix lands with its case.
- **One classifier for what a command runs: `scripts/runs.mjs`.** `commandKind` answers `copy`, `unknown`, `build`, `gate`, `test` or `aux`; the shell parsing (`shellSkeleton`, `shellRuns`, `mutatesFiles`, `changesProject`) moved there. The testigos no longer read a command's text with their own regex.
- **Open failure.** A gate or test run the hook cannot place (a clean copy, a temp or scratch folder, a variable nothing assigns) is recorded as `apart`: never the judged gate, never a red test, never «a command after the last change failed». The hook blocks only on evidence it can read.
- **Evidencia reads what a person writes.** A command with its quoted path, a short phrase one call holds together, `84/84` from «tests 84 … pass 84», a file name whose stem a call printed, a result stored as escaped JSON. Still a ⚠, never a block.
- **`cierreGaps` split** into the observation of the turn (`observeTurn`, `observeBuild`, `observeEvidence`) and one function per testigo; `routine.json` says which apply.
- **`scripts/lib/`.** One `norm`, `slash`, `waymarkHome`, `read`, `readJson`, `writeJson`, `git`, `sha` and the packed state, instead of ~40 copies in 19 scripts; no hook imports from another hook.
- **`provenance.mjs` split** (900 lines, 63 exports) into `scripts/provenance/`: ids, secrets, project, chain, records, tasks, taskmd, decisions, snapshot. The file stays as the facade the 13 importers use; no cycles; a module exports only what another uses.
- **`agents/lines.mjs`.** The choice-window question and its answer line, built once for the seven adapters.
- Measured, nothing removed: `calibrate`, `statusline`, `skill-fit`, `mcp-fit` and `measure` add no context tokens (on-demand scripts); the user kept them.
- 329 tests (306 → 329) and the corpus. No change of behavior in the splits.

## 2.0.14 — git holds what was done, why and what for
In YaloAtiendo 2026-10-15, deleting `.waymark` (and the local notes the remote never had) lost the why of tasks T1–T4b. Only the commit messages were left. After this version, a clean reinstall resumes from git alone (`docs/adr/0012`, `0013` and `0025`, amended).
- **Fix: notes the hook could not push.** In T4b, the hook's push of the notes failed («make sure you have the correct access rights»): its process had no credentials, while the same push worked from the agent's shell. It was only a note in the summary line. Now, after the record is written, the close **blocks once** and asks the agent to run `node waymark.mjs notes push` from its shell in each repo (new testigo `notes`). The next stop checks the tracking refs and says whether the notes reached the remote.
- **Fix: a task in two repos had a note in one.** The API commits of T4b carried `Waymark-Task` and got no note. Now the record is a note on the task's newest commit in each repo where it committed (`repos` on the record). The notes are pushed in each repo the turn pushed, to the remote each push named.
- **What has no commit is in git.** A question (`kind: "Q"`), a task closed without a commit and a confirmation lived only in `provenance.jsonl`; the user's «las opciones A y C» was lost that way. Now each line, as chained, is appended to a note on HEAD under `refs/notes/waymark-log`. The same refspec glob, push and line-by-line merge carry it. `forget` removes its lines there too, and a copy merged back is skipped by the rewrite anchor.
- **A clone or a cleaned project starts from git.** In a repo with no `.waymark/`, the session hook adds the fetch refspec and fetches the notes. The fetch has 5 s, no credential prompt, and runs at most once a day while the repo has no `.waymark/`. The hook then merges the notes and rebuilds `.waymark/memory.md` (*Work in progress* from the records) and `tasks.md`.
  - With no record for a task ID, its `Waymark-Task` commits stand in: «solo commit», with the commit's message. Such an ID is taken for new tasks and still valid to close.
  - A fetch that fails is one line on the card.
- The instructions block quotes the new claim and stays under 6,500 characters.
- **Fix: three false ✘ from YaloAtiendo 2026-10-15 · T1** (`docs/adr/0012`, amended):
  - **A note in a gate's Command cell was run.** The bootstrap said «mark them *not verified*», so the cell held `pnpm exec tsc -p tsconfig.app.json --noEmit (not verified)` and the typecheck failed. Now a closing note in parentheses with no shell characters is dropped before the command runs (one after `&&` is a subshell and stays). The bootstrap now says to leave the *Verified* cell empty.
  - **A lint with warnings only failed.** `✖ 1 problem (0 errors, 1 warning)` with exit 0 matched the failure line. Now eslint's line counts only with errors.
  - **The clean copy.** The agent created the worktree in one call and ran the lint there from another (PowerShell, its own variable). That run counted as the task's gate, and it failed on pnpm's own check: a junction to `node_modules` made pnpm want to purge the folder (the repo's own, through the link) and abort without a TTY.
    - A call naming the path a `git worktree add` created now runs in the clean copy, never as the gate.
    - In a Node repo the hook's message gives the install for the copy (`pnpm install --offline --frozen-lockfile` with `CI=true`; npm, yarn and bun have their own) and says never to use a junction.

## 2.0.13 — a build per repo, and counts are not results
- **Fix: Build ✗ on a task that built every repo.** The Build testigo counted only the builds after the turn's last code change and wanted one per repo with changed code. YaloAtiendo 2026-10-15 · T3 changed the API and the front, built both (exit 0), then wrote only the front's `main.spec.ts` and rebuilt only the front. The API had not changed since its build, yet the task scored Build ✗.
- Now each repo needs a build that passed after the last code change **in that repo**. A code change made from the shell names no repo, so it still counts for every repo; a build or file whose repo is unknown matches any, as before (`docs/adr/0020`, amended).
- **Fix: Evidencia ⚠ for counts.** `29/86/326/15/1` (counts before and after, in YaloAtiendo 2026-10-15 · T4) was read as two pass/total results, `29/86` and `326/15`, that no call showed. A chain of three or more numbers joined by `/` is no longer a fact to back; `84/84` still is (`docs/adr/0025`, amended).

## 2.0.12 — the context brakes wait for the task
- **Fix: a large task was stopped mid-work.** The size brake (300k, then every 100k) and the idle brake (100k, idle over an hour) fired on any message, task finished or not. A big YaloAtiendo task was braked while working, and again when it resumed after the quota ran out. Opening a new session mid-task rebuilds what the old one held, so it costs more than continuing.
- Now both brakes wait for the task:
  - While the session's task is in progress, no message is braked, at any size (600k, 800k). In progress means: it started and has no Cierre yet (a turn the quota cut, a reply waiting on you), or its last Cierre says `Resultado: parcial` or `bloqueado`.
  - The first message after a Cierre `hecho` brakes as before, once per step, and a resend continues.
  - Another session's open task does not count (`docs/adr/0016` and `0018`, amended).

## 2.0.11 — red before the code, judged per spec
- **Fix: a task that did test-first scored Tests ⚠.** The red testigo took the task's first spec edit and asked that no code came before it. YaloAtiendo 2026-10-14 · T2 wrote its two new specs from the shell (`cat > … <<EOF`) and ran them red before any code (`Cannot find module`). Then it fixed the mocks of two existing specs after the code, a refactor with no new case. The hook did not see the shell's specs, took those mock edits as the first spec, and the agent had to write `Tests: no (…)`.
- Now red is judged per spec:
  - A spec that adds cases (a new spec, or a new `it()`/`test()`, RSpec `it "…"`, `def test_`, `func TestX(`) must run before the next code edit after it was written.
  - If code changed before that spec, the run must fail: a green there proves nothing.
  - A spec that only adjusts setup or mocks only has to pass.
  - A spec the shell wrote counts as written in that call.
  - The message names the specs left. A run in a clean copy still covers all of them.
  - With this, T2 passes ✔ (`docs/adr/0012`, amended).

## 2.0.10 — a path backed by the folder it listed, and a task below 1% measured instead of asked
- **Fix: a path the agent listed scored «sin respaldo».** `ls prisma/backups | tail -1` prints only `2026-10-14T15-38-44-344Z`, so the cited `prisma/backups/2026-10-14T15-38-44-344Z` was in no single place (YaloAtiendo 2026-10-14 · T1, Evidencia ⚠). Now a path is also backed by a call whose command named its folder and whose output printed its whole name. With the fix, that task's 7 cited facts are all backed (`docs/adr/0025`).
- **Fix: a task that stayed below 1% asked «¿qué % marcó tu cuota?».** The 5-hour reading only moves when its % moves. A task from 37% to 37% had no reading after its start, so it was not measured, and with no calibration pairs its close asked. Now the status line updating the session after the start, with the same reading, measures it as 0: `<1% de la cuota (medido)`. A Claude session the status line watches is never asked its %. The question stays for agents without a status line (`docs/adr/0019`, amended).

## 2.0.9 — file:line backed when it was read, and «sin respaldo» as a ⚠
- **Fix: a `file:line` the agent did read scored Evidencia ✘.** A `grep -n` over one file prints `45:`, not the file's name, and Read prints `45→`, so the literal `auth-callback.ts:45` was never in any output (YaloAtiendo 2026-10-13 · T3f). Now a `file:line` is also backed by a call that named that file and printed that line: grep's `45:` or `45-`, Read's `45→`. A name that only ends another file's name, such as `callback.ts` for `auth-callback.ts`, does not count. With the fix, T3f's four cited facts are all backed.
- **«sin respaldo» is a ⚠, not a ✘.** A cited fact no call shows (an honest paraphrase, say) still goes in the record and in the findings. Evidencia now shows ⚠ and counts as passed: `Evidencia ⚠ · … · 10/10 · 1 ⚠`. Before, it lowered the score. tasks.md lists it with the declared exceptions (`⚠ Evidencia`), and an Evidencia «observada» with no check after the last change still blocks (`docs/adr/0025`, amended).

## 2.0.8 — the log anchored in git, forget, and an Evidencia backed by a check
- **The log is anchored in git** (`docs/adr/0025`). Each record also appends `{m, n, hash, at}` to a note on HEAD under `refs/notes/waymark-anchor`: the log's length and last hash. A log rewritten by hand and chained again, or cut, no longer passes the chain (`chain broken … the log no longer holds a line anchored in git`). The anchors travel with the same fetch, push and merge as the task notes. Another clone's or machine's anchors are kept but not checked.
- **`waymark.mjs forget "<task ID>" | --session <id> --reason "<why>" [--apply]`** removes records without a commit that you ask to remove. It chains the rest again and leaves a rewrite anchor with your reason, what was removed and the head before and after, so the removal shows instead of hiding. Without `--apply` it only shows the plan. A committed task is refused, because its record is the commit's git note.
- **New testigo, Evidencia** (blocks once): an Evidencia «observada» needs a check after the last change. A read, a search or a run counts, even a failing one. An edit, a commit or push, a question, or a call a hook stopped does not. «inferida» needs none.
- **Cited facts are looked up:** text in backticks, `84/84`, `exit N` and hashes are searched in the tool calls since the last close, never in the agent's own edits. One no call shows is recorded as **sin respaldo** and scores Evidencia ✘ (⚠ since 2.0.9) without blocking. The evaluation has one more step: a full score is 10/10.
- **Kiro and Antigravity:** Evidencia is not applicable there, like the Cierre (no hook carries the reply).
- **The context brake stops again every 100k:** after the first stop at 300k, a resend continued for the rest of the session. A session kept going to 426k (`contexto 43%` with a 1M window) with no further stop. Now it stops again at 400k, 500k… and a resend continues until the next step (`WAYMARK_BRAKE_STEP`, 0 = once per session, `docs/adr/0016`).
- **Fix: a usage limit hid the session's size from both brakes.** The limit leaves a synthetic response (`<synthetic>`, usage all 0) in the transcript. The hooks read it as the last response, so the session looked empty. The next day's "continúa" to a 368k session idle 15 h went through and re-wrote 352,513 tokens of cache (~5% of the 5-hour quota). The synthetic response is skipped now (`docs/adr/0018`).
- **The desktop app's share of the quota, verified live:** a desktop session (`by: hook`) and a terminal session each kept their own part in `.quota.json` (2.0.6).
- **Docs:** README, INSTALL, the Kiro and Antigravity adapters, and ADR 0025.

## 2.0.7 — the session's tokens on the status line, and what each question answered in tasks.md
- **The status line shows the session's tokens:** `5h 5% · esta sesión ≈1% · tokens 13.2M · 7d 68% · contexto 5%`. It counts every response of the session's transcript and its subagents', cache included: the number each task's evaluation gives, so the session's is the sum of its tasks'. It reads only what the files gained since the last update. Claude Code's `context_window.total_input_tokens` is what the context holds now, not this total (`docs/adr/0019`, amended).
- **Fix: a turn that launched an agent in the background closed before it ended.** Claude Code marks an Agent call run in the background with `isAsync`, not `background`, so the end-of-turn hook did not wait for it. A question that ran a `security-review` that way was recorded with "la revisión sigue corriendo", and a task's background review could be judged before it finished. Both now wait for the notification.
- **tasks.md lists what each question answered:** a Q record keeps the skills it ran and its answer (the Aprendido, or the start of the final reply without the routing line). `tasks.md` lists the last five questions since the last close, one line each: time, department, skills, question → answer. A "¿por dónde voy?" no longer takes a review that already ran for still pending (`docs/adr/0008`).
- **Fix: two `waymark.mjs review` in one command counted as one.** A task that changed an API and its front reviewed both in one command (`… review <api files> 2>&1 | tail; cd ../front && … review <front files>`), and the Review testigo read only the first call, so it marked ✘ with every file reviewed. Every call in a command counts now, and a redirect such as `2>&1` is not taken for a file. The message names the code files still unreviewed, not the first four of the task.
- **Docs:** README, INSTALL and ADR 0008/0019 describe both.

## 2.0.6 — each session's share of the quota includes the desktop app's
- **Fix: a terminal's "esta sesión" took what the desktop app spent.** Claude's desktop app runs Waymark's hooks but not the status line, so its sessions never entered the split, and a rise they caused fell whole on the next terminal that spent anything (one $0.20 question showed `esta sesión ≈12%`). Now the per-tool and end-of-turn hooks record what such a session spends, from its transcript and its subagents' at list price for each response's model, read from where the last call stopped. Each rise of the 5-hour window is split with it too, so the terminal shows only its own part. A session the status line measures keeps Claude Code's own cost (`docs/adr/0019`, amended).
- **Docs:** README describes the desktop app's share.

## 2.0.5 — Kiro and Antigravity join the chain, and each session's share of the quota is its own
- **Kiro and Antigravity with their hooks** (`docs/adr/0022`, `adapters/kiro.md`, `adapters/antigravity.md`):
  - `install-hooks --agent kiro` writes `~/.kiro/hooks/waymark.json` (`"version": "v1"`). `install-hooks --agent antigravity` adds a hook named `waymark` to `~/.gemini/config/hooks.json` and keeps the user's own hooks. Each command carries `--event`, because Antigravity's payload names no event.
  - Neither agent's hooks carry the reply, and neither documents its transcript, so the turn is a journal of their hooks (`agents/journal.mjs`). The Cierre is not checked there, and on Kiro the choice window is not checked either: it has no question tool. Gates, review, build, spec, secrets, procedure and memory are checked from the tool calls.
  - Kiro reads plain text and exit codes, so the hooks answer through `answer()` (`agents/index.mjs`), which uses an adapter's `emit()` when it has one. Every other agent's answer is unchanged.
  - Both were built from the documentation; their first live session checks the points in their `adapters/*.md`. The uninstall removes their hooks, and `check` offers them like any agent's.
- **Fix: "esta sesión" showed the whole 5-hour window.** The first reading with no reading before it (a new install, a wiped `~/.waymark`) counted the window's entire % as a rise, and a session that had already spent took all of it, so its share equaled the 5h figure. That reading is now a baseline: what the window held goes to outside, and only the rises after it are split among the sessions. The same goes for a new window first read more than 10 minutes after the last reset (its start went unseen: claude.ai, the desktop app); a reset seen happen still starts the shares at 0.
- **Docs:** README describes the hooks of Copilot CLI, Kiro and Antigravity, the quota baseline, and what a terminal's share can include (use from a session without the status line, during a rise it also spent in). INSTALL §10 lists the hooks the uninstall removes from Copilot CLI, Kiro and Antigravity.

## 2.0.4 — Copilot CLI joins the chain, and the task records travel on their own
- **Copilot CLI with its hooks** (`docs/adr/0022`, `adapters/copilot.md`):
  - `install-hooks --agent copilot` writes `~/.copilot/hooks/waymark.json` under Claude Code's event names, so Copilot sends Claude's payload. User hooks need no trust.
  - The turn is read from its session log (`session-state/<session>/events.jsonl`). `connect` gives it the full Rule 0 block, and `check` offers its hooks like any agent's.
  - Copilot drops a command hook's per-prompt output, so the card and the block carry Rule 0 there. Built from the documentation; its first live session checks the points in `adapters/copilot.md`.
  - The uninstall removes that file whole.
- **Task records travel with no question** (`docs/adr/0020`, amended):
  - In a repo with `.waymark/` and an `origin`, the session hook adds the notes fetch refspec once and says so in the card. It needs no network, and `notes setup` is no longer offered.
  - **Fix:** 2.0.3's exact refspec made every `git fetch` fail ("couldn't find remote ref refs/notes/waymark") while the remote had no notes yet. The refspec is now a glob, which matches nothing there, and the old one is replaced where it is found.

## 2.0.3 — a supply chain you can trust: real testigos, records that travel, every agent, a project that learns
- **Testigos without false ✔** (`docs/adr/0020`):
  - Gate, test and build are judged by each command's executable and its exit, never by a word in an argument or a commit message (`git commit -m "fix build"` is no build).
  - A test that failed after the last change keeps the gate ✘.
  - Exception lines (`no comprobado`, `Tests: no`) show ⚠, never ✔. A skip quote needs 3 of your own words.
  - Build and review must pass after the last change, in the code's repo; reading `code-review/SKILL.md` is no review.
  - Secrets are read in every commit of the turn, in any repo.
  - A lesson closed with testigos unresolved goes to engram marked `sin verificar`.
  - Hook errors go to `~/.waymark/hook-errors.log`, and `check` reports them.
- **No false ✘ on real work** (`docs/adr/0020`):
  - A file changed through the shell gets its memory pack.
  - A session's first task keeps its decision (the hooks read back to the task's start).
  - A shell change in another repo is seen.
  - A repo with no typecheck uses a green test as its gate.
  - A reply that ends asking, with options, is a pause, not a missing Cierre (Codex too).
  - The `/compact` summary is no prompt.
- **The memory chain travels** (`docs/adr/0020`):
  - `waymark.mjs notes setup` (on your yes) makes fetches bring the task records (git notes), merged without overwriting local ones. The notes are pushed with any push the hook sees.
  - tasks.md, the card and the task IDs read the records that exist only as notes, so a clone sees what another machine did.
  - Engram memories are titled with the lesson; a follow-up corrects its task's lesson; a question that ends with an `Aprendido:` line is saved too.
- **Every agent with one install** (`docs/adr/0021`):
  - Cursor adapter (hooks from its documentation; not tested live yet).
  - `check` offers `install-hooks` to every agent without Waymark's hooks, Claude Code included.
  - `CLAUDE_CONFIG_DIR`, `XDG_CONFIG_HOME` and `CURSOR_CONFIG_DIR` are honored.
  - `uninstall.mjs` removes everything with a plan first and backups.
  - Node 18+ is required.
- **Any agent, also the ones Waymark does not know** (`docs/adr/0022`):
  - Agents are data (`scripts/agents/agents.json`): Kiro, Copilot CLI, Windsurf, Qwen Code, Antigravity, Droid, Amp and Crush join the five known.
  - An unknown agent (a home folder with instructions, skills or hooks) is detected, gets the pointer to `.waymark/tasks.md`, and is said once in the session card.
  - Writing its adapter is a procedure (`dept-devex` → *Add an agent*) with a template.
- **The project learns from its records** (`docs/adr/0023`):
  - The end-of-turn hook dates the Quality gates that passed, keeps the Areas each task touched, and counts repeated procedures.
  - A repeated procedure, an incident rule or a correction you repeated is *proposed* (project skill, Learned rule, preference) once in the card and in `check`, and written only after your yes.
- **Less context** (`docs/adr/0024`):
  - An L2 reads `references/protocol/l2.md` (3,761 characters) instead of the whole protocol (11,286).
  - The session card asks nothing in the first reply: open tasks are listed, and `check` asks which already work. It also says each path once.
  - `size.mjs` measures everything Waymark adds: the skill descriptions, the reminder as sent and the lines after the card's cap. A session carries 12,967 characters in this repo, not the 8,114 measured before.
- **Your share of the quota in each terminal** (`docs/adr/0019`, amended):
  - The 5-hour window is your account's, so with several sessions open each rise of its % is split among them by what each spent (`cost.total_cost_usd`).
  - Every terminal shows `5h 41% · esta sesión ≈12%`, refreshed every 30 s even when it is quiet.
  - A task shared with another session closes with its own part, prorated by cost. Use no session paid for (claude.ai, Codex) is never charged to one.
- **After updating**, run `waymark.mjs check`: the instructions block changed, so it offers to reconnect each agent, and it offers `notes setup` in each project with records.
- **Docs:** README and INSTALL describe 2.0.3: the context table with its real sizes (skill descriptions, the reminder, the protocol by level), your quota per terminal, records that travel, unknown agents, what the hook learns and what it proposes. INSTALL §8 runs `check` in the new session.

## 2.0.2 — the quota % measured, false ✘ from work in another repo fixed
- **Measured quota** (`docs/adr/0019`): Waymark's status line for Claude Code (`statusline.mjs`) reads the real % of the 5-hour window that Claude Code passes to it (Pro and Max). It shows `5h 23% · 7d 41% · contexto 18%`. The per-prompt hook keeps the reading at the task's start, and the end-of-turn line shows the difference as `≈ X% de la cuota (medido)`, with no question to the user. Another session active during the task gives `medido, con otra sesión activa` and no pair. A window reset, or no reading since the start, falls back to the estimate.
- **Pairs on their own:** each clean measure is saved as a calibration pair, so the estimate for Codex, OpenCode and sessions without the status line improves without asking.
- **Install:** `install-hooks.mjs` adds the status line with the hooks. A status line you already have keeps running after Waymark's (`~/.waymark/statusline.json`).
- **False ✘ from real tasks** (the front's session fixing and committing in the API):
  - **Recordar in another repo:** a file outside the session's project gets the pack of its own repo at its first edit. Before, only the session's project counted, so editing the API from the front's session never got its memory. A folder that is no repo still gets none.
  - **Review and pack through a variable:** `W=…/waymark.mjs; node $W review …` (or PowerShell's `$W = "…"`) counts as the review or the memory search. Variables assigned in the same command are read in place.
  - **Your reply after rejecting the choice window is your decision:** when you reject the window, or choose to clarify, your next message is recorded as your decision in your words (`source: "reply"`).
  - **A commit in another repo:** the end-of-turn hook looks for the turn's commits where they were made (`cd <repo> && git commit`, `git -C <repo> commit`). An earlier recorded task's ID counts too (its work committed now), wherever the line sits in the message.
- **Commit without a task ID:** a `git commit` whose message has no `Waymark-Task:` is stopped once per task with the ID to add. Sent again without it, it goes through.

## 2.0.1 — agents detected as they are, dead hooks and idle sessions caught
- **Dead hooks are reported** (`docs/adr/0018`): `waymark.mjs check` probes every hook each agent has registered, as the agent runs it, and names the ones that do not answer. The instructions block tells the agent that a session with no card and no per-prompt line has no hooks running, so it tells the user and runs `check`.
- **Idle brake:** a message to a session past 100k tokens, idle for more than an hour, is stopped before the model once per idle stretch, like the size brake. Its prompt cache has expired, and the first response would re-write the whole context: 431k tokens re-written cost about 9% of the quota.
- **Notes and merges:** `check` reports a GitHub repo with task records that allows squash or rebase merges. Those merges re-create the commits and leave the git notes behind. INSTALL says to merge with a merge commit.
- **Gemini CLI only when it is installed:** `~/.gemini` is shared with Antigravity, so the install and `waymark.mjs check` count Gemini CLI only when the folder has one of the CLI's own files (`settings.json`, `projects.json`, `installation_id`, `oauth_creds.json`, `tmp/`). Antigravity's `antigravity/` and `GEMINI.md` alone no longer count.
- **`_name` folders are not skills:** `sync` and `check` skip folders that start with `_`. That is where another framework keeps shared files, such as a `_shared` folder in `~/.codex/skills`, and they no longer appear as an unassigned skill.

## 2.0.0 — a supply chain of the agent's work
Waymark is now a supply chain of the agent's work: every task goes through defined stages and comes out with a verifiable record of its inputs, the user's decision, the evidence, the gates and the commits it produced (README → *A supply chain of the agent's work*; `docs/adr/0001`, `0002`). **The user decides, never the agent:** the old "the agent still decides" is gone. Step 1 of 4:
- **The user decides every real decision, at any level:** whenever there are 2+ valid ways, the agent lists the optimal options in the choice window (files, risk, cost) and marks the recommended one, which may not be what the user needs; the user picks. The pre-tool hook denies the first L1–L3 edit of a prompt once when nothing was asked; the retry passes for a single real way (`Decisión: única (<why>)`) or a choice the user already wrote (`del usuario ("<their words>")`).
- **Task ID** `YYYY-MM-DD · T<n>[a-z]`: the per-prompt hook offers the ID for a new task and for a follow-up of the last one (~25 tokens); the Cierre heading carries it (`## Cierre · 2026-10-02 · T3`), and so do the task's commits (trailer `Waymark-Task: <id>`).
- **The Cierre is the task's record:** new `Resultado:` (hecho | parcial | bloqueado) and `Decisión: elegida … · descartadas …` at every level, checked by the end-of-turn hook against the choice-window answer or the user's words; a commit made in the turn without the trailer is flagged.
- **The chain:** the end-of-turn hook appends each closed task to `~/.waymark/provenance/<slug>.jsonl`: the inputs manifest (Waymark and agent version, model, MCP servers used, hashes of the instruction files), what the transcript proves (prompt, options and pick, files, commands, skills), the commits carrying its ID, the Cierre text and the claims it could not back (`unresolved`). Each line holds the hash of the previous one, so editing or deleting a past task breaks the chain. Step 2 moves the log into the project.
- **First real test of 2.0 (L2 in a real project, 1 attempt, ~4% of the 5-hour quota) closed the gaps it found:**
  - The turn was routed as a question (Q) and then edited 8 files; every check skips Q, so there was no decision gate, no Cierre check and no record. Now a Q turn about to edit a project file is stopped once to re-route, the last routing line of the turn wins, and the end-of-turn hook checks a Q turn with changes as L2.
  - Four decisions were taken mid-task without asking, one against the user's words. `Sub-decisiones:` in the Cierre lists each one (`preguntada | del usuario ("…") | no preguntada`); one taken alone is sent back to the user, and the claimed asked count must match the choice-window answers.
  - **The department is a link of the chain:** the owner named in the routing line must have been invoked in the session (test 7 declared one that never loaded), and the record keeps `department: { declared, invoked }`. README table: new *Department* row.
  - Replayed on that session, the end-of-turn hook now flags the routing, the missing Sub-decisiones and the missing code-review.
- **Second real test (L1 in a real project, 1 attempt, ~2% of the 5-hour quota):** the first record was written, but the evaluation still marked Recordar, Enrutar and Verificar, and the transcript showed a gap the evaluation missed:
  - **The output was incomplete.** The modal files were restored with `git checkout HEAD --` through the shell: no gate stopped it and the record listed only the spec written with Write. Now the per-prompt hook takes a `git status` snapshot and the end-of-turn hook records every file that changed by any tool; shell commands that change files go through the decision gate like edits.
  - **The decision gate is strict:** no change until the user was asked in this task; a single real way is confirmed in the choice window. The retry that used to pass let the agent apply two decisions before asking.
  - **Memoria and Procedimiento move to the Cierre**, checked against real reads. The opener is written after a thinking block, which Claude Code does not persist, so `Memoria: leída` without a Read and an unread procedure passed. The owner's `procedures.md` must be read before the first change.
  - **Gates in order:** a typecheck, lint or build after the last code change, tests after the last spec change (the typecheck had run before the last edit).
  - **Re-route by tool call:** a routing line written mid-turn is not persisted either, so a question that becomes a change re-routes by invoking the owner department with args `L<n>`.
  - Replayed on that session, the end-of-turn hook flags Procedimiento, Memoria and the typecheck order.
- **Third real test (L2 across FE + API with a migration, 1 attempt, ~5% of the 5-hour quota, 26 minutes):** the agent asked the scope before editing and read the procedure, and the record listed all 13 files across both repos. But six items stayed unresolved: three sub-decisions taken alone, a `curl` instead of a browser check, "pre-existing" failures never isolated, an inference "from the docs" with no docs call, and two fields missed because they were written in bold. 13 of the 26 minutes went to two whole-project typechecks of the API.
  - **The hooks generate the provenance** (`docs/adr/0004`): the end-of-turn hook computes what it can observe and records it under `observed`: memory searched, opened and saved; the procedure read before the first change; gates after the last change with time and failure; tests; browser attempts; code-review; docs consulted; clean-copy checks; branches; time and the slowest command. The Cierre shrinks to `Resultado · Decisión · Sub-decisiones · Evidencia · Aprendido`, and bold markers are ignored. It blocks for missing **actions**, not for missing text.
  - `mem_search` is denied once before the first change at L2+ (the note was ignored for 3 edits). The decision gate names the repo's branch and asks for the foreseeable sub-decisions in the same choice-window call. An inference from docs needs a docs call, and a "pre-existing" failure needs a `git worktree` copy or "no comprobado". `Sub-decisiones` split on `;` only outside parentheses and quotes.
  - **Gates: fast while working, complete once.** During the task, lint and the related tests of the touched files (`vitest related`, `jest --findRelatedTests`, both checked in the official docs); the whole-project typecheck and the build once per repo at the end. Stack profile: Prisma migrations are generated (`migrate dev --create-only` / `migrate diff --script`), never hand-written, and applied only with the user's yes.
- **Fourth real test (L1, 1 attempt, ~2% of the 5-hour quota, every decision taken by the user) → consolidation** (`docs/adr/0005`): the self-evaluation still listed four ✘, mostly wording, and the evaluation prompt cost about as much as the task. Stop adding checks:
  - **Three blocks only:** the decision (backed, no sub-decision alone), a gate after the last change, and the Cierre complete with its Aprendido **written** to the project memory. Browser, code-review, spec next to the code, docs, pre-existing failures, procedure, department, `mem_search` and the commit trailer become findings: recorded and scored, never blocked. The pre-tool hook no longer denies for the procedure or `mem_search`.
  - **Automatic evaluation per task** in the record: ✔/✘ per routine step, score, tokens and estimated quota (`WAYMARK_TOKENS_PER_PCT`, default 1.35M tokens per 1%, calibrated on 2.19M→2%, 7.66M→5% and 1.8M→2%). The user sees it as one line at the end of the turn, at 0 model tokens. "Evalúa tu trabajo" becomes an optional deep audit.
  - **Fixes:** a search with no match no longer counts as reading the procedure; the option the user picked counts as their words; a file that a commit leaves clean, with the same content, is not a change, and a shell command counts as a change only when git saw one.
- **Fifth real test (L2, ~2% of the quota) → one routine contract** (`docs/adr/0006`): the automatic evaluation appeared on its own and matched the manual one (4/7). But once browser, code-review, docs and build were only recorded, the agent skipped them. And the self-evaluation guide still required fields the opener no longer asked for, which is why fixes kept "breaking" other steps.
  - **`skills/waymark/routine.json`** is the only definition of the routine: per step, the levels, the condition and whether it blocks or is recorded. The end-of-turn hook enforces and scores from it; the instructions block quotes each blocking step (a test fails on drift); the self-evaluation guide is now a deep audit of the record with no rubric of its own.
  - **The user's choice:** block on the decision, a gate after the last change, the Cierre with its Aprendido written, and at L2+ `mem_search` (with engram), code-review and the build with code (`Build: no (<why>)` when there is none), plus docs behind an inference from docs. Record the procedure, the browser, the spec near the code, pre-existing failures and the commit trailer.
  - The evaluation scores only the steps that applied (a label with several steps passes only if all pass). The quota calibration lives in the contract (`tokensPerQuotaPct`).
- **Project memory lives in the project** (`docs/adr/0007`, the user's choices on 2026-10-03): `<project>/.waymark/` holds `memory.md`, `provenance.jsonl` (moved byte for byte, so the chain still verifies), a generated `tasks.md` (in progress, pending, next step, done with result and routine score) and a `README.md`. It is local, excluded through `.git/info/exclude`, and plain Markdown/JSONL, so Codex, Cursor or a new session can answer "which task am I on, what is missing, what was completed" from that folder alone.
  - **One resolver** (`projectHome` in `provenance.mjs`) is used by every hook. It walks up to the nearest `.waymark/memory.md`, as git finds `.git`. The old `~/.waymark/projects/<slug>.md` is a bridge until 2.1.0, and the session hook offers the move once per project.
  - **`migrate-memory.mjs`** (`--project <path>` or `--all`) is a dry run by default; `--apply` writes. It backs up first, verifies the chain after the copy, writes the exclude line, leaves a `Moved:` stub, and points the `projects.md` row to the new file. It never overwrites.
  - **`tasks.md` is generated** by the end-of-turn hook and the agent never edits it, so it cannot drift from the record. The agent still writes its *Work in progress* line in `memory.md`.
  - **Other agents find the folder** through the Waymark block in their user-level instructions file; no tracked file of the project changes. engram keeps a task index: `mem_save` with `topic_key waymark/tasks/<slug>`, a new `Índice` step that is recorded, not blocked.
  - Edits to `<project>/.waymark/` are Waymark's own files: no decision gate, and they are not counted as project changes.
  - **`tasks.md` is short** (gate test: a new agent read ~90k characters for a ~6k answer). Tasks are the *Work in progress* lines whose task ID heads the line, shown as `ID · en curso | pendiente · paso · próximo` (≤ 300 characters each, the last `NEXT` / `Pendiente:` marker wins). The other lines are counted as notes. A memory without task IDs shows its `Task` / `Next` lines. The whole file stays within ~3,000 characters by dropping the oldest done rows. Old lines can move to `.waymark/history.md`; nothing is deleted.
  - **The last closed task, for any agent:** `tasks.md` has *Last closed* with that task's Resultado, Decisión, Sub-decisiones, Evidencia and Aprendido (~220 characters each), its evaluation (with the ✘ steps), and a pointer to its full record in `provenance.jsonl`. Another agent asked "¿por dónde voy?" finds it there.
  - **A turn that never ends still shows:** the per-prompt hook writes `.waymark/open.json` (task ID, request, time) and the end-of-turn hook removes it. When the quota runs out mid-task, `tasks.md` lists it under *Started, not closed*.
- **Other agents connected from one install:** `connect-agents.mjs` (dry run by default, `--apply` backs up first) writes one marked line (`<!-- waymark:pointer -->`) in the global instructions file of each agent found: Codex `~/.codex/AGENTS.md`, Gemini CLI `~/.gemini/GEMINI.md` and OpenCode `~/.config/opencode/AGENTS.md`. The line is "if the project has `.waymark/`, read `.waymark/tasks.md` first". It registers them in `~/.waymark/agent.md` and installs nothing in them. The session hook offers it once for each agent found and not connected. When an orchestrator already governs that agent (another framework's marked blocks), Waymark joins as its guest. The pointer goes in as Waymark's own block, which is not Rule 0, and the orchestrator's blocks are never touched. The registry row says `invitado de <framework>`.
- **Quota calibration from your own pairs** (step 2c):
  - The record splits a task's tokens into new, cache writes, cache reads and output.
  - After a task, `calibrate.mjs "<task ID>" <percent>` stores the % it really used, per model, in `~/.waymark/calibration.jsonl`. `--list` shows the pairs.
  - With 1–2 pairs, the estimate uses their mean tokens per 1%. With 3+ pairs that have a token split, it weighs new and cached tokens apart. Without pairs it uses the contract's default.
  - The evaluation says which estimate it used (`quotaBy`).
  - First real pair: Opus 5.5, 7.12M tokens = 9%, about 0.79M per 1% (the default assumed 1.35M).
- **Work in progress is one line per task, headed by its task ID** (template, `learning.md`, bootstrap). A new memory had written the old `Task:` / `Next:` lines, and `tasks.md` could not tell its task apart from the notes.
- **Contract refinements from real test 2.0-6** (`routine.json`):
  - **Asked late:** a sub-decision marked `→ preguntada tarde` (asked after the change it decides) passes the block, because it cannot be undone, but Decision is ✘ in the evaluation and the record. If a choice-window question came after the first change and no item says *tarde*, it is recorded as a finding.
  - **Red claims:** a claim of red (*rojo*, *habría fallado*) needs a test run before the first code change or in a clean `git worktree`, or it must be written as *inferida*. The new `red` step is recorded and shares the Tests label.
  - **Angular UI:** a `.ts` with a sibling `.html` counts as UI (Angular 20+ names drop `.component`), so the browser step applies.
- **Step 3a: one agent-agnostic core, hooks only for the chain** (`docs/adr/0008`):
  - **The four hooks hold only the four links:**
    - session start: the memory digest and the pointer to `tasks.md`;
    - each prompt: the task ID, `open.json` and the reminder;
    - pre-tool: the decision gate;
    - end of turn: the Cierre check, the record and `tasks.md`.
  - **Everything else is one on-demand command:** `node <skills-dir>/waymark/scripts/waymark.mjs [check | sync | mcp-fit | skill-fit | migrate | connect | install-hooks]`. `check` only reports what is pending:
    - a newer version;
    - skills changed since the last sync;
    - MCP fit and skill fit;
    - memory still in the old location;
    - unconnected agents;
    - a framework that appeared or vanished;
    - a large idle session in the folder.
  - **A weekly pointer:** the session hook adds one line asking the agent to run `check` when the last check is older than a week, at most once a week.
  - **Removed:** the resume guard, the pending-prompt hand-over and the fragile-command checks. Each only worked by intercepting a prompt or a tool call. Their rules stay as text in `protocol.md` and `dept-qa`.
  - **Removed:** dead code (`checkEdit`) and the skill-fit plan cache.
  - **One adapter per agent:** `scripts/agents/<name>.mjs` holds the transcript reader, the pre-tool input mapping, the output shapes, and the instructions file and session folder. The hooks take `--agent <name>`, `claude` by default, so existing registrations keep working. Codex is step 3b.
  - **`install-hooks.mjs` replaces the manual merge:** it shows a dry-run plan, and `--apply` makes a backup first. It adds, updates or de-duplicates only Waymark's own entries and registers nothing in guest or skills-only mode.
  - **The record says who did the work:** each record carries `agent`, and `tasks.md` shows it next to the ID (`T4 · codex`).
  - **Questions leave a trace:** a turn routed Q in a project with memory gets a short chained record with no task ID (`kind: "Q"`), so it never takes a `T<n>`. `tasks.md` shows `Preguntas (Q) desde el último cierre: N` (shown in the user's language).
- **Step 3b: the Codex adapter** (`docs/adr/0009`):
  - **Codex CLI runs the same four hooks:** `install-hooks.mjs --agent codex` writes them to `~/.codex/hooks.json` (matcher `Bash|apply_patch`, `commandWindows`). You trust them once in Codex's `/hooks`.
  - **Rollout reader** (`agents/codex.mjs`): it turns the rollout into the core's lines:
    - prompts, assistant text and commands with their exit codes;
    - file changes and MCP calls;
    - tokens per response, model and version.
  - Checked against the 37 local rollouts (codex 0.115–0.160): 499 prompts, 2,266 commands and 1,806 file edits, with no failure.
  - **Skills in Codex:** reading a skill's `SKILL.md` counts as invoking it. The reminder and the gate tell Codex the absolute skills path.
  - **Decisions without a choice window:** `request_user_input` counts when Codex has it (Plan mode). Otherwise, a turn that ended with a question in the chat plus the user's reply count as one decision (`source: "chat"`).
  - **Steps an agent lacks do not apply:** each adapter lists them (`lacks`; Codex: code-review). They are recorded as `na`, never block and do not count in the score.
- **Step 3c: fixes from the real Codex → Claude test** (`docs/adr/0010`, all the user's rules and picks):
  - **Every routine step that applies must pass:** procedure, engram index, browser, spec next to the code, red claims and pre-existing claims now block once like the decision and the gate. Only the commit trailer stays recorded, because fixing it means rewriting a commit.
  - **The user owns the branch and the browser.** The gate no longer pushes the branch, and the end-of-turn hook ignores a branch listed as a sub-decision. The browser check is offered in the first choice window, with a test user + Playwright when there is a login or OTP. Navegador fails only if it was never offered, or accepted and not done; `Navegador: omitido (usuario: "<option picked>")` passes.
  - **Decisions:** every decision that shapes the work goes in the first choice window. A later question that only confirms is `→ confirmada` and passes. `preguntada tarde` is kept for a work decision asked after applying it.
  - **Pre-existing failures are checked at that moment** (`git worktree` or `no comprobado (<why>)`). The reminder says so, and the block says how.
  - **Quota:** while a model has fewer than 3 calibration pairs, the end-of-turn line asks for the real % with the exact `calibrate.mjs` command.
  - **Routing:** `Waymark → L0|Q` counts as a question. A reply with no routing line inside a task that has not written its Cierre keeps the task's routing. Before, a Codex reply in the chat opened an L0 turn and skipped the gate.
  - **Codex:** every question line of the last message counts as a decision asked in chat, not only the last one.
  - **Replay of the real Codex rollouts** found two more gaps, now fixed:
    - Codex's default-mode choice window, `request_user_input_async`, counts once the user answers, through their next message. The options that message names are taken as picked. A call Codex sent with bad arguments never counts.
    - Questions written in the chat count from every message after the turn's last action, so a closing summary without "?" no longer hides them.
    - Before these fixes, the inherited L2 gate would have denied an edit after the user had already decided.
  - **The gate no longer reads a ">" inside quotes, a heredoc body or a PowerShell here-string as a redirect.** Before, `node -e "…x=>{…}"` was gated as a file change.
  - **Test A fixes** (`docs/adr/0011`):
    - **Browser verification runs only when the user asks.** Waymark never offers or recommends it, there is no Navegador step, and the departments, stacks and UI skills say so. It cost many tokens and misread screens.
    - **No secrets in the chained log.** A record keeps only the picked option labels; a typed answer is stored as `(respuesta escrita, N caracteres)`. Passwords, tokens and keys are masked in prompts, commands and the Cierre. A test password that reached a record was removed, and the chain was recomputed.
    - **False ✘ removed:**
      - `Decisión` continues on the next lines, and a quoted multi-select answer counts.
      - Sub-decisions split on ` · `.
      - `→ única (<why>)` marks a technical step with one real way.
      - `memory.md` written by any tool counts.
      - A follow-up that applies the review's findings needs no second review.
    - **Turns counted right.** The hooks read back until the turn's prompt is in view; a pasted image of megabytes pushed it out before. A turn resumed by a background notification counts from the last close. A recorded 22% turn was really ~2%.
    - **Tasks outside the project** (install, cleanup) are recorded in the session's project.
  - **Re-test A:** the task scored 9/10 at ~5% (T2d was ~17%), and its follow-up 7/7 at ~1.4%. The browser was never offered and the branch never asked. Two fixes came out of it:
    - The sub-decision block names the honest ways out, with an example: answered in the choice window → `preguntada`; one real way → `única (<why>)`; otherwise ask now.
    - A Cierre counts only as a heading at the start of a line, and a turn with no project change is recorded only when it was routed L1–L3. Before, a Q answer that named `## Cierre` inside a sentence was checked as a closed task.
  - **Sonnet 5.5 test** (three tasks, ~7% of the quota for ~6.1M tokens, ≈0.87M per 1%, about the same as Opus per token). The fixes:
    - **Background agents:** a skill or agent still running in the background holds the close, with no block and no record. The task closes in the notification's turn. A background shell command is never waited for. Before, the hook judged the task while its code-review ran and marked Cierre and Build ✘.
    - **Subagent tokens** (`<session>/subagents/*.jsonl`) are added to the turn's usage.
    - A quote of the user's fragments joined with "…" counts. "Docker" is no longer read as "docs".
    - A command that writes `.waymark/` is not a gate.
    - **New marker** `→ propuesta (<what>)` for what was named but not applied.
    - **No invented rules:** a user rule or preference exists only where it is written (their message, `memory.md`, `preferences.md`). The agent cites it or asks; the agent had claimed a backup rule the user never set.
    - The time the choice window waits for the user is recorded as `userWait`, outside the agent's minutes and the slowest step. A question left open overnight made a 2-minute turn read 432 minutes.
  - **tasks.md:** `próximo` keeps every pending part in order (the last `Pendiente:` used to win, and "paso 2" was lost). A marker inside quotes is text. `open.json` records the agent, so a turn shows "started in codex".
- **Step 3e-1: testigos, one decision, secrets** (`docs/adr/0012`, all the user's picks). The 3c tests kept producing false ✘ from reading the agent's prose; now each check executes:
  - **`routine.json` is the catalog of testigos:** each one states its `claim` and returns ✔ / ✘ / not applicable with its evidence. New testigos: **Secretos** (blocks) and **Cadena** (recorded). `node waymark.mjs testigos [<task ID>]` re-runs the ones that execute: chain, commit + trailer, secrets in the task's commits, typecheck now.
  - **One decision:** the user's answer in the choice window, recorded as is with its position (before or after the task's first change). ✔ when the first answer came before the first change; a later question is recorded and does not count against it. `Decisión` and `Sub-decisiones` leave the Cierre, along with their markers (`confirmada`, `preguntada tarde`, `única`, `propuesta`, `del usuario`). An edit the gate denied is not a change.
  - **The Cierre is `Resultado · Evidencia · Aprendido`**, plus optional exception lines: `Tests: no (…)`, `Build: no (…)`, `no comprobado (…)` and `Secretos: no (…)`.
  - **Gate testigo:** the exit of the agent's last gate after its last code change. With none, the hook runs the repo typecheck: memory.md *Quality gates* → package.json `typecheck` with the lockfile's manager → `tsc --noEmit` when TypeScript is installed. The limit is 40 s, the whole process tree is killed on timeout, and the hook never runs the full build. A failing gate now blocks once. It no longer applies when no code changed.
  - **Secrets testigo:** looks for unambiguous formats (PEM private key, AWS, GitHub, `sk-`, Slack, JWT, Google) in memory.md when the turn wrote it, in `mem_save`, in the lines the task added (untracked files whole) and in its commits. It blocks once and names where and the kind, never the value. Every string of the record is masked for those formats too.
  - `tasks.md` → *Last closed*: `Decisión` shows the user's recorded picks.
  - Replayed on three real tasks of the earlier tests, the false Decision ✘ from prose parsing are gone.
- **Step 3e-1b: fixes from the 3e-1 test** (`docs/adr/0012`, the user's picks):
  - **A new task starts after the session's last close**, read from `provenance.jsonl`, never from prose. The test's T3 carried T2's four answers and read its own question as "after". A follow-up (an ID with a letter) reads back to its task. The decision gate uses the same boundary: after each close the choice window is asked again.
  - **Exception lines answer a block:** `Tests: no`, `Build: no`, `no comprobado` and `Secretos: no` count only in the reply that follows the hook's block. Written beforehand they no longer cancel a real one (both test Cierres had a preventive `Secretos: no`). They left the Cierre template; the block message names the way out.
  - **A follow-up must share a file with its task:** a follow-up ID (`T4b`) holds only when the turn changes a file that its task already changed (the `files` of its records). Otherwise the hook blocks once and offers the new ID. In the 3e-1b test, an unrelated task was closed as T4b and inherited T4's answers.
  - **Decisions are the stretch since the last close:** a follow-up records only its own questions, and their position is measured against its own first change (T4c's question read "after"). A code-review done earlier in the task still counts.
  - **Heredoc bodies and here-strings are text, not commands:** a word such as `test` or `tsc` inside a file written with `cat > x <<'EOF'` no longer counts as a gate or a test run. A quoted command (`bash -c "npm test"`) still does.
- **Step 3e-2: git as the source of truth** (`docs/adr/0012`, all the user's picks):
  - **The record of a committed task is a git note** on its newest commit (`refs/notes/waymark`). `provenance.jsonl` keeps a chained stub (ID, session, time, files, commits and the note's sha256). A task without a commit, or whose commit already has a note, keeps its whole record there. An edited or missing note breaks the chain (testigo Cadena).
  - **One index:** the git notes. `waymark.mjs tasks [<task ID>]` lists the records, newest first, or prints one whole. The testigo *Índice* (engram `waymark/tasks/<slug>`) is gone.
  - **Notes travel only when asked:** `waymark.mjs notes push [<remote>]` (git push origin refs/notes/waymark). Git's config is never changed.
  - **The hook writes Work in progress:** at each close, the task's line is `- ✔|▶ [<task ID>] <Aprendido>` (✔ when Resultado is hecho), at most 200 characters (a longer Aprendido is clipped; the whole Cierre stays in the record). A follow-up replaces its task's line. Closed lines beyond the newest 5 and any line over 200 characters move whole to `history.md`. The testigo *Aprender* is gone: the Cierre already requires the Aprendido.
  - **tasks.md** reads the records back from the notes; *Last closed* names `git notes --ref=waymark show <commit>` as the full record.
  - **Code comments say how the code works, never task history:** task IDs, dates and "user's choice" markers are gone from the scripts (a test keeps them out), and the rule is in `dept-architecture` and the instructions block.
- **Install in every agent by default** (INSTALL §1.2): when the install finds other agents, the recommended option installs in all of them, with the skills once in `~/.agents/skills` and the instructions block and hooks in each agent. The pointer-only option ("conectar los demás", from before every agent had hooks) is gone.
- **Hooks reached through a link run** (`docs/adr/0017`, follow-up): with the skills in `~/.agents/skills`, every hook registered through `~/.claude/skills` exited without doing anything, because Node runs a linked script from its real path. Each script's main guard now compares real paths, the installer registers the hooks from `~/.agents/skills`, and the records the dead hooks never wrote were rebuilt from the transcripts. Recordar does not apply to a task that changed no project file. INSTALL §11 replaces a 1.x install with a clean 2.0.
- **The agents' folders stay local, one real copy per skill** (`docs/adr/0017`, the user's picks after the three-agent test):
  - **Out of git:** the project's `.gitignore` gets `.waymark/`, `.engram/`, `.agents/` and `.claude/skills/`. The hook no longer exports engram to `.engram/` or stages it in commits; the learned memory stays in engram's local store, shared by every agent on the machine.
  - **One real copy per skill:** a project skill lives in `.agents/skills`, and Claude Code gets a link in `.claude/skills` (a junction on Windows). Waymark's skills live in `~/.agents/skills`, linked from `~/.claude/skills` (`skill-links.mjs --user`). A copy or a skill written on Claude's side moves to `.agents/skills`, and the replaced folder goes to the backup.
  - **Fewer extra responses:** the hook hands over the pack, so the agent never runs it. The agent never calls `mem_save`. Codex ends its turn after an async question. Decision does not apply to a commit or push the user ordered. A follow-up ID continues that task's files.
  - **Small fixes:** the card shows a learned line once when its body repeats its title, a resend after the context brake removes the held message, and a project skill's `name` equals its folder.
- **Context brake, one project-skills folder, no-change tasks** (`docs/adr/0016`, the user's picks):
  - **Context brake:** the default threshold is now 300k tokens (up from 150k): a message to a session at that size is stopped before the model once and brought to the next session by its card. Claude Code and Codex block it, Gemini CLI denies it, OpenCode throws from `chat.message`.
  - **One project-skills folder:** project skills live in `.agents/skills`, and the session hook mirrors them to `.claude/skills` for Claude Code.
  - **No-change tasks:** a task that changed no project file (a push the user asked for) records a missing choice window instead of blocking.
  - **One Cierre after a block:** the hook keeps the Cierre already written and applies the corrected lines.
  - **No secrets in engram:** the engram save and the learned move mask secrets.
- **Three layers of memory and fewer responses** (`docs/adr/0015`, the user's picks; the numbers in `docs/audit-context.md`):
  - **git** holds what was done, **engram** what was learned, **memory.md** the project manual.
  - The end-of-turn hook saves each Aprendido to engram with its CLI (topic = task ID, project = the slug pinned in `.engram/config.json`).
  - Before a `git commit`, the pre-tool hook syncs and stages `.engram/`. The session hook imports new chunks and shows the latest memories on the card.
  - Departments no longer ask for `mem_save`. `waymark.mjs learned` moves memory.md's Solved problems, Gotchas and Decisions to engram; `check` offers it, and offers engram itself when it is missing.
  - **Recordar by the hook:** the first edit of each file gets its `pack`. Claude Code and Codex get it before the tool, with no `permissionDecision`. OpenCode and Gemini CLI get it with the result (`tool.execute.after`, `AfterTool`).
  - **Pending tasks close themselves:** a turn another session left open over two hours becomes an interrupted record; "sin resolver" leaves tasks.md once a later task passes that testigo; a follow-up done closes its ▶.
  - **Fewer responses:**
    - C1: a department loads once per session.
    - C2: the reminder carries the git status.
    - C3: the reminder no longer repeats the block.
    - C4: the departments' shared Entry, Procedures and Learned text lives once, in the block (~440 characters less per department).
- **Final test across agents** (`docs/adr/0014`, the user's picks). One task each in Claude Code, Codex and OpenCode left four records in one chain. Gemini CLI's hooks fired, but its API call failed. Fixes for the gaps it showed:
  - `pack` reads each commit's note even with no local log, so records travel with a clone.
  - A task committed later by another task gets its record as that commit's note (`noteLateCommits`).
  - A `git commit` whose `Waymark-Task` trailer would be recorded under another ID is denied with the right one.
  - Recordar (`waymark.mjs pack` before the first change) applies at every level.
  - `waymark.mjs review <files>` (diff + checklist) is the Review step in Codex, Gemini CLI and OpenCode. Codex's `Test-Path` of a `SKILL.md` no longer counts as invoking the skill.
  - OpenCode records each tool's real duration and its version.
  - The *Started, not closed* list in tasks.md says it includes the turn reading it.
- **API ↔ FE and the rest of that test** (`docs/adr/0013`): the card shows the other projects of the workspace (open ▶ and their last 3 closed tasks) and `waymark.mjs tasks --workspace` lists them; `.waymark/` goes in the project's `.gitignore`; a model without pairs gets an uncalibrated % from its family's calibrated model.
- **Steps 3d + 3f: every agent in the chain, one memory, notes that travel** (`docs/adr/0013`, the user's picks):
  - **Gemini CLI and OpenCode join the chain.** Gemini through its command hooks (`install-hooks --agent gemini`: SessionStart, BeforeAgent, BeforeTool, AfterAgent in `~/.gemini/settings.json`). OpenCode through a plugin (`install-hooks --agent opencode` → `~/.config/opencode/plugins/waymark.js`) that runs the same four scripts. Each has an adapter that reads its transcript, its choice window (`ask_user`, `question`) and its skill invocation.
  - **One memory:** *Work in progress* keeps only open tasks; a task done leaves its line (its Aprendido is in its record and `tasks.md`). Recordar applies at L2+ with or without engram, and `waymark.mjs pack` meets it.
  - **Notes travel and survive:** pushed with the agent's push of the task, and copied to the new commit after a rebase or amend (by the `Waymark-Task` trailer), without touching git's config.
- **No false results, checked on the real sessions** (6 tasks replayed): a relative path after `cd` resolves against it (the landing's procedure read); red is measured from the spec (scaffolding before it is not the code it tests); Docs counts failed attempts after a code change, never the environment or a red → fix → green loop; an environment failure is no failed command. Only the real ✘ remain.
- **Landing test fixes** (a new project, Opus 5.5 high, 9/10): a folder with no git yet keeps its memory and record in `<folder>/.waymark/` (only the home folder keeps `~/.waymark`); a command run after `cd` into a `.waymark` folder is no gate.
- **Step 3e-5: testigos by action** (`docs/adr/0012`, the user's picks): the hook stops reading the agent's words to decide what applies.
  - **Owner and level:** the owner is the `dept-*` invoked, not the one the text names. The level is the declared one raised by the files changed (1–2 → L1, more → L2); L3 and a one-file L0 are taken as declared. A turn with no routing line that changed files is judged too.
  - **Red** applies at L2+ when a spec and code changed: the spec ran before the first code change, or in a clean worktree. **Pre-existing** applies when the gate failed: a clean-copy run shows it. **Docs** applies when the same command failed twice: docs before the next run. "rojo", "ya fallaba" and "inferida de docs" trigger nothing.
  - **The Cierre** is the one part still read as text, on purpose: the report for the user.
- **Step 3e-4: shorter rules, measured** (`docs/adr/0012`, the user's picks):
  - **What loads every session drops 35 %** (12.1k → 7.9k characters, `waymark.mjs size`). The instructions block keeps what no testigo checks and quotes each blocking testigo once (10.3k → 6.1k). The full per-prompt reminder only points at the steps a new session skips most (2.4k → 0.6k).
  - **Departments:** process steps a testigo checks are gone (spec, gate, secrets, build, browser, and the stale Exit/Entry pointers). Domain rules stay, one line each, without MUST ("Never …", "Prefer …"); the Quick ref's *Must* becomes *Rules*. A test keeps MUST out of the departments and the sizes in bounds.
  - **Incidents by window:** a suggested rule needs 3 failures within the project's last 10 evaluated tasks, so one already outgrown stops being offered.
  - **`waymark.mjs size`:** characters and estimated tokens of the block, the card, the reminder and each skill, by when they load.
  - **Codex test fixes:** `Waymark → L2 · frontend` (no `dept-` prefix) now names its department, and "L<n> or Q" copied as is reads as its level; the block shows a real routing example. A model with no calibration pairs shows no quota % (the default came from Claude's 5-hour window; Codex's quota is weekly), only its tokens and the question; the `tokensPerQuotaPct` default is gone.
  - **Codex re-test fixes:** a follow-up ID that changes none of its task's files is recorded under the new task's ID (the end-of-turn line says so) instead of blocking, so the Cierre is no longer written twice. For Codex on Windows the card's Repo line and Gates run binaries with node (`node node_modules/typescript/bin/tsc`, read from the `.bin` launcher), because its sandbox cannot run `pnpm exec`.
  - **Enrutar with position** (3e-4 test, Sonnet 5.5): `procedures.md` read only after the first change is ✘ and becomes an incident, like a late decision; not read at all still blocks once. In the test it was read only after the end-of-turn block, and Enrutar passed.
- **Step 3e-3: context and adaptation** (`docs/adr/0012`, the user's picks):
  - **The stack is read from the repo, every prompt:** package manager (package.json `packageManager`, else the lockfile) and the installed versions of the main frameworks, as one line ("Repo (read now): pnpm 11.5.0 · @angular/core 21.2.15 · … · run with `pnpm exec` / `pnpm run`"). A pnpm project and an npm project each get their own commands; the hook's typecheck re-run is translated to the repo's manager and each close corrects memory.md's Identity.
  - **A context card replaces the session digest** (~1.8k characters with the environment): last closed task with its agent, open tasks to confirm, notes, the repo stack, gates in the repo's manager, incidents, and the commands to pull the rest (`waymark.mjs memory <section>`, `tasks`).
  - **`waymark.mjs pack <files…>`:** what earlier tasks did in each file (from git, the notes and the records), and commits no task recorded, newest first. The card asks the agent to run it before its first change.
  - **New session notice** in the end-of-turn line past 200k tokens of context.
  - **Incidents** from the records: a testigo ✘ open until it passes later; 3 failures → a suggested rule that `check` offers (`waymark.mjs incidents`).
- **Codex test fixes:**
  - **Codex gets the same rules as Claude Code:** an agent whose hooks run Waymark's scripts (Codex: `hooks.json`) gets the Rule 0 block (`templates/instructions.md`) in its instructions file in place of the pointer line, kept up to date by `connect-agents.mjs --apply`; `waymark.mjs check` offers it when the block is missing or older. In the test, Codex never wrote the routing line (Enrutar ✘) because it only had the pointer.
  - **A free-text answer is kept as written:** up to 200 characters, with passwords, tokens, keys, URL credentials and e-mail addresses masked. Before, it was only "(respuesta escrita, N caracteres)", so the record lost which option the user meant.
  - **Tasks waiting for the user are asked, not forgotten:** the session start lists the open (▶) tasks and asks the agent to ask the user once which already work; `waymark.mjs done <ID…> [--note "…"]` marks them ✔ "confirmada por el usuario" and adds a chained `{kind: "confirm"}` record.
  - **`check` flags a wrong package manager:** memory.md's Identity or Quality gates naming npm/npx where package.json `packageManager` or the lockfile says pnpm (or any other mismatch). The test project's memory said npm, so every agent ran npx/npm in a pnpm repo.
- **Work in progress stays short after the migration** (3e-2 test): at each close, and by hand with `waymark.mjs tidy`, a task and its follow-ups keep only the newest line, open (▶) or pending lines whose task ID is older than 14 days move whole to `history.md` (the same age the session hook flags), and the extra ✔ lines too. `tasks.md` keeps at least 3 done rows; in-progress lines with the oldest IDs leave first, counted as "+n more tasks in memory.md".
- **The commit trailer counts anywhere in the message:** a `Waymark-Task:` line separated from `Co-Authored-By` by a blank line is not in the last paragraph, so git does not read it as a trailer; the record lost its note and Commit was ✘ (3e-2 test, T6). `commitsFor` now reads the whole message, and the instructions say the trailer goes in the last paragraph, next to Co-Authored-By.
- **A project with no build says so once:** the row `| build | none (<why>) | <date> |` in memory.md → *Quality gates* makes the Build testigo not applicable there (`testigos.mjs` → `buildNone`), and the record keeps the why (`observed.build`). Without it, every L2+ task with code in such a project was blocked once only to answer `Build: no (…)`.
- **Hook tests in the repo:** `node --test tests/*.test.mjs` (no dependencies, temporary `WAYMARK_HOME`).
- **Fix:** `protocol.md` → *Closing report* was an empty, unclosed code block that turned *When stuck* into code; it now shows a full Cierre and the decision gate.
- **Fix:** a multi-select answer in the choice window joins labels with "," (no space); the record no longer lists chosen options as discarded.

## 1.9.0 — evidence labels that match what happened
Ninth real test (1.8.0, an L1 bug in a real project: 1 attempt, no hallucinations, ~3% of the quota) still showed fields claiming more than was done, and two Waymark bugs:
- **Fix: no more false "no opener" notes.** The pre-edit opener note (1.8.0) fired three times in one task with the opener written: Claude Code does not persist reply text written after a thinking block. Removed; the `mem_search` note stays (tool calls are reliable).
- **Fix: `measure.mjs`** merges a prompt that got no response (recorded twice, or resent before any answer) into the next one, so it no longer counts as an attempt.
- **`Memoria: digest | leída | creada`**: `digest` when only the injected summary was used, `leída` only when the file was opened.
- **`Evidencia: observada <what you saw> | inferida de <source> (check: …)`**: a cause deduced from code or docs is *inferida*, with the user's check before the fix (replaces *hipótesis*).
- **`Cambia:`** in the opener: a visible behavior the user did not ask to change (order, layout, a default) is asked before it is implemented (it happened in tests 8 and 9).
- **Specs next to the changed code, at any level:** the end-of-turn hook asks for a `Tests:` field (a regression spec, or why not) when a spec sits next to the changed code, also at L1; `rojo→verde` must be backed by a spec edited and a test command run in the turn.
- **"Pre-existing" needs proof:** a Cierre that calls a failure pre-existing must say `comprobado en copia limpia de HEAD` or `previo: no comprobado (<why>)`.

## 1.8.0 — fewer wrong-direction attempts, checks that run themselves
Seventh real test (1.7.0): the largest cost is not the size of each step but attempts in the wrong direction. A small front-end bug cost ~9% of the 5-hour quota, ~6% of it in the API after the user had said "solo FE" (3 attempts, 14.1M tokens); an L2 with 1 attempt cost ~7%. Skipped checks repeated from test 6 (no browser-verify/code-review and no reason given, opener skipped in a turn, inferred evidence labelled "observed").
- **`Capa:`** in the opener: a layer the user named ("solo FE", "no toques la API") is binding; evidence pointing elsewhere → ask before leaving it.
- **Quick bug triage** (dept-qa) new step: a stale view after an action → check what reloads it (another tab via `window.open`, a cache in a service, a reused route) before blaming the backend. It was the real cause.
- **Sharper fields:** `Evidencia: observada <what you saw>` (code you read is not observed behavior); `Memoria: … · mem_search "<query>"` at L2+; `Navegador: … | no (requiere <physical action>; check: …)`; `Review: code-review <task's files> …` (a review without paths reviewed someone else's changes).
- **Cierre check** (`stop-hook.mjs`, Stop): a turn routed L1–L3 that changed project files must end with the Cierre; at L2+ `Navegador`/`Review` name browser-verify/code-review or say why; otherwise the agent is asked once to complete it.
- **Pre-tool checks** (`tool-hook.mjs`, now also on edits): recursive `grep`/`find` that walks `node_modules` is denied with the fix (hung 120 s, four times); an edit in an L1–L3 turn with no opener found gets a one-line note. Not a denial: Claude Code does not persist reply text written after a thinking block (checked on 2.1.286), so the transcript cannot prove the opener is missing.
- **Context notices:** the resume guard (150k tokens + 60 min idle, unchanged) now saves the stopped prompt and a new session in the same folder within 30 min takes it over, so nothing is retyped. While a session is active nothing is blocked: past 300k tokens of context (and every 200k more) a notice shown only to the user (`systemMessage`, 0 model tokens) says a new task is cheaper in a new session.
- **Claims checked against tool calls** (eighth real test, on 1.8.0-dev: the Cierre passed the format check while declaring a procedure never read, "sin infra" next to an existing spec, "Navegador: no (requiere login)" without trying, which is how a stuck tooltip reached the user, and "Review: omitido (revisión propia)"). `stop-hook.mjs` now requires the Read of the declared `procedures.md`, no spec next to the changed files for "sin infra", a real browser attempt when UI files changed (L2+), `code-review` when code changed (L2+; docs/config-only exempt) and a `mem_save` for "engram: guardado". `tool-hook.mjs` adds a note before the first L2+ edit when engram is available and no `mem_search` ran. Replayed on that session: it flags the spec, the missing browser attempt and the missing code-review.
- **The user can skip a check, for one task:** "no hagas tests", "sin navegador", "no corras code-review" → `omitido (usuario: "<their words>")` in that Cierre field and in the task's *Work in progress* entry. The end-of-turn hook accepts it only when those words are in the user's messages (prompts are persisted reliably; accents and case ignored); the next task, or "ahora sí", returns to the defaults (build, specs, unit tests, browser, code-review).
- **Pre-existing failures proven without touching the user's work:** a clean copy of HEAD (`git worktree add <tmp> HEAD` → rerun → remove) instead of `git stash`, which can lose the staged state; not allowed to run it → "no comprobado (sin permiso para <command>)" without retrying. `tool-hook.mjs` denies `git stash` (not `list`/`show`) with that method.
- **Self-evaluation guide in the repo** (`references/evaluation.md`): aligned with the current fields (Copia, Capa, mem_search at L2+), a "declared ≠ done" rule and a *Declaraciones sin respaldo* line; the local `~/.waymark/evaluation.md` becomes a pointer, so it no longer goes stale.
- **`measure.mjs`:** background-task notifications are no longer counted as prompts (they inflated attempts); a shared `transcript.mjs` reads transcripts for the hooks and `measure.mjs`.

## 1.7.0 — fewer tokens per session and per prompt
Measured in a real 500k-token session: resuming it after an hour idle cost 502k tokens of cache writes (8% of a 5-hour quota) for a one-line message; the Rule 0 reminder was re-sent in full on every prompt; the skill listing (Waymark's and the user's unused ones) is paid in every session.
- **Resume guard** (`rule0-hook.mjs`): reads the session transcript; with ≥ 150k tokens of context and ≥ 60 min idle (the prompt cache expired), it stops that one prompt (0 tokens; the user sees why) and suggests a new session or `/compact`; resending continues. `WAYMARK_RESUME_TOKENS` / `WAYMARK_RESUME_MINUTES` (0 = off).
- **Adaptive reminder:** the full Rule 0 reminder (~120 tokens) only when the last reply did not open with `Waymark →`; otherwise one line (~35).
- **Shorter triggers:** the 17 Waymark descriptions went from 8,558 to 4,407 characters (~1,000 tokens per session); procedural notes moved to the bodies they already lived in; templates and the devex procedure cap them at ~300 characters.
- **Skill fit** (`skill-fit.mjs`, Claude Code): skills you added (claude.ai synced, `~/.claude/skills`) with no invocation in 30 days → `skillOverrides: "name-only"` (still invocable); plugins with no skill used → `enabledPlugins: false`. Plan by default, `--apply` after a yes, `--restore`; never Waymark's skills, `skill-map.json` providers or bundled skills; needs 14 days of history. The session hook computes it in the background and offers it at most once a month. Verified: `name-only` drops a synced skill's description from the listing.
- **Token economy** (`protocol.md`): small tool outputs, sub-agents are not free, `/compact` is safe with L3 checkpoints, new session over resuming a large idle one.
- **`measure.mjs`:** new *Ctx* column, the context each prompt started with, to see growth per prompt.

**Sixth real test (measured on 1.7.0-dev): L1 593k tokens, 1 attempt (~1% of the 5-hour quota); L2 1.7M + a 572k second attempt.** ~95% is cached context re-read on every response, so the levers are fewer round trips and fewer attempts. The fields the agent skipped become checkable:
- **`Copia:`** in the opener when the ask is "like X": only the properties the user named (the second attempt copied X's whole rule).
- **`Procedimiento: <section> (procedures.md:<line>)`**: shows the section was read, not just named.
- **Cierre:** `Aprendido` quotes the rewritten *Work in progress* line (never "ninguno"); L2+ `Tests: rojo→verde <spec> | sin infra (<proof>)`, `Navegador: browser-verify <result> | no (<what failed when tried>)`, `Review: code-review <findings> | omitido (<why>)`.
- **Batch independent tool calls** in one response (instructions and both reminders): each response re-reads the whole context.
- **`mem_search`** only at L2+ or for a topic the injected digest lacks (the digest already covers L1).
- **Inline-script guard** (`tool-hook.mjs`, PreToolUse): denies an inline `node -e` with backticks, `${` or regex escapes (mangled by shell quoting, twice in real tests) and asks for a script file; `# waymark:allow` skips it.
- **Angular stack:** `ng build --configuration development` as the L1 compile check (templates included) instead of the full build.
- The instructions block's index is one line instead of a table (same entries).

## 1.6.0 — guest mode, third-party skills, one attempt per task (measured)
Changes accumulate on `develop` and reach `main` in one release, so installs see one update notice per release instead of one per change.

**Guest mode: Waymark adapts to whoever arrived first.** A real install next to an orchestrator showed that 1.5.0's `other-leads` still competed: the same Rule 0 block (only moved below) and Waymark's hooks kept claiming the turn. Waymark is not an orchestrator, so it now fits inside one:
- **Orchestrator already installed → `guest`** (recommended): no Waymark hooks, no Rule 0 block. The skills are registered through the orchestrator's own registry (its own refresh command, INSTALL §7.4) and project memory travels through engram (`topic_key waymark/<slug>/…`).
- **Departments work without the block:** each `dept-*` runs a *Guest entry* (recall project memory, apply its rules and one procedure, reply in the orchestrator's format, update memory) when no Waymark block is in context.
- **Waymark first, orchestrator later → `waymark-leads`:** the session hook asks once whether to keep leading (its skills become *Fallback* via `skill-registry.md`) or step down to guest; when the listed orchestrator's markers disappear it offers the full install back.
- `other-leads` from 1.5.0 is read as `guest`; updates offer to remove the block and hooks it left.

**One attempt per task, measured.** A task costs *attempts × cost per attempt*; the four real tests went from ~20 messages per task to 1–2. This release closes the gaps that still cost attempts and adds the way to prove it:
- **Pedido · Captura** (opener): the request in the user's terms and, per image, the screen, element and state it marks; two readings → one question before editing. The one second attempt in the tests was the right fix on a misread target.
- **Third-party skills are used:** `sync.mjs` indexes other agents' skill folders (`~/.cursor`, `~/.codex`, `~/.agents`, Gemini, OpenCode) and project skill folders, guesses each one's capability, records its path (agents read and follow that `SKILL.md`), lists the six replaced community skills as *Replaced (not used)* and drops uninstalled auto entries. The session hook refreshes the registry in the background when skill folders change.
- **L3 checkpoints:** the plan lives in the task's *Work in progress* (`✔1 · ▶2 · 3`, next gate, *Descartado*) so a compaction or a new session resumes from disk instead of guessing (`protocol.md` → *L3: plan as checkpoints*).
- **Memory hygiene:** the injected memory is labelled *pointers, not facts* (the code wins and the entry gets fixed); *Work in progress* older than 14 days is flagged; entries record `decision ← evidence`; stale *Solved problems* are deleted; the project file is the source of truth over engram (`learning.md` §7).
- **Decision chain:** a fixed hand-off line between departments (`hecho · necesita · evidencia · abierto`, `protocol.md`).
- **Framework MCP servers only where the framework is used:** your servers stay registered where they are (nothing is moved or removed). `mcp-fit.mjs` reads each known project's manifests (none up to the repository root = no framework) and adds a deny rule (`mcp__<server>`) to that project's `.claude/settings.local.json` for each framework server it does not use (Angular, PrimeNG, React, Vue, Tailwind, NestJS, Prisma, Rails, Django…), lifting only its own rules when the project adopts the framework; `--apply` after a yes merges with a backup and never touches a file it cannot parse. Measured: the rule hides the server from tool search and its names/instructions from context (~120 tokens per server per request) and stops calls to the wrong framework. The session hook offers it per folder, at most once a week. Docs and memory servers are never blocked.
- **`measure.mjs`:** per prompt, responses, tool calls, images, new vs cached input, output and sub-agent tokens, the fixed context at session start, and attempts for a range of prompts. Responses streamed over several transcript lines are counted once (earlier ad-hoc counts summed them 2–3×).

## 1.5.0 — coexistence with other agent frameworks
A real install met an orchestrator (persona, memory protocol, flow orchestrator, review triggers) and could only offer "skills only" or "full install with conflicting rules". Now Waymark adapts instead of competing:
- **Detect and classify** (INSTALL §1.1, `references/coexistence.md`): every rule of the other framework becomes *Adopted* (Waymark follows it), *Fallback* (its skill backs a capability, or *When stuck*) or *Resolved* (same-moment conflict, per mode).
- **Who leads [ask]:** `waymark-leads` (recommended), `other-leads` (block below theirs, no opener, session hook only) or `skills-only`. The user can move any rule.
- **Their files are never edited;** the adaptation lives in `~/.waymark/coexistence.md`.
- **Session hook** injects it (≤ 1,800 chars) and, when the instructions file carries a framework marker the file does not list, asks the agent to offer configuring it before the task.
- **Rule 0 hook** follows the mode (full, support reminder or silent).
- Updates re-check new frameworks and rules; uninstall leaves the other framework untouched; `sync.mjs` never creates `coexistence.md` on its own.

## 1.4.0 — memory injected at session start
Fourth real test: right decision on the first try (4/4), department first, procedure sections read, tests 10/10 + build, Solved problems and engram saved. Gaps: the opener asked for "Memoria: leída" before any tool call (impossible to fill truthfully), Environment was not read (python tried again), L2 checks skipped, code from another task deleted without asking.
- **Session memory hook** (`session-hook.mjs`, SessionStart): injects this machine's *Environment* and the project's memory digest (Solved problems symptoms, gates, Work in progress), capped at 2,500 chars. Recall no longer depends on the agent.
- **Opener in two moments:** routing line first; `Memoria · Reutiliza · Evidencia · Procedimiento` before the first edit.
- **L2+ Cierre fields:** `Tests: rojo→verde | sin infra · Navegador · Review`.
- **API verification:** official docs or the installed package source, cited.
- Removing code not written in this task needs a yes.
- INSTALL registers both hooks; updates add the new one.

## 1.3.0 — template instead of rules
Three real tests: the right decision on the first try 3/3. What sits in the **first text and first tool call** is always done; rules placed "in the middle" (brief lines, procedure, memory search) kept being skipped, and every evaluation proposed more rules. So 1.3.0 turns rules into **fields**:
- Every turn opens with two lines: the routing line and `Memoria · Reutiliza · Evidencia · Procedimiento`; every change closes with `Gates · Aprendido · engram`. Each field is a step that must be filled truthfully.
- Evidence that cannot be observed is declared as *hipótesis* with the user's one-line check **before** the fix.
- Only skills that will be invoked are listed; a support department only if its Quick ref was read; library internals count as API → `library-docs`.
- Visual bugs route to `dept-frontend`; `dept-qa` owns tests, review and bugs with no clear layer.
- *Work in progress* is per task; other tasks' pending items are kept.
- Instructions block 5.7k → 4.7k characters; hook reminder matches the template.

## 1.2.0 — lessons from the second real test
The second test confirmed 1.1.0 (routing line first, department skill as the first tool call, Spanish narration, build gate, reuse found, right result first try). Remaining gaps:
- **Environment knowledge:** `profile.md` gets an *Environment* section (OS, shell, missing tools, how to edit files), read at Recall and filled by the learning loop, so no session wastes attempts (e.g. heredoc → missing python → Edit).
- **Verifiable memory step:** the brief states `Memoria: leída | creada <file>` before the first edit.
- **Announced skills are invoked** with the skill tool; no announcing skills that are not used.
- **No unrequested behavior:** extras are proposed, not implemented.
- **Gates after the last edit;** L2 without a spec: add one where the project tests that kind of file, else say "sin infraestructura de test" and give a one-line check.
- `dept-frontend` Quick ref lists the key UX musts.

## 1.1.0 — lessons from the first real test
The first real test fixed in one attempt a bug that had failed over 20 times, but the agent skipped the "expensive" parts of the routine on a quick fix. This release makes them cheap and concrete:
- **First actions are explicit:** first text is the routing line, first tool call is the owner `dept-*` skill; all text in the user's language (block and hook).
- **Minimal bootstrap:** a missing project memory is created in one step (identity + gates from the project's own docs or manifest); the full scan is for L2+.
- **L1 minimum gate:** lint or typecheck of the changed files (UI: quickest compile check).
- **Evidence plan B:** without a browser or behind a login, give the user a one-line DevTools/console check and mark the fix *no verificado*.
- **Learn always:** a missing memory file is no reason to skip *Work in progress* and *Solved problems*.
- **Quick bug triage** procedure in `dept-qa`.
- Instructions block rewritten shorter.

## 1.0.0 — first release as Waymark
- **Departments:** 10 department skills (`dept-product`, `dept-architecture`, `dept-frontend`, `dept-ux-ui`, `dept-backend`, `dept-data`, `dept-security`, `dept-qa`, `dept-devops`, `dept-devex`) plus the `waymark` core and 6 tool skills (`ui-build`, `ui-refine`, `ui-system`, `ui-audit`, `browser-verify`, `library-docs`).
- **Rule 0 on every request:** recall → route → skills → verify → learn; questions in read-only consult mode; routing line at the start of every reply; per-prompt reminder hook.
- **Layered loading:** instructions block → one department → one procedure → one mode; references only when needed.
- **Right decision, faster:** reuse before create, minimal project scan with a project map, evidence before change, two-strike rule, official docs escalation, *Solved problems* with dead ends.
- **Self-filling memory** in `~/.waymark/`, shared by every agent, with *Work in progress* so another session or agent resumes where the last stopped.
- **Grows with use:** missing skills are created (global or project, asked), unknown architectures get a generated profile, the user's own MCP servers are mapped and used.
- **Install, update and uninstall** written for the agent (INSTALL.md), multi-agent, with choice windows, backups and daily update notices.
