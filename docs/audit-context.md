# Context and memory audit

Measured on 2026-10-06 against the landing project of the final test (`docs/adr/0014`). Re-run with `node skills/waymark/scripts/size.mjs` (what Waymark injects) and `node skills/waymark/scripts/measure.mjs` in the project (a real session). Tokens ≈ characters / 4.

## 1. What Waymark puts in the context

| When | Part | Chars | ≈Tokens |
|---|---|---|---|
| every session | instructions block | 6,487 | 1,622 |
| every session | context card | 2,238 | 560 |
| every prompt | reminder (full / short) | 669 / 241 | 167 / 60 |
| each department invoked | `dept-*/SKILL.md` | 5,374–7,557 | 1,344–1,889 |
| when read | a `procedures.md` section | ~500–1,500 | ~125–375 |

**Waymark's own text is about 4k tokens of a 51.1k-token starting context** in Claude Code. The rest is the agent's system prompt and its tools.

## 2. Where the tokens of a task really go

| Task | Agent | Tokens | Cached input | Responses | Tool calls |
|---|---|---|---|---|---|
| T1 counter red | Claude Code | 882.7k (79.9k of them in the code-review subagent) | 760.3k | 13 | 14 |
| T2 two commits | Claude Code | 524.2k | 510.2k | 7 | 6 |
| T3 FAQ group | Codex | 1,391k | 1,352k | — | 20 commands |
| T4 yearly saving | OpenCode | 1,158k | 1,026k | — | 12 commands |

**Cached input is 86–97% of every task.** Each model response re-reads the whole context, about 58k tokens in T1. So **the cost driver is the number of responses, not the size of the rules.** One response saved is worth about 58k tokens; trimming 1k characters of rules saves about 250 tokens per response.

These responses in T1 were the routine, not the work:
1. The department skill.
2. The procedure: two reads.
3. `pack`.
4. The choice window (it stays: the user decides).
5. code-review (it stays at L2, plus its subagent).
6. The end-of-turn block for Recordar: a whole extra cycle.

## 3. Text that reaches the model twice

The audit script compared every sentence of the block, the card, the reminder, the 10 departments, `waymark/SKILL.md`, `protocol.md` and three `procedures.md`. It found 46 rules repeated across sources: 11,320 characters beyond the first copy. Most of them never meet in one context, because only one or two departments load per task. These do meet:

| Repeated text | Where | Cost |
|---|---|---|
| The opener and the "user decides" rules | block + full reminder | ~417 chars on every prompt that gets the full reminder |
| Department boilerplate: Entry, Procedures, Tools header, Learned rules | all 10 `dept-*/SKILL.md` | ~550 chars per department loaded |
| The department skill again on every new task in the same session | `dept-*/SKILL.md` | 1.3–1.9k tokens plus one response per task. The routing testigo accepts a department invoked earlier in the session, but the block asks for it as the first tool call of every task. |
| "Never offer browser verification" | block + `protocol.md` + 3 departments | small; kept where each rule acts |
| `engram` rows ("mem_save after a decision") | 7 departments, `learning.md`, `consult.md` | they contradict the memory design below; an agent without engram (OpenCode) cannot follow them |

## 4. Memory today: seven places

| Store | Holds | Written by | Read by | Travels |
|---|---|---|---|---|
| git commits + trailer | the change and its task ID | the agent | everyone | yes |
| git notes `refs/notes/waymark` | the task's whole record | the end-of-turn hook | `pack`, `tasks`, the card | yes, when pushed |
| `.waymark/provenance.jsonl` | the chained stubs; whole records of uncommitted tasks | the hook | the hooks | no (gitignored) |
| `.waymark/memory.md` | Identity, map, gates, conventions, **Solved problems, Gotchas, Decisions**, Work in progress | the agent and the hook | the card, `memory` | no |
| `.waymark/tasks.md`, `open.json`, `history.md` | generated views and open turns | the hooks | every agent | no |
| `~/.waymark/` (profile, preferences, learnings) | the user and each department's lessons | the agent | the departments | no |
| engram | whatever an agent decided to `mem_save` | the agent, when it remembers | Claude Code and Codex only | no |

**The same knowledge lands in three places.** A lesson or decision can sit in memory.md (*Solved problems*, *Gotchas*, *Decisions*), in engram and in an ADR. Which of them gets it depends on the agent. engram is reached only by agents with its MCP server, and nothing writes it reliably.

## 5. Decided (2026-10-06 · T3, the user's picks)

- **Three layers.** git holds the truth of the work. engram holds what was learned; the hook writes it with the `engram` CLI and `engram sync` carries it in `.engram/` in the repo. `.waymark/memory.md` is the short project manual. Departments stop asking for `mem_save`. → ADR 0015.
- **engram everywhere.** Update it to 3.1.0 (backup first) and `engram setup opencode`.
- **Pending tasks close themselves**, in two ways:
  - **By record:** a follow-up that ends `hecho` closes its ▶, and a later task that passes a testigo clears that "sin resolver".
  - **By time:** a turn that never closed is marked *interrumpido* at the next session.
- **Recordar by the hook:** it hands the agent `pack` before its first edit, wherever the agent's pre-tool hook can add context.

## 6. Cuts proposed from this audit (for the user to pick)

| # | Cut | Saves per task (estimate) |
|---|---|---|
| C1 | Departments are invoked once per session. Later tasks route with the line, and the block says so. | 1 response (~58k) + 1.3–1.9k tokens |
| C2 | The per-prompt hook already takes a `git status` snapshot, so it adds the one-line status to the reminder. The agent no longer runs it. | 1 response (~58k) |
| C3 | The full reminder no longer repeats the block's opener rules: it keeps the task ID and what changed since the last reply. | ~100 tokens per prompt |
| C4 | The department boilerplate (Entry, Procedures, Learned rules header) moves once into the block. Each department keeps only its own rules. | ~140 tokens per department loaded |
| C5 | Recordar and the engram save are done by the hooks (decided above), so they are never a block and never an extra cycle. | 1–2 responses when they used to fail (~58–116k) |

## 3. Cost per link (2.0.16, point 1)

The automatic evaluation now stores `links` (schema `v: 1`) next to `usage`: each main-agent response of the task goes to **routine** (a department, waymark, review or docs skill; a `waymark.mjs` command; a read of a procedures file, the project's memory or the waymark references; the choice window), **reply** (no tool call: the Cierre) or **work** (everything else), with its responses and its input, cache-write, cache-read and output tokens. Subagent tokens stay in `usage.subagents`. Source: `turnLinks` in `skills/waymark/scripts/transcript.mjs`, test in `tests/hooks.test.mjs` ("cost per link").

Measured on the last turn of six sessions of this repository on 2026-10-15 (new = input + cache write + output; read = cache read):

| Session | Routine | Work | Reply |
|---|---|---|---|
| c182606a (this one, point 0 and 1) | 5 r · 41k new · 459k read | 15 r · 40k new · 1,622k read | 0 r |
| d152d068 | 2 r · 2k · 743k | 1 r · 2k · 373k | 1 r · 2k · 373k |
| d3832f40 | 3 r · 14k · 553k | 1 r · 11k · 190k | 1 r · 9k · 193k |
| d93063a6 | 2 r · 13k · 414k | 6 r · 26k · 1,303k | 1 r · 2k · 228k |
| ef326e8c | 8 r · 26k · 1,747k | 43 r · 147k · 9,722k | 8 r · 266k · 1,879k |
| f317ef1c | 1 r · 3k · 292k | 18 r · 80k · 4,979k | 1 r · 1k · 302k |

Reading: the routine is 1 to 8 responses per turn and 5% to 30% of the cache reads; in the long turns the work dominates. The numbers are one turn per session, not a benchmark: points 2 to 5 are judged by re-measuring with the same function.
