# Waymark

**The supply chain of AI-agent work.** Provenance, evidence and verification for every change an AI agent makes to your code. Every change goes through defined stages: the department that owns it, **your** decision among the optimal options, evidence, gates and review. It comes out with a verifiable record: what it was built with, who decided what and when, what was proven, which commit it produced.

For Claude Code, Codex, Cursor, Gemini CLI, OpenCode and any agent that reads [Agent Skills](https://agentskills.io) (`SKILL.md`).

A *waymark* is the sign that marks a trail: it shows the way, and you choose the path. Agents often reach the right answer only after many attempts: they guess APIs, edit the wrong element, rebuild what the project already has, forget yesterday's fix and take decisions you would not have taken. Waymark shortens that path. At every real decision the agent lays out the optimal options with their files, risk and cost and marks the one it recommends; **you decide**, because the recommended one may not be what you need.

It is not an orchestrator and it spawns no agent pipelines. It is a set of skills that makes the agent work like a software company. Every non-trivial task goes through the **department** that owns it. The department decides:

- **what** gets built, **why** and for whom;
- **where** it lives in the architecture;
- **how** it is done, and **which skills and MCP servers** to use.

The task then closes with a Definition of Done (typecheck, lint, tests, build, architecture conformance). Finally the agent **learns** from the result.

Stack- and language-agnostic: department rules are generic. Stack and architecture specifics live in profiles.

## What Waymark is, and what it is not

**Waymark is a chain of custody for the work an agent does on your code.** For each task it keeps one record, chained by hash and anchored in git, of what governed the task, what you decided, what the hooks proved and which commit came out; and it lets someone who was not there check that record.

It is not an environment installer, not an orchestrator that runs agents, and not a workflow framework: it is skills the agent reads, hooks that run beside it and a record. It does not audit your dependencies.

**Next to environment configurators.** Some tools configure the agents you already use: persistent memory, a development workflow, a skills library, personas and a deny-list of sensitive files, with a snapshot before every write (the public README of one such tool, read on 2026-10-25). Waymark configures no environment: it keeps one chained record per task and checks it. They answer different questions, what to set up for the agent and what the agent did, and one machine can have both: Waymark detects another framework and adapts to it (`coexistence`), and its learned layer already uses Engram for memory. Where they overlap (a deny-list of sensitive paths, memory across sessions) Waymark's own is described below and tested by its own suite, not compared with the other's. That README describes no per-task record and no hooks, while Waymark's guarantees rest on hooks where the agent lets one run. This is a reading of a public README on one date, not a test of the tool.

What it records, and where each statement is tested:

| Statement | Source |
|---|---|
| One record per task, chained by hash; an edited, deleted or re-chained log is detected | `tests/supply-chain.test.mjs`, `tests/verify.test.mjs` |
| The log is anchored in git (`refs/notes/waymark-anchor`) and a clone rebuilds its memory from git | `tests/supply-chain.test.mjs`, `tests/memory-chain.test.mjs` |
| Your decision is the answer you gave in the choice window, recorded as given with its position before or after the first change | `tests/hooks.test.mjs` |
| Gates, tests, review and build are computed by the hooks from the tool calls, not declared by the agent | `skills/waymark/routine.json`, `tests/integrity.test.mjs` |
| Evidence is checked against the task's tool calls; a fact no call shows is marked | `tests/supply-chain.test.mjs` |
| Each record pins the rules that governed it (department, procedures, `routine.json`, profiles) by hash | `tests/verify.test.mjs` |
| The cost of each task is split into routine, work and reply | `tests/hooks.test.mjs`, `docs/audit-context.md` |
| The review is required where the risk is: L3, a sensitive path, many files or lines | `tests/risk.test.mjs` |
| Reading or editing secret-bearing paths is blocked where the agent's hook runs before the tool | `tests/guard.test.mjs` |
| `node "<skills-dir>/waymark/scripts/waymark.mjs" verify` checks the chain, the installed files against `MANIFEST.json` and the release signature; `attest` exports one task | `tests/verify.test.mjs` |
| Stack profiles for 13 ecosystems and 6 architectures, measured on five outside repositories | `skills/waymark/stacks`, `tests/external.test.mjs` |

What it does not do, so that nobody has to find out later:

- **A signed anchor proves little, and says what.** With a signing key set up (`WAYMARK_SIGNING_KEY`, a `Signing key: <path>` line in `~/.waymark/preferences.md`, or git's `user.signingkey`), the hook signs each task's anchor when it closes, with your ssh key and without ever asking for a passphrase (a locked key is recorded as `unsigned (key locked)`; `node "<skills-dir>/waymark/scripts/waymark.mjs" sign --pending` signs those from your terminal). The signature proves that the holder of that key vouched, at the close, for the log's length and last hash, so a log rewritten and chained again can no longer be re-anchored without the key. It does not prove the content is true, that the key belongs to the person it names (the keys `verify` trusts come from `skills/waymark/ALLOWED_SIGNERS` and your own `~/.waymark/ALLOWED_SIGNERS`; whoever controls those files controls the verdict), or when it was signed: the time is the hook's claim, not a timestamp authority. A key left unlocked on a machine signs whatever runs there. The anchors from before signing began stay unsigned, and without a key the chain resists accidents and partial edits, not someone who can rewrite the repository and chain it again. `verify` reports `unsigned` as a warning; `--require-signed` (or `--require-signature`, which also asks for the release's) makes it fail. `attest --out` signs the statement it exports (a `.sig` beside it); `docs/adr/0034`.
- **A copy on a remote is what makes a rewrite visible.** The notes hold your requests and Cierres, so pushing them is your yes, per project: `check` offers it with the choice window (`node "<skills-dir>/waymark/scripts/waymark.mjs" notes push --always` keeps pushing that project's notes at each close, with no prompt and without ever blocking a turn; a public remote publishes them). With no yes, nothing leaves the machine, even when the agent pushes your code: the records stay local notes (`docs/adr/0042`). `node "<skills-dir>/waymark/scripts/waymark.mjs" verify --remote` then fetches the remote's anchors into a temporary ref and compares them with this log: a record rewritten and chained again, even with the local anchors rewritten to match, no longer matches what the remote kept, and the first task that differs is named. With no remote, or one it cannot reach, `verify` says `no remote copy` or `not checked` as a warning, never in silence. It does not stop a rewrite that also force-pushes the notes to that remote; `docs/adr/0035`.
- **The inputs are pinned, and what that proves.** The engram release the learned layer was tested with is pinned in `skills/waymark/engram.pin.json` (its version and, for each OS and architecture, the sha256 of the release archive and of the binary inside it); `check` compares the engram on the machine with it and each record keeps the version it was written under (`inputs.engram`). `skills/waymark/skills.lock` pins each third-party skill the release vendors (`sync.mjs --vendor <name> --ref <tag|commit>` writes it) to its source, ref and the sha256 of its folder, and `verify --install` names a skill that moved. Waymark's own scripts import nothing outside Node's built-ins (a test fails on a package or a `package.json`), so there is nothing to install and nothing to resolve. A pin proves that these bytes are the ones that were tested; it does not prove they are free of faults, that the pin itself was not changed together with the file (the manifest and its signature are what protect the pin), or anything about a release newer than the pin. `docs/adr/0036`.
- **"Done as asked" is the agent's own list, checked for completeness.** At L2+ the agent numbers the requirements of the `Pedido` line and the Cierre answers each one (`Pedido: ✔1 <evidence> · ✘2 <why not>`); an item left out, or `Resultado: hecho` over a ✘, is sent back once, and if it stays the record says `parcial`. That proves every item has an answer and none contradicts its own result; it does not prove an answer is true or that the list is what you meant (the Evidencia testigo checks what each answer cites). The first choice window is judged on its options carrying their risk, files or cost and one marked recommended (a finding, never a block); `tasks.md` shows the claims a call backs per task (`10/10`, ⚠ below 0.95) and the tasks whose files came back; `docs/adr/0038`.
- **The same behaviour in every agent is tested, not claimed; a live session is not.** One list of 35 behavioural cases (`tests/conformance/`) runs the real hooks with each adapter's own payloads and transcript, and a task handed from one agent to the next keeps the memory, the open task, the precedent and an intact chain (`tests/handoff.test.mjs`). That is as far as the documentation of each agent and Waymark's journal of its events go: no adapter has been run by this suite on a live session, and Qwen Code, Droid and Amp, whose adapters were written from their documentation in 2.0.18 (`docs/adr/0041`), have a file of what their first live session must check (`adapters/<agent>.md`). Windsurf and Crush have no adapter because their hooks cannot carry the chain: Windsurf has no session start and no way to give the model context, and Crush has a single event, before a tool. `node "<skills-dir>/waymark/scripts/waymark.mjs" adapter-new <agent>` drafts one from the template and the agent's documentation, runs the same list on the draft and installs it only if it passes; `stack-new <path>` drafts a stack profile for a repository with none, every command "to verify once". `bench/reference.mjs` measures read-only clones of the repositories you list in `~/.waymark/reference-repos.json` (never in this repository): the stack Waymark detects, whether the hooks recognise the gates, what it injects against what the repository's own agent assets weigh. Guest mode (a repository that carries an orchestrator's blocks) is detected there and tested by its own cases, not exercised on a real one; `docs/adr/0039`.
- **It stops only where the agent lets a hook run.** The table below says, per agent, what is enforced and what is only asked. The sensitive-path guard refuses a shell command that names a secret-bearing file that exists, whatever the program (`cat`, `type`, `Get-Content`, `head`, `tail`, `less`…), also through a glob, a flag's value, an attached redirect, a revision (`git show HEAD:.env`) or another shell (`bash -c`); it does not stop a search that reaches a secret without naming it (`grep -r`, a script). Where nothing can refuse a call (the reads of seven agents, a script, a secret a command prints), the end-of-turn hook reads the transcript of any agent and records what got through (`observed.guarded`: the kind, the tool and the path, never the value) with a finding that does not block: the table says *prevent* or *detect* for each, never neither. Detection happens after the read, so it does not undo it; `docs/adr/0037`.
- **The cost figures are measured per task and per part, not compared with any other tool.** There is no published token comparison.
- **Outside the author's own projects it was measured on eight repositories** (Rust, Laravel, Terraform, Python data science, documentation only, a Kotlin Android app, a multi-language monorepo, an embedded C library): detection, profiles and gate recognition on all eight, and one real small change made by an agent in each, twice (before and after the fixes it found), with the tokens of the routine, of the work and of the reply counted per run (`tests/external/results-2026-10-16.json`, `docs/adr/0027`). What those runs show: a change that only touches comments no longer owes a gate, a spec or a build; a gate whose tool is not installed is reported as "could not run here" and accepted with `no comprobado (<why>)`, not counted as a failure; Android and C have their own profiles. What they do not show: none of those ecosystems' toolchains was installed on the machine of the run, so whether a gate passes there is not measured; each run happened once with one model; creating `.waymark/memory.md` stays the agent's job and some runs skipped it; a Python docstring and a Terraform description count as code; a repository with a JS framework and a PHP backend is classed Node. No token comparison with any other tool was run.


## A supply chain of the agent's work

A software supply chain tracks how an artifact was built: its inputs, the steps it went through and who approved them, with records that cannot be altered unnoticed. Waymark applies that to the agent's work. The hooks build the record locally from what the session transcript proves, not from what the agent says, and cost 0 model tokens.

| Link | What Waymark records | How it is verified |
|---|---|---|
| **Inputs** | your request in your words; the project memory; a manifest per task: Waymark and agent version, model, MCP servers used, hashes of the instruction files | read from the transcript and the files at the end of the turn |
| **Department** | the department that owns the task (frontend, backend, data, security, QA, devops, architecture, UX/UI, product, devex): its procedure, rules, tools and Definition of Done | the owner named in the routing line must have been invoked, and its procedure read before the first change; the record keeps declared vs invoked. A question that turns into a change is re-routed, or it is stopped |
| **Decision** | the options put to you, the one you picked and the ones you discarded, on a dated task ID (`2026-10-02 · T3`), each answer with its position (before or after the first change) | your answer in the choice window, recorded as is: no file changes, by edit or by shell, until you were asked; the agent never restates it |
| **Evidence** | what was observed vs inferred, and the check you were given before the fix | written by the agent, and checked by the hook: «observada» needs a tool call that checked the state after the last change (a commit or push is none), and each fact it cites (`84/84`, `exit 0`, a hash, text in backticks) is looked up in the task's tool calls, never in the agent's own edits; a `file:line` also counts when a call named the file and printed that line (`grep -n`, Read); one no call shows is recorded as *sin respaldo* and shown as ⚠, without lowering the score. The hook also judges actions: a failing gate needs a clean-copy check, a command failing twice needs a docs call before the next run (`docs/adr/0025`) |
| **Gates and review** | lint, typecheck, tests, build, code review (the eyes: a browser measures or clicks a seen change by itself, localhost only), memory and procedure used, with the time each gate took and whether it failed | **computed by the hooks** from the tool calls, never declared by the agent (the platform generates the provenance, as in SLSA). What blocks and what is only scored is one contract, [`skills/waymark/routine.json`](skills/waymark/routine.json), that you can change: by default the project memory searched (`node "<skills-dir>/waymark/scripts/waymark.mjs" pack`) before the first change, a gate after the last change and, at L2+ with code, code-review (or `node "<skills-dir>/waymark/scripts/waymark.mjs" review` in agents without it) and the build at the end. Everything is scored in an automatic evaluation of each task (✔/✘ per step, tokens, estimated quota), shown to you in one line |
| **Output** | the files changed and the commits | the files git saw change between your message and the end of the turn, whatever tool changed them; each commit carries `Waymark-Task: <task ID>` and the record keeps its hash |
| **Record** | one line per task in `<project>/.waymark/provenance.jsonl` (with a commit: the whole record as a git note on it, `refs/notes/waymark`), and `tasks.md` next to it: in progress, pending, next step, done | each line holds the hash of the previous one (and of its note): editing or deleting a past task breaks the chain. Each record also anchors the log's length and last hash in git (`refs/notes/waymark-anchor`, travels with the notes), so a log rewritten and chained again breaks it too; a removal you ask for goes through `node "<skills-dir>/waymark/scripts/waymark.mjs" forget`, which leaves a rewrite anchor with your reason (`docs/adr/0025`). What has no commit (a question, a task without one) rides in git too (`refs/notes/waymark-log`), a task committed in several repos has its note in each, and a clone or a cleaned project with no `.waymark/` gets its memory and `tasks.md` rebuilt from git at session start (`docs/adr/0012`, `0013`). The folder is local (kept out of git through `.git/info/exclude`; the project's own `.gitignore` is never touched) and plain Markdown/JSONL, so any agent (Codex, Cursor, a new session) resumes from it |

How good is it, in numbers: `node "<skills-dir>/waymark/scripts/waymark.mjs" scorecard` (from this repository's root) scores Waymark against 13 weighted criteria, from the provenance and tamper evidence of the chain to token cost, agnosticism, reuse of earlier evidence and tasks done as asked. Every check is a file, a pattern, a command's exit or a number measured from the records; what is not built scores 0 and names the plan point that adds it, and the total is never rounded up. The weights, checks and thresholds are locked by a hash in [`docs/adr/0028-scorecard.md`](docs/adr/0028-scorecard.md), so the target cannot move without a new decision record.

Where it stands before the tag of 2.0.19 (2026-10-27, measured on this repository with the code of this commit, after the reinstall of 2.0.19-dev): **96.5 %**, above the release target of 95. The checks that read the records count only the tasks the 2.0.19 hooks wrote, and three checks read real use (`docs/adr/0049`); every failing check is listed here as it is, not averaged away. Read from the records of tasks closed before the last fixes (this repository holds 14 tasks of 2.0.19, most of them the fixes themselves), and moved only by tasks run on the reinstalled 2.0.19 in real projects: recent tasks that passed every testigo 0.922 against 0.95, the routine share of the last 5 L1 tasks 0.199 against 0.065, the share of cited facts backed by a call 0.811 against 0.95, the share of tasks redone as a follow-up 0.500 against 0.2, and the share that closed parcial 0.571 against 0.2. Measured over the real projects with `scorecard --projects` (this repository and landing-flujo, 18 tasks of 2.0.19): parcial 44.4 %, median 11.1 M tokens per task, one agent. Left for 2.0.20 on purpose: every recent task was closed by Claude Code, so check 9.9 reads one agent of two (a real task on another agent is the 1 % only a person can add), and the precision of the precedent at three reads 0.765 against its frozen 0.85, which a better algorithm has to earn. The median tokens of a task are frozen in this release at 15 M (the 2.0.19 baseline of 14.3 M and a margin). The score was measured again before the tag was cut (that is the number above); the real tasks that move the checks listed are the ones the author runs on the installed 2.0.19 from now on. The suite passes on this machine, and CI runs it on pull requests and on the release tag; the release's manifest and tag are signed by the author's key when the tag is cut (`verify --install --require-signature` checks it). The adapters of Qwen Code, Droid and Amp were written from their documentation and have not run in a live session, nor has any adapter but Claude Code's run a real task: the list of checks only a person can run is below. Not measured, because only time and use can show it: learning over months, several models, several users, guest mode against a repository that carries its own orchestrator blocks, and the cost per version beyond the versions with recorded data. Details and the table: `docs/adr/0028` and `docs/adr/0049`.

What it is not: an SBOM or a dependency audit. Dependencies are `dept-security`'s job; this chain covers the work the agent does on your code. Decisions: [`docs/adr/`](docs/adr).

### Next to the supply-chain frameworks

Waymark borrows ideas from software supply-chain work and claims none of its certifications. What each framework is for, and where Waymark stands against it:

| Framework | What it is for | Where Waymark stands |
|---|---|---|
| [OpenSSF Scorecard](https://scorecard.dev) | Automated checks of an open-source repository's security practices | A different tool answering a different question. Waymark's own `scorecard` scores Waymark against its 13 criteria (ADR 0028); it is not an OpenSSF Scorecard result and says nothing about the project it runs in |
| [SLSA](https://slsa.dev) | Levels of integrity for how an artifact was built, with provenance a build platform generates | The model for the idea of a record the hook computes instead of the agent declaring (ADR 0001, 0004). No SLSA level is claimed |
| [in-toto](https://in-toto.io) | Attestations of the steps of a supply chain | `attest` exports one task as an in-toto Statement v1 with a predicate of Waymark's own (ADR 0027). What is signed and what is not is under "what it does not do" |
| SBOM ([SPDX](https://spdx.dev), [CycloneDX](https://cyclonedx.org)) | An inventory of the components of a piece of software | Not an SBOM: the chain covers the work the agent does on your code, not your dependencies, which are `dept-security`'s job |
| [NIST SSDF](https://csrc.nist.gov/pubs/sp/800/218/final) (SP 800-218) | A set of secure software development practices | Some of what Waymark checks (a review where the risk is, no secret in the diff, sensitive paths guarded) is the kind of practice it names; no practice-by-practice mapping has been made, and none is claimed |

None of this is a compliance claim.

## Share what you learn: the pattern, not the case

Waymark learns on your machine: each task you close teaches your own install, and nothing leaves it unless you send it (`docs/adr/0042`). To know whether it works beyond one machine, it needs **patterns** from people who use it: what happened, with which agent, version and level, and how often, said so that anyone could reuse it without knowing your project. Your **case** (code, prompts, paths, client names) stays with you. Share a pattern with the *Pattern report* issue form; send a change as a pull request against `develop`, which the author reviews and signs. How, with examples of a pattern and a case: [`CONTRIBUTING.md`](CONTRIBUTING.md).

`node "<skills-dir>/waymark/scripts/waymark.mjs" report [<project path> …] [--out <file>]` writes that summary for you to read before you share anything: counts and shapes only (the level, the kinds of check that failed, the outcome, buckets of time and tokens, the stack family, the agent and the model family), never a prompt, a path, a file name, code, a project name or an address, and Waymark never sends it. `scorecard --projects [<project path> …]` pools the last tasks of the projects you name, so the real-use numbers (how many closed parcial, which agents closed them) are read from use and not from the repository alone.

Every task the author has recorded ran on Claude Code; the other adapters are judged by the conformance list, not yet by live use, so a report from Codex, Cursor, Gemini CLI or any other agent is worth the most. Waymark 2.0.19 is the baseline: its numbers come from tasks run on 2.0.18 and later, and each release after it says how much it improved.

## What each agent enforces

Hooks differ by agent, so what Waymark can stop differs too. The tables are generated from the code, not written by hand. A read through a shell command that names no file (`grep -r`, a script) is not stopped by the sensitive-path guard on any agent.

<!-- agent-matrix:begin (generated by skills/waymark/scripts/matrix.mjs --write; do not edit) -->
**Hook events Waymark registers, per agent** (from `agents/agents.json`):

| Agent | SessionStart | UserPromptSubmit | PreToolUse | PostToolUse | Stop |
|---|---|---|---|---|---|
| Claude Code | yes | yes | yes | — | yes |
| Codex | yes | yes | yes | — | yes |
| Gemini CLI | yes | yes | yes | yes | yes |
| OpenCode | yes | yes | yes | yes | yes |
| Cursor | yes | yes | yes | yes | yes |
| Antigravity | yes | yes | yes | yes | yes |
| Kiro | yes | yes | yes | yes | yes |
| Copilot CLI | yes | yes | yes | yes | yes |
| Qwen Code | yes | yes | yes | yes | yes |
| Droid | yes | yes | yes | yes | yes |
| Amp | yes | yes | yes | yes | yes |

**What each agent enforces.** *enforced*: a hook runs and can stop the turn or hand the agent the text. *advisory*: the agent is told in its instructions and nothing blocks it. For what the guard protects, *prevent*: a hook before the tool refuses the call; *detect*: nothing refuses it, and the end-of-turn hook reads the transcript of the agent and records what got through in the record of the task, where it cannot be removed. No guarded action is left with neither.

| Agent | End-of-turn checks | Decision gate and commit trailer | Memory and procedures handed over | Sensitive paths: edits and shell | Sensitive paths: reads | Secret printed in a tool result | Context brake |
|---|---|---|---|---|---|---|---|
| Claude Code | enforced | enforced | enforced | prevent | prevent | detect | enforced |
| Codex | enforced | enforced | enforced | prevent | detect | detect | enforced |
| Gemini CLI | enforced | enforced | enforced | prevent | detect | detect | enforced |
| OpenCode | enforced | enforced | enforced | prevent | detect | detect | enforced |
| Cursor | enforced | enforced | enforced | prevent | detect | detect | enforced |
| Antigravity | enforced | enforced | enforced | prevent | detect | detect | advisory |
| Kiro | enforced | enforced | enforced | prevent | detect | detect | advisory |
| Copilot CLI | enforced | enforced | enforced | prevent | detect | detect | advisory |
| Qwen Code | enforced | enforced | enforced | prevent | prevent | detect | enforced |
| Droid | enforced | enforced | enforced | prevent | prevent | detect | enforced |
| Amp | enforced | enforced | enforced | prevent | prevent | detect | enforced |

Coming soon, no adapter yet (nothing is recorded or checked there): Windsurf (no session start and no documented way to hand the model context (a pre-hook can only exit 2 with stderr), so it cannot carry a card, a task ID, a record or a Cierre); Crush (one event only (PreToolUse), so it cannot carry a card, a task ID, a record or a Cierre).
<!-- agent-matrix:end -->

## Pending real-use checks

Tested and claimed are two different things: the conformance list runs every adapter against its own documented payloads, but only a live session shows what an agent really sends. These checks need a person, an account or a real quota, so no test stands in for them. Each line goes when it is done; none is scored.

- **Codex and OpenCode:** one real L2 task in each, then `node "<skills-dir>/waymark/scripts/waymark.mjs" tasks` must show the agent, the Cierre and the choice window of that task.
- **Gemini CLI:** a session that gets a model reply, not only the hooks.
- **A handoff Claude → another agent:** stop a task when the quota ends, open it in another agent or account and check that the card shows the handoff (`.waymark/next-prompt.md`) and the task continues from it.
- **The first live session** of Cursor, Copilot CLI, Kiro, Antigravity, Qwen Code, Droid and Amp: the card arrives, a task is recorded with its agent, and the end-of-turn checks run.
- **A non-Anthropic model through OpenCode:** the same L2, to see the routine hold without Claude.
- **The update notice** on a real install: tried only against a local server; it must be seen once when a release reaches `main`.

## Install

Tell your agent:

> **Install Waymark from https://github.com/LiriRaid/waymark following its INSTALL.md**
>
> *(en español: "Instálame Waymark desde https://github.com/LiriRaid/waymark siguiendo su INSTALL.md")*

There is no installer script. [`INSTALL.md`](INSTALL.md) is written **for the agent**, and the agent runs it step by step:

1. Detects which agent it is and where that agent keeps skills and instructions ([`adapters/`](adapters)).
2. Clones the repo and backs up anything already installed.
3. Offers to remove the third-party skills this one replaces.
4. Copies the skills and creates your private layer `~/.waymark/`.
5. Writes a managed block of general working rules into each agent's instructions file (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`…). The rest of that file stays as it is.
6. Registers Waymark's hooks in each agent: settings for Claude Code, Codex and Gemini CLI, `hooks.json` for Cursor, a plugin for OpenCode, `hooks/waymark.json` for Copilot CLI and Kiro, and a `waymark` hook in Antigravity's `config/hooks.json`. In Claude Code it also sets Waymark's status line (`5h 41% · esta sesión ≈12% · 7d … · contexto …`).
7. Sets up engram, the learned memory every agent shares (installs it after your yes if it is missing), proposes MCP servers (`context7`; stack-specific ones only for stacks you use) and runs `sync.mjs`.
8. Lists every file it created or modified, asks you to restart, and gives you a smoke test.

It can configure every agent on the machine in one run (Claude Code, Codex, OpenCode, Gemini CLI, Cursor…); all of them share the same memory, so you can **start a task in one agent and continue it in another**: `.waymark/tasks.md` and the git notes say where the work stands, and engram what each task learned. Known agents are data (`skills/waymark/scripts/agents/agents.json`: Copilot CLI, Kiro and Antigravity with their hooks, and Windsurf, Qwen Code and others with the pointer, besides the five above). An agent Waymark does not know is detected by its home folder: it gets the pointer to `.waymark/tasks.md`, and writing its adapter is a procedure (`docs/adr/0022`). The task records are git notes, so they travel with the repo: in a repo with Waymark memory the session hook makes fetches bring them, and another machine sees what this one did (`docs/adr/0020`).

When a new version is published, `node "<skills-dir>/waymark/scripts/waymark.mjs" check` reports it (the session hook asks the agent to run it once a week) and the agent asks whether to update. **Update** without reinstalling: *"actualiza Waymark desde https://github.com/LiriRaid/waymark siguiendo su INSTALL.md"*. The agent compares `VERSION`, shows the [CHANGELOG](CHANGELOG.md), keeps what your skills learned and replaces the rest. The same sentence with "uninstall" removes it (`uninstall.mjs`). Node.js 18+ is required: the skill links, the hooks, the status line and every script run on it.

## Built to save tokens

Nothing is preloaded "just in case". Loading is layered:

<!-- size:begin (generated by `node skills/waymark/scripts/size.mjs --readme`; tests/docs.test.mjs checks it against the same command) -->
| Part | Loaded | What it is | Characters |
|---|---|---|---|
| instructions block | every session | instructions block in CLAUDE.md / AGENTS.md: levels, routing, the testigos, memory | 6,494 |
| skill descriptions | every session | Waymark's 17 skill descriptions, which the agent lists | 3,127 |
| reminder (full) | every prompt | the rule line of the per-prompt reminder (the task ID, stack and git line come on top) | 93 |
| reminder (short) | every prompt after a reply that followed the routine | the short reminder | 37 |
| protocol L2 | an L2 task | the protocol an L2 reads | 4,034 |
| protocol L3 | an L3 task | the protocol an L3 reads (L2 and L3 parts) | 6,131 |
| held message (max) | only after the context brake | the largest line the session hook adds for a held message | 637 |
<!-- size:end -->

Other parts, loaded when they apply: a department's `dept-*/SKILL.md` once per session per department (about 5 to 7 thousand characters), its `procedures.md` (the hook hands it over at the task's first change), the project card once per session (a few hundred characters here; it grows with the project's open work and learned memory), the core references and the stack and architecture profiles only in the situations they list. Project memory and its *Project map* replace re-exploring the project each session.

A small L1 task loads the block plus one department and one procedure. `node <skills-dir>/waymark/scripts/size.mjs` measures each of these for the project you run it in, including the lines the session hook may add after the card (`docs/adr/0024`). Memory (project map, verified gate commands, engram) avoids re-discovering the same things every session.

The bigger saving is not the size of each attempt but the **number of attempts**: a task costs *attempts × cost per attempt*. Waymark's fields (the ask and what each screenshot points at, evidence before the fix, reuse, verified APIs, the two-strike rule) aim at one attempt per task. Large tasks keep their plan as checkpoints in the project memory, so a context compaction does not make the agent guess what was done.

Token use with and without Waymark has not been measured yet (`tests/ab/ab.mjs`), so no saving is claimed.

Measured on real tasks ([`docs/audit-context.md`](docs/audit-context.md)), each model response re-reads the whole context (~58 k tokens in Claude Code), so the cost driver is the number of responses. The hooks do the routine's own steps instead of the agent: the git status comes with each prompt, each file's history at its first edit, a department loads once per session, and what was learned is saved at the close. A step the agent could forget is a step the hook does.

### MCP servers only where their framework is used

Your MCP servers stay registered where you put them. In each project, `scripts/mcp-fit.mjs` reads its manifests and blocks (a deny rule in that project's private `.claude/settings.local.json`, after your yes) the framework servers it does not use: no Angular CLI or PrimeNG in a React app or a docs repo, no React docs in an Angular app. When the project adopts the framework the rule is lifted. Docs and memory servers are never blocked. `node "<skills-dir>/waymark/scripts/waymark.mjs" check` reports it for the project it runs in.

### Skills you never use, and costly resumes

Each listed skill costs its description in every session. `scripts/skill-fit.mjs` finds the skills you added but have not invoked in 30 days and, after your yes, lists only their names (still invocable); unused plugins are disabled. Waymark's 17 descriptions went from 8,558 characters (1.x, `CHANGELOG.md`) to the figure in the table above. Resuming a large session after an hour idle re-writes its whole context (the cache expired), so a new task is cheaper in a new session. These are reported, not enforced: `node <skills-dir>/waymark/scripts/node "<skills-dir>/waymark/scripts/waymark.mjs" check` lists what is pending (a newer version, skills changed, MCP fit, skill fit, the migration, unconnected agents, a large idle session), and the session hook reminds the agent to run it once a week. The hooks themselves hold only the chain (`docs/adr/0008`).

### Evaluate a task

Say *"evalúa tu trabajo"* at the end of a task: the agent audits it with `references/evaluation.md` (versioned with Waymark), citing its own tool calls. A field it declared without a call behind it is reported as a false declaration.

### Measure it

```bash
node "$HOME/.agents/skills/waymark/scripts/measure.mjs" --turns 3-5
```

It reads the agent's own session transcript (offline, no model call) and shows, per prompt: the context it started with (its growth is what every later response re-reads), responses, tool calls, images, new vs cached input tokens, output and sub-agent tokens; the fixed context the session started with; and for a range of prompts (one task) the number of **attempts**.

`node "<skills-dir>/waymark/scripts/waymark.mjs" cost` does the same over your task records: per Waymark version and level, the tokens per task, how the cost splits between routine, work and reply (in cost units, each token weighted by its price ratio, next to raw tokens), the fixed context, the cost of a resume and the measured share of your 5-hour window. `bench/replay.mjs` replays the same recorded tasks under the injection of another version, so a change in what Waymark injects is shown on the same tasks; it does not replay the agent's behaviour. In the author's records, what Waymark injects is under 1 % of a task's cost and the routine responses are 8 to 13 % (`docs/adr/0031`).

A task that resembles an earlier one starts from it: at the first prompt of a task the hook searches the project's earlier tasks (the words of the ask and of what each learned, offline, no model) and hands over, in about 400 characters, the best match with its files, the gates it needed and its lesson, marked as earlier evidence to check; it hands nothing when nothing resembles the ask. `node "<skills-dir>/waymark/scripts/waymark.mjs" precedent --eval` replays that on your own history (the best three contain an earlier task on the same files 87 % of the time in the author's, against 66 % by chance; `docs/adr/0033`).

### Your quota, per terminal

In Claude Code with a Pro or Max plan, Waymark's status line reads the real % of the 5-hour window and measures each task's % from its first prompt to its close, with no question to you (`docs/adr/0019`). The window is your account's, so several sessions spend from the same %. Each rise is split among the open sessions by what each one spent, so every terminal shows its own part (`5h 41% · esta sesión ≈12% · tokens 5.9M`). The tokens are everything the session's tasks used, its subagents and cache included (the sum of their evaluations). The line refreshes every 30 s, so a quiet terminal also sees what the others spent. A task that shared the window closes with `medido, con otra sesión activa; esta sesión ≈ X%, prorrateado por costo`. The first reading Waymark sees with none before it (a new install), or of a new window read long after the last reset, is a baseline: what the window already held is no session's. Claude's desktop app shows no status line, but its hooks record what each of its sessions spends (from the transcript, at list price), so a rise is split with it too and a terminal shows only its own part. A rise while no Claude Code session spent (claude.ai, Codex, another machine) goes to none of them; while a session also spent, that session takes it. Elsewhere the % is estimated from your measured tasks of the same model.

## How it triggers

Three layers keep the agent on track, without an orchestrator: each skill's `description` (the trigger, with the phrases people actually type), the instructions block (Rule 0: every request runs recall → department → skills → verify → learn; questions run in read-only consult mode), and a tiny per-prompt **Rule 0 reminder hook** (`scripts/rule0-hook.mjs`, installed by default where the agent supports hooks). The hook runs locally and adds ~120 tokens per prompt (~60 once the previous reply followed the routine; the task ID and the git status stay). It stops a message only once, before the model, when resuming a very large or idle session would re-write its whole context (`docs/adr/0016`, `0018`); the end-of-turn hook stops a turn once when a routine step is missing. Every reply starts with `Waymark → L<n> · <dept>`, so you can see at a glance that the routine ran.

```
"quiero crear un modal"      → dept-frontend → brief → ui-build → gates → learn
"nuevo endpoint de pagos"    → dept-backend (+ dept-security, dept-qa)
"refactoriza a hexagonal"    → dept-architecture (L3: plan + ADR)
"cambia el color del botón"  → L0: done directly, no department
```

| Level | Example | What runs |
|---|---|---|
| L0 | a color, a text, a typo | nothing, done directly |
| L1 | bug in one known file | short Entry · department Quick ref · gates without build |
| L2 | new screen, endpoint, integration | full Entry · department rules and skills · gates + build + review |
| L3 | refactor, migration, new module | L2 + `dept-architecture` + plan before coding + ADR |

## What's inside

```
skills/
  waymark/        core: triage, Entry/Exit protocols, skill registry, learning loop
    SKILL.md (triage, departments, what to read when) · skill-map.json · skill-registry.md (generated)
    references/        protocol, project-detection, learning, skills (find / install / create), maintenance
    scripts/sync.mjs
    stacks/            angular, react, node, nestjs, rails, python, go, java, dotnet, rust, php, terraform, c, android, generic
    architectures/     screaming, feature-sliced, hexagonal, clean, layered, modular-monolith
    templates/         department, stack, architecture, tool skill, project skill, project memory,
                       instructions.md (block for CLAUDE.md / AGENTS.md), private-layer/
  dept-product  dept-architecture  dept-frontend  dept-ux-ui  dept-backend
  dept-data  dept-security  dept-qa  dept-devops  dept-devex          ← 10 departments (SKILL.md + procedures.md)
  ui-build  ui-refine  ui-system  ui-audit  browser-verify  library-docs   ← own tool skills
adapters/              per-agent paths and MCP registration
INSTALL.md             install / update / uninstall, written for the agent
scripts/export.mjs     copy your installed (improved) skills back into the repo
.claude-plugin/        optional Claude Code plugin manifest
```

### Departments

| Skill | Owns |
|---|---|
| `dept-product` | requirements, scope, acceptance criteria |
| `dept-architecture` | structure, layers, boundaries, patterns, ADRs |
| `dept-frontend` | UI code in any framework |
| `dept-ux-ui` | visual design, accessibility, motion, design system |
| `dept-backend` | APIs, services, jobs, realtime, integrations |
| `dept-data` | schema, migrations, queries, caching, client state |
| `dept-security` | authn/authz, secrets, OWASP, dependencies |
| `dept-qa` | tests, verification, review, Definition of Done |
| `dept-devops` | build, CI/CD, git, environments, deploy |
| `dept-devex` | agent tooling, Waymark, docs |

### Missing skills are created, not skipped

When a department needs a capability no installed skill provides, the agent installs a known one (asking first) or **creates a new skill** with its trigger description, registers it in `skill-map.json`, adds it to the department's Tools table and uses it. General skills go to the agent's skills folder; project-specific ones into the project.

### Third-party skills are used too

`sync.mjs` indexes every skill it can find, not only Waymark's: the agent's own folder, other agents' folders (`~/.cursor/skills`, `~/.codex/skills`, `~/.agents/skills`, Gemini, OpenCode), plugins and each project's `.claude/`, `.cursor/`, `.agents/`… `skills/`. Each one gets a department and a capability from its description and its path in `skill-registry.md`, so a department can read and follow it even when the agent did not load it. `node "<skills-dir>/waymark/scripts/waymark.mjs" check` reports new or removed skills, and `node "<skills-dir>/waymark/scripts/waymark.mjs" sync` refreshes the registry. The six community skills Waymark replaces are listed as *Replaced* and never used.

### Tool skills that grow

`ui-build`, `ui-refine`, `ui-system`, `ui-audit`, `browser-verify` and `library-docs` are original skills. Each one is owned by a department and starts with a precondition that loads that department first. They grow as you work through `patterns/`, `rules/`, `facts/` and `## Learned notes`.

`library-docs` routes documentation lookups to the right MCP server: `angular-cli` for Angular, `primeng` for PrimeNG and `context7` for everything else.

## It adapts to you

Nothing personal ships in this repository: no stack, no preferences, no projects. Your private layer `~/.waymark/` starts generic and fills itself as you work:

| File | Fills itself when… |
|---|---|
| `profile.md` | a project of a new stack, package manager or architecture is detected |
| `projects.md` (index) + `<project>/.waymark/memory.md` | you work in a project for the first time; it is the project manual (identity, map, gates, conventions), local and never committed. What each task learned goes to engram, saved by the end-of-turn hook on this machine and never committed (`docs/adr/0017`) |
| `preferences.md` | you correct how the agent answers or delivers code |
| `subagents.md` | a search or delegation rule proves wrong or missing |
| `agent.md` | the installer records where your agent keeps skills and instructions |
| `coexistence.md` | the installer finds another agent framework (see below) |

The same layer serves every agent, so switching from Claude Code to Codex keeps your memory. Memory has three layers (`docs/adr/0015`): git holds what was done (commits, trailers, notes), engram what was learned (written by the hooks, shared by every agent on the machine, never committed: `docs/adr/0017`), and `memory.md` the project manual.

### Living next to an orchestrator

Waymark is not an orchestrator: an orchestrator decides *who* does the work, Waymark gives the criteria and the memory the work is done with. So it adapts to whoever arrived first:

| On this machine | Waymark |
|---|---|
| no orchestrator | leads: Rule 0 block, the hooks in every agent, full routine |
| an orchestrator already installed | **guest**: no hooks, no block; its departments reach the orchestrator through the orchestrator's own skill registry, its memory through engram |
| Waymark first, an orchestrator later | keeps leading; the newcomer's rules are sorted into **adopted**, **fallback** (its skills back Waymark up) or **resolved**, and you are asked once whether Waymark should step down to guest |

You can always pick another mode and move any rule. The other framework's files are never edited (`~/.waymark/coexistence.md` holds the adaptation), and uninstalling Waymark leaves it exactly as it was.

## The learning loop

**What the hook learns by itself** (`docs/adr/0023`): at each close it writes into the project memory only what it observed:
- the *Quality gates* that passed after the last change (dated; a command already written is never replaced);
- the *Areas* each task touched;
- how many tasks repeated the same procedure.

The rest is **proposed**, once in the session card and in `node "<skills-dir>/waymark/scripts/waymark.mjs" check`, and written only after your yes:
- a repeated procedure → a **project skill** inside that project;
- an incident that keeps failing → a Learned rule of the owner department;
- a correction you made in two tasks → your `preferences.md`.

**What the agent learns:** after every L1+ task it keeps only what was **new and non-obvious**. The lesson goes in the Cierre's *Aprendido* (the hook saves it to engram and to the task's line in *Work in progress*), or in exactly one of these places:

| The lesson is about… | It goes to |
|---|---|
| this project | `<project>/.waymark/memory.md` |
| a stack | `stacks/<stack>.md` |
| a tool skill | its `## Learned notes` |
| a department, in any stack | its `## Learned rules` |
| unsure / seen once | `~/.waymark/learnings/dept-<dept>.md` (staging) |

When a list grows long, the agent folds it into the skill body, so the skills evolve.

## Decision records

Every design decision is written down in [`docs/adr`](docs/adr), numbered; an accepted one is never edited, it is superseded.

<!-- adr-index:begin (generated by skills/waymark/scripts/docs-gen.mjs --write; do not edit) -->
- [0001 · Provenance chain of the agent's work](docs/adr/0001-provenance-chain.md)
- [0002 · Waymark is a supply chain of the agent's work](docs/adr/0002-supply-chain-of-the-agents-work.md)
- [0003 · Strict decision gate, evidence from tool calls only](docs/adr/0003-strict-gate-and-tool-call-evidence.md)
- [0004 · Provenance generated by the hooks, not declared by the agent](docs/adr/0004-provenance-generated-by-the-hooks.md)
- [0005 · Three blocks, everything else recorded and scored](docs/adr/0005-three-blocks-and-automatic-evaluation.md)
- [0006 · One routine contract](docs/adr/0006-routine-contract.md)
- [0007 · Project memory lives in the project](docs/adr/0007-project-memory-in-the-project.md)
- [0008 · One agent-agnostic core, a thin adapter per agent, hooks only for the chain](docs/adr/0008-agent-agnostic-core.md)
- [0009 · Codex adapter: the rollout as core lines, decisions asked in chat, steps an agent lacks](docs/adr/0009-codex-adapter.md)
- [0010 · Every applicable step blocks once; the branch and the browser are the user's](docs/adr/0010-every-applicable-step-blocks.md)
- [0011 · The browser only on request, no secrets in the chain, and turns counted from the last close](docs/adr/0011-browser-on-request-and-no-secrets.md)
- [0012 · Testigos, one decision, git as the source of truth, and a fixed context card (step 3e)](docs/adr/0012-testigos-and-git-as-the-source.md)
- [0013 · Every agent in the chain, one memory, notes that travel](docs/adr/0013-every-agent-one-memory-portable-notes.md)
- [0014 · The final test across agents: notes that travel alone, one ID per commit, Recordar and review in every agent](docs/adr/0014-final-test-across-agents.md)
- [0015 · Three layers of memory, written by the hooks; fewer responses per task](docs/adr/0015-three-layers-of-memory.md)
- [0016 · Context brake, one project-skills folder, no-change tasks recorded](docs/adr/0016-context-brake-and-one-skills-folder.md)
- [0017 · The agents' folders stay local, one real copy per skill, fewer extra responses](docs/adr/0017-local-agent-folders-and-one-copy-per-skill.md)
- [0018 · Dead hooks reported, an idle brake, merges that keep the notes](docs/adr/0018-dead-hooks-idle-brake-and-merge-methods.md)
- [0019 · The quota % measured by the status line](docs/adr/0019-quota-measured-by-the-status-line.md)
- [0020 · Testigos without false ✔ or false ✘, and a memory chain that travels](docs/adr/0020-testigo-integrity-and-the-memory-chain.md)
- [0021 · Every agent on the machine with one install, Cursor included](docs/adr/0021-every-agent-and-cursor.md)
- [0022 · Agents as data, and the agents Waymark does not know](docs/adr/0022-agents-as-data-and-unknown-agents.md)
- [0023 · The project learns from its records: the hook writes what it observed, the rest is proposed](docs/adr/0023-the-project-learns-from-its-records.md)
- [0024 · The context Waymark costs: the protocol by level, a card that asks nothing, a size report that measures it all](docs/adr/0024-the-context-waymark-costs.md)
- [0025 · The log anchored in git, forget for the removals you ask for, and an Evidencia backed by a check](docs/adr/0025-anchored-log-forget-and-backed-evidence.md)
- [0026 · One classifier for what a command runs, and an open failure when the hook cannot tell](docs/adr/0026-one-run-classifier-and-open-failure.md)
- [0027 · Cost per link, review by risk, procedures by the hook, a chain anyone can verify](docs/adr/0027-cost-per-link-risk-review-verifiable-chain.md)
- [0028 · The scorecard: what "95 %" means, computed by checks](docs/adr/0028-scorecard.md)
- [0029 · A suite with nothing skipped, todo or failing, and a CI that runs it](docs/adr/0029-suite-with-nothing-skipped-and-ci.md)
- [0030 · Record schema v2: the fields the hooks derive](docs/adr/0030-record-schema-v2.md)
- [0031 · Cost per version and level, the replay bench, and the thresholds of criterion 8](docs/adr/0031-cost-per-version-replay-and-frozen-thresholds.md)
- [0032 · The token levers of 2.0.18: measured first, kept only if the measure says so](docs/adr/0032-token-levers-measured-before-kept.md)
- [0033 · Precedent: a similar task starts from the evidence of an earlier one](docs/adr/0033-precedent-a-similar-task-starts-from-an-earlier-one.md)
- [0034 · The anchor signed at the close, a signed attestation, and a key lifecycle](docs/adr/0034-signed-anchors-and-attestations.md)
- [0035 · The notes reach a remote without a manual step, and `verify --remote` checks the copy](docs/adr/0035-notes-reach-a-remote-and-verify-checks-it.md)
- [0036 · Inputs and dependencies pinned: the engram release, `skills.lock`, and no dependencies of our own](docs/adr/0036-inputs-and-dependencies-pinned.md)
- [0037 · The guard closes the gaps it can, and the end-of-turn detection backs it where it cannot](docs/adr/0037-guard-closes-gaps-and-detection-backs-it.md)
- [0038 · The ask kept as items and answered, options with their attributes, claims backed, redone work shown](docs/adr/0038-task-done-as-asked-and-decisions-the-user-can-judge.md)
- [0039 · Conformance across adapters, handoff between agents, adapters and stacks that draft themselves, and the reference bench](docs/adr/0039-conformance-handoff-generated-adapters-and-stacks-reference-bench.md)
- [0040 · Every hook runs through a launcher that finds a Node able to run it, and the update notice is tested](docs/adr/0040-hooks-through-a-launcher-and-the-update-notice-tested.md)
- [0041 · Qwen Code, Droid and Amp get an adapter, written from their documentation](docs/adr/0041-qwen-code-droid-and-amp-adapters.md)
- [0042 · The public repository holds no data of the projects Waymark runs on](docs/adr/0042-no-data-of-the-projects-waymark-runs-on.md)
- [0043 · A profile is a reference, never the project's rule](docs/adr/0043-a-profile-is-a-reference-never-the-projects-rule.md)
- [0044 · A record for the work, none for what is not work, and one task closed by the person who asked for it](docs/adr/0044-a-record-for-the-work-none-for-what-is-not-work.md)
- [0045 · A permission the user gives works, only the user can give it, and nothing read is saved](docs/adr/0045-a-permission-the-user-gives-works-and-nothing-read-is-saved.md)
- [0046 · Clean copies in a folder Waymark owns, and the safety of the user's environment](docs/adr/0046-clean-copies-in-a-folder-waymark-owns-and-the-users-environment.md)
- [0047 · The eyes: a seen change is looked at before it is done](docs/adr/0047-the-eyes-a-seen-change-is-looked-at-before-it-is-done.md)
- [0048 · A cut turn is not a failed task, and an agent that cannot carry the chain yet is coming soon](docs/adr/0048-a-cut-turn-is-not-a-failed-task-and-an-agent-that-cannot-yet-is-coming-soon.md)
- [0049 · The scorecard reads real use, and the records prepare clean data](docs/adr/0049-the-scorecard-reads-real-use-and-the-records-prepare-clean-data.md)
- [0050 · No task closes parcial, and the hooks do not repeat work](docs/adr/0050-no-task-closes-parcial-and-the-hooks-do-not-repeat-work.md)
<!-- adr-index:end -->

## Contributing back

Your installed skills get better as you use them. To publish those improvements:

```bash
node scripts/export.mjs "$HOME/.agents/skills" --strip-learned
git diff
```

`--strip-learned` drops personal learned entries; leave it off when the lessons are general. The private layer is never exported.

## Extend

- **Stack**: copy `templates/stack.template.md` → `stacks/<slug>.md`, add its detection signal to `waymark/SKILL.md` §6.
- **Architecture**: copy `templates/architecture.template.md`.
- **Department**: copy `templates/department.template.md` → `skills/dept-<name>/SKILL.md`, add it to the core table and to `sync.mjs`.
- **Agent**: every agent Waymark knows is one entry in [`skills/waymark/scripts/agents/agents.json`](skills/waymark/scripts/agents/agents.json) (folder, instructions file, skills folder, hooks, docs). An agent installed later, or one Waymark does not know (a hidden home folder with an instructions file, `skills/` or hooks), is reported by `node "<skills-dir>/waymark/scripts/waymark.mjs" check` and said once in the session card; it gets the pointer block first. Its hooks cost one module in `skills/waymark/scripts/agents/` from `templates/agent-adapter.template.mjs` (the exports of `claude.mjs`), its `adapter` in `agents.json` and `adapters/<agent>.md`: `dept-devex` procedures → *Add an agent* (`docs/adr/0022`).

## License

MIT. The tool skills are original work inspired by the approach of community skills; credits are in `skill-map.json` → `inspiredBy`. External skills you vendor later with `sync.mjs --vendor` keep their upstream license in `NOTICE.md`.
