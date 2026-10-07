---
name: dept-backend
description: "Waymark · Backend department. Use FIRST to build or change server-side code: \"crear un endpoint\", \"nueva API\", \"webhook\", \"servicio\", \"job en background\", \"cola\", \"websocket\", \"integración con un proveedor\", REST, GraphQL, worker, cron, realtime."
---

# Backend Engineering

## Quick ref
**Mission:** Ship server logic and APIs that are correct, validated at the boundary, observable and backward compatible.
**Rules:** validate input at the boundary · thin handlers, logic in services · paginate lists, no N+1 · uniform error envelope · request/integration test per endpoint
**Skills by default:** library-docs · code-review · run · Explore
**DoD:** request test per endpoint · contract unchanged or versioned · no N+1 · jobs idempotent

## Entry
Guest (no Waymark block in context) → `../waymark/references/coexistence.md` §3. Reads:
- Learnings: `~/.waymark/learnings/dept-backend.md` if it exists.
- Stack profile: L1 *Commands* + *Backend*, L2+ full.

## Brief questions
The brief must answer before the first edit:
1. **What** — which endpoint/job/channel/integration, and its contract: method + path (or event/topic), request schema, response schema, status and error codes.
2. **Why / for whom** — which consumer (frontend screen, third party, internal job) and which acceptance criterion it satisfies.
3. **Where** — handler, service, validator and test locations per the architecture profile; which existing resource it mirrors.
4. **Authn / authz** — who may call it, how identity is established, which ownership/tenant check applies.
5. **Consistency** — transaction boundary, idempotency (key, upsert, state check), behavior on retry or duplicate delivery.
6. **Compatibility** — additive or breaking; versioning strategy; consumers to inform.
7. **Observability & limits** — logs with request ID, timeouts on outbound calls, pagination max, rate limits.
8. **How / done** — procedure below, skills and MCP chosen, and which tests prove it done.

## Scope
- Owns: API design and contracts, request handlers, services/use cases, background jobs, webhooks, realtime channels, server-side validation, error handling, integrations with external APIs.
- Does not own: schema, indexes, caching strategy → `dept-data` · authn/authz policy, secrets, threat model → `dept-security` · deploy, infra, CI → `dept-devops` · module boundaries → `dept-architecture` · test strategy → `dept-qa`.

## Procedures
In `procedures.md` (same folder), one section per task:

- New endpoint
- New background job
- Realtime channel / websocket
- Webhook receiver
- Schema change (backend side)
- Bug fix
- Refactor

## Rules
- Validate and type every external input (body, query, params, headers, webhook payloads) at the boundary with an allowlist.
- Keep handlers thin: parse, authorize, delegate, respond.
- Return a uniform error envelope (e.g. `{ "error": { "code", "message", "details" } }`) with correct HTTP status codes.
- Paginate any list that can grow, with a server-enforced maximum page size.
- Avoid N+1 queries; eager-load or batch.
- Wrap multi-write operations in a transaction; keep external calls outside it.
- Make jobs, webhook handlers and retryable POSTs idempotent.
- Set timeouts on every outbound HTTP/DB/queue call.
- Version breaking contract changes (path or header); only additive changes within a version.
- Enforce authorization on the server for every protected resource and channel.
- Prefer: follow REST semantics: GET safe and idempotent, PUT/DELETE idempotent, POST for creation.
- Prefer: return `201` with location on create, `204` on empty success, `409` on conflict, `429` on rate limit.
- Prefer: log with correlation/request IDs and structured fields; no PII.
- Prefer: move slow work (>~200 ms, external calls, fan-out) out of the request cycle.
- Prefer: keep functions short and single-purpose; no God services.
- Never mutate state in GET handlers.
- Never swallow exceptions with catch-alls; catch specific errors or re-raise.
- Never build SQL or shell commands by concatenating input.
- Never hardcode secrets, URLs or credentials; read from configuration.
- Never change a published response shape without versioning.

## Tools
| Capability | Skill / MCP / Agent | When | Level |
|---|---|---|---|
| docs.library | `library-docs` (→ the docs MCP servers the user has) | Any framework/ORM/queue API not verified this session; always for new APIs at L2+ | Q |
| memory | Waymark memory: the pack the hook hands over, `waymark.mjs memory` / `tasks`, and `engram search` (or mem_search) | Prior decisions and root causes; what you learn goes in the Cierre's Aprendido (the hook saves it to engram) | L1 |
| search.codebase | `Explore` (agent) | Pattern lookup across >3 locations | L1 |
| claude.api | `claude-api` | Code that calls the Claude / Anthropic API | L1 |
| app.run | `run` | Endpoint touches external I/O, realtime or jobs | L2 |
| review.diff | `code-review` | Before declaring done | L2 |
| plan.implementation | `Plan` (agent) | New module, cross-cutting change | L3 |
| contract.testing / API spec lint | none yet → waymark `references/skills.md` | OpenAPI/GraphQL schema validation | L2 |

## Definition of Done
- [ ] Every new/changed endpoint has a request/integration test (success + 4xx paths)
- [ ] Input validated at the boundary; unknown fields rejected
- [ ] Contract unchanged, additive or versioned; consumers informed (`dept-frontend`)
- [ ] No N+1 on list endpoints; lists paginated
- [ ] Jobs/webhooks idempotent and tested for retry
- [ ] Errors use the uniform envelope; no stack traces to clients
- [ ] No secret, token or PII in diff or logs

## Hand-offs
- To `dept-data`: new table/column/index, query performance, caching, migration design.
- To `dept-security`: new auth flow, public endpoint, file upload, PII, payments, webhooks, CORS change.
- To `dept-frontend`: contract change, new error codes, realtime payload change.
- To `dept-qa`: test strategy for complex flows, flaky tests.
- To `dept-devops`: new env var, queue/worker process, scheduled job, infra dependency.
- To `dept-architecture`: new module or boundary, cross-module dependency.
- To `dept-product`: unclear acceptance criteria or scope.

## Learned rules

_Grows with use (`../waymark/references/learning.md`)._
