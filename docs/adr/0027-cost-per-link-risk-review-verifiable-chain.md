# 0027 · Cost per link, review by risk, procedures by the hook, a chain anyone can verify

**Status:** accepted (2.0.16, built point by point; each point appends its section here)

## Context

Waymark is a supply chain of the agent's work (`0002`): inputs, stages, outputs, each with evidence the hooks compute, in a record chained by hash and anchored in git. Two things were missing: the cost of the routine was argued, not measured per step, and a chain could be checked only by a test, not by someone who was not there. The goals that govern the release: fewer tokens (measured), better ways of working, agnostic in the full sense (agent, stack, project, branch, area, field, technology, architecture), adaptive, learning over time, and a supply chain that covers 100% of the agent's work.

## Decisions

### 1. Cost per link (point 1)
The evaluation of each task keeps `links` (schema `v: 1`): the task's main-agent responses split into `routine` (a department, waymark, review or docs skill; a `waymark.mjs` subcommand; a read of a procedures file, the project's memory or the waymark references; the choice window), `reply` (a response with no tool call) and `work` (the rest), each with its response count and input, cache-write, cache-read and output tokens. A response with calls of several kinds counts as routine. Source: `turnLinks` in `transcript.mjs`. Measurements: `docs/audit-context.md` §3. Limit: a Read of a waymark reference counts as routine even in this repository, where those files are also the work.

### 2. Review proportional to risk (point 2)
See the amendment of `0010`. The review testigo applies at L2+ only for L3, a sensitive or critical path, more than 4 code files, more than 100 lines, or a size that cannot be counted (a shell command changed files). Everything else records `omitted.Review`. Limits and path lists are `risk` in `routine.json`; a project overrides them in `.waymark/risk.json`. Limit: that file lives in a folder the agent can edit, so an agent could loosen its own threshold; the record shows the override and point 8 guards it.

### 3. Procedures by the hook (point 3)
At the task's first change the pre-tool hook adds the owner department's whole `procedures.md` to the context, once per task and department, next to the file's `pack`. The delivery is stored with the packed state (`procs`) and the `procedure` testigo counts it as read and before the change. The whole file is handed, not a section: choosing a section from the request's words is a guess, and a wrong guess would pass the testigo falsely. Where the agent has no hook before the tool, or no transcript to name the owner, nothing is handed and the agent reads the file as before; the testigo then needs the read. Tests: `tests/false-fails.test.mjs` (delivery once, a delivery of another department does not count, nothing delivered and nothing read still blocks).

### 4. Skill descriptions (point 4)
The 17 descriptions went from 4,888 to 3,492 characters (`size.mjs`): the redundant "Waymark ·" prefix and the rules that the department's own file repeats were dropped; the Spanish trigger phrases the user says stay. The full session figure went from 13,029 to 11,494 characters. `skill-fit.mjs` needs 14 days of history and had 9, so routing is guarded by the routing tests only; re-run it when it has enough history.

### 5. What the hooks inject (point 5)
Measured by `size.mjs`: the per-prompt reminder from 475 to 251 characters (the rule line 279 to 99; the task line says `Cierre ID: new … ; follow-up (same files) …`; the git line shows a count and the first two file names; the stack line is unchanged), and the held message from 1,306 to 637. The user's own words are not lost to the cap: a held message longer than 520 characters is carried up to there plus a pointer, and the whole text stays in `.waymark/held-full.md`. The card (1,653) and the check pointer (250) are unchanged: point 1 shows no evidence yet that they are read and unused. The instructions block is 6,494 characters (cap 6,500) after point 2 changed one claim.
