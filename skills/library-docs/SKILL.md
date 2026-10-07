---
name: library-docs
description: "Waymark tool (docs.library), any department. Use before code that relies on a library/framework API not verified this session, and for setup, config or migration: \"cómo se usa\", \"documentación de\", \"migrar a la versión\", \"sigue sin funcionar\". Docs MCP first, else official site."
---

# Library Docs

> **Precondition.** Tool of `waymark`, shared by every `dept-*` department. If no department skill is loaded in this conversation, load the owner of the task first and use its brief (what, why, where, how) as the input of this skill. Skip for L0 edits and for questions that do not depend on a library's behavior.

## Approach
Training data ages; libraries do not wait. Before code leans on an API, this skill pins down which version the project really runs and asks a source that speaks for that version.
- **Version first, question second.** The installed version decides the answer. A correct answer for the wrong major is a wrong answer.
- **Most authoritative source wins.** A framework's own MCP beats a general docs index; a docs index beats web search; web search beats memory. On the web, use the **official** site of the project (e.g. angular.dev, tailwindcss.com, docs.nestjs.com, supabase.com/docs, prisma.io/docs, postgresql.org/docs, react.dev) and its versioned pages; blogs, tutorials and Q&A sites only to locate the official page, never as the source.
- **One concept per question.** Narrow queries return focused, citable snippets; broad ones return noise.
- **Budget the lookups.** At most 3 docs calls per question. If three calls did not settle it, say what is still uncertain instead of guessing.
- **Nothing private leaves the machine.** Queries carry API names and symptoms, never keys, tokens, connection strings, customer data or proprietary code.
- **Remember only what surprised you.** Verified, non-obvious facts are saved per library and version so the next session does not pay for the same lookup.

### When to run
- Before writing or changing code that calls a library API not verified in this session.
- Setup, configuration, CLI flags, migration between versions, deprecations, breaking changes.
- An error message that points at library behavior (wrong signature, removed option, changed default).
- **Escalation — mandatory, even if the API "looks known":**
  - L2+/L3 tasks that rely on framework or platform features (rendering, routing, forms, styling system, ORM, auth, realtime, database features), before the first edit;
  - **after a failed attempt**, before trying again: re-read the official docs for the exact API and version instead of retrying variations;
  - **the user asks for the same thing again** or says it still does not work ("sigue sin funcionar", "otra vez", "no quedó"): stop, consult official docs, re-diagnose, and record the cause in project memory → *Gotchas* so it is not repeated.
- Skip it for general programming questions, business logic and code review that does not hinge on an API.

### Provider routing
Check the session's tool list (or `ToolSearch`) for the exact tool names before calling; servers rename tools between releases. A server listed as failed to connect counts as unavailable.

**Use the MCP servers this user actually has.** They are listed in `../waymark/skill-registry.md` → MCP sections (sync indexes every configured server) and in the session tool list. Never assume a server exists because another user or a stack profile mentions it.

| Library | First provider | Fallback |
|---|---|---|
| The framework or library has its **own docs MCP connected** (vendor or framework server) | that MCP — check its exact tool names in the session | general docs index |
| Any library | a **general docs-index MCP** the user has connected (e.g. `context7`) | official site |
| No docs MCP connected | the **official site**, versioned pages (web fetch or search scoped to it) | memory, labelled as unverified |

When the route falls back, say so in one line (for example: "framework MCP not connected; used the docs index + the official site").

### Guardrails
- **MUST** detect the installed version before the first query.
- **MUST** quote or paraphrase the docs that justify the code, with the version and the source.
- **MUST NOT** send secrets, environment values, personal data or large private code excerpts in a query.
- **MUST NOT** exceed 3 docs calls per question without telling the user why.
- **MUST NOT** present memory as documentation; when unverified, say so.

## Inputs
| Input | Source |
|---|---|
| Brief | the department brief: what code depends on which library API |
| Stack conventions | `../waymark/stacks/<stack>.md` → *Tools* (`docs.library` row) and *Official docs* |
| Project context | `<project>/.waymark/memory.md` → *Identity* (stack, versions), *Gotchas* |
| Known facts | `facts/<library>.md` in this skill (verified, version-scoped) |

## Output contract
Return to the department, in this shape:

```
Docs · <library> <installed version> · provider: <MCP name | web (official site) | memory (unverified)>
Answer: <one or two sentences>
Source: <tool + library id or doc page>
Applied to: <file:line or "answer only">
Fact saved: <facts/<library>.md | none (not novel) | proposed for stacks/<stack>.md>
Open risk: <anything still uncertain, or none>
```

## Pattern library (grows with use)
This skill grows facts instead of UI patterns:
- Before querying, read `facts/<library>.md` (format in `facts/README.md`).
- After a lookup confirmed something non-obvious (a renamed option, a changed default, a version-specific signature, a deprecated path that still compiles), run the novelty check (waymark `references/learning.md`: grep the fact in this file, the stack profile, project memory and `facts/`). Novel and verified → append it to `facts/<library>.md` with its version range and source.
- If the fact is really a convention of the stack (how the user's projects should use the library), propose it for `../waymark/stacks/<stack>.md` → *Conventions* instead of saving it here.
- A newer version that changes a fact → mark the old line as superseded with its version range; never silently rewrite it.

## Modes
Read **only** the mode the task needs (one file); never load all modes.

- **lookup** — an API, option, signature or behavior must be confirmed before coding. → `modes/lookup.md`
- **migrate** — upgrading a major or minor, removing a deprecation, adopting a new API across the code base. → `modes/migrate.md`
- **configure** — setting up or changing a library's configuration, provider wiring, CLI flags or build integration. → `modes/configure.md`

## Stack adapters
Stack-specific notes → `references/stack-adapters.md` (read only the project's stack row).

## Learned notes
_Grows with use (waymark `references/learning.md`). Dated, non-obvious notes about using this tool. When there are more than ~10, fold them into the body above and clear this list._
