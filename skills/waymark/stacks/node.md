# Stack: Node / TypeScript (generic) and JS fallback

## Detect
Signals the agent checks (waymark `references/project-detection.md`): a `package.json` at the project root with none of the more specific signals (`@angular/core`, `react`, `@nestjs/core`). This profile covers:
- Backends: Express, Fastify, Hono, Koa.
- Libraries and CLIs published to npm (`bin`, `exports`, `main` fields).
- Fallback for other JS frameworks: Vue (`vue`, Nuxt), Svelte (`svelte`, SvelteKit), Solid, Astro, Remix.
Further signals: `tsconfig.json`, `vitest` / `jest` / `node:test`, `eslint`, `tsup` / `tsdown` / `unbuild`, `.nvmrc` / `engines.node`.

## Commands
Default commands the agent runs in the Exit protocol; verify each once, then record it in project memory. `<pm>` = package manager from the lockfile (`pnpm-lock.yaml` pnpm, `yarn.lock` yarn, `bun.lock`/`bun.lockb` bun, `package-lock.json` npm).

| Gate | Command | Notes |
|---|---|---|
| typecheck | `<pm> run typecheck` if script `typecheck` exists; else if `tsconfig.app.json` exists `<pm> exec tsc --noEmit -p tsconfig.app.json`; else if `tsconfig.json` exists `<pm> exec tsc --noEmit` | Whole project: once at the end, after the last change, not after every edit (a whole-project run on a real API took 9 min, a later one 6 s). Add `--incremental` when the project allows it. Plain JS projects have no typecheck gate; do not add one. SvelteKit/Vue projects usually ship `svelte-check` / `vue-tsc` scripts: expose them as a `typecheck` script. |
| lint | if `eslint` in dependencies: `<pm> exec eslint {files}`; else `<pm> run lint` if script exists | Changed files only. Biome or oxlint projects have no `eslint` dependency, so the `lint` script is used. |
| test (scoped, while working) | Vitest: `<pm> exec vitest related {files} --run`; Jest: `<pm> exec jest --findRelatedTests {files}`; else the spec files by path | Only the tests that import the changed files: seconds instead of the whole suite. |
| test | `<pm> run test` with `CI=true` if script `test` exists | Full suite, once at the end (L2+). Non-watch. Watch-by-default runners (`vitest` bare) need `vitest run` in the script or in project memory. |
| build | `<pm> run build` if script exists | Libraries: confirm `dist/` types and exports resolve. |
| format | `<pm> exec prettier --check {files}` (or `biome check`) | Not a gate. |

Project memory example (Quality gates, verified commands):

| Gate | Command | Verified |
|---|---|---|
| typecheck | `pnpm exec tsc --noEmit` | <date> |
| lint (changed files) | `pnpm exec eslint {files}` | <date> |
| test (full) | `pnpm exec vitest run` | <date> |
| build | `pnpm run build` | <date> |

For Vue/Svelte/Astro fallback, typical typecheck commands: `pnpm exec vue-tsc --noEmit`, `pnpm exec svelte-check --tsconfig ./tsconfig.json`, or `pnpm exec astro check`. For `node:test` projects, test is `node --test`.

## Conventions by department
Only what is specific to Node/TypeScript. General rules live in the `dept-*` department skills (`dept-frontend`, `dept-backend`, `dept-security`, `dept-qa`).

### Backend / Library
- TypeScript `strict: true`. No `any`; use `unknown` and narrow. Model the domain with types; avoid casts.
- ESM vs CJS: follow the project's `"type"` field and `exports` map. In ESM, relative imports need explicit extensions when `moduleResolution` is `node16`/`nodenext`. Do not mix `require` into ESM files.
- Use the Node version in `.nvmrc` / `engines`. Prefer built-ins (`node:fs/promises`, `node:test`, `fetch`, `AbortController`) over new dependencies. Import built-ins with the `node:` prefix.
- Async code: always await or return promises; handle rejections; no floating promises (enable `@typescript-eslint/no-floating-promises`). Use `AbortSignal` for cancellable I/O and timeouts on outbound calls.
- Validate all external input (HTTP bodies, env vars, files, CLI args) with a schema library (zod, valibot, TypeBox, or Fastify's JSON Schema). Parse env once at startup into a typed config object; do not read `process.env` throughout the code.
- Express: centralize error handling middleware with 4 arguments; wrap async handlers (or use Express 5). Fastify: register plugins, use schemas for validation and serialization, encapsulate by plugin. Keep route handlers thin and logic in plain modules testable without a server.
- Structured logging (pino) with levels; no `console.log` in library code. Graceful shutdown on `SIGTERM` / `SIGINT` closes servers and connections.
- CLIs: set `bin` and a shebang, exit with non-zero codes on failure, write errors to stderr, support `--help`. Keep stdout machine-readable when the tool is meant for piping.
- Libraries: minimal public API, semantic versioning, `exports` map with types, `files` allowlist, no side effects at import time (`sideEffects: false` when true), declare peer dependencies correctly.

### Testing
- Match the existing runner: Vitest (preferred for new TS projects), Jest, or `node:test`. Co-locate unit specs (`*.test.ts` / `*.spec.ts`); integration tests may live in `test/`.
- Test behavior through the public API. Mock only true boundaries (network, clock, filesystem); prefer in-memory fakes. For HTTP servers use `supertest` or the framework's inject (`fastify.inject`).
- Deterministic tests: fake timers for time, no reliance on ordering or on external services. TDD for logic; every bug fix gets a regression test.
- Vue/Svelte fallback: use the framework's Testing Library package (`@testing-library/vue`, `@testing-library/svelte`) and query by role; the browser (`test.browser`) only when the user asks.

### Data & state
- Database access through one layer (Prisma, Drizzle, Kysely, or a driver wrapper). Parameterized queries only. Migrations immutable after merge. Timeouts and pool limits set explicitly. Cache keys prefixed, with TTLs and invalidation.
- Vue/Svelte fallback: use the framework's native reactivity (Vue refs/computed, Svelte runes or stores) before adding a state library; do not mutate props.

### Security
- No secrets in code or logs; `.env` is git-ignored with a committed `.env.example`. Run `<pm> audit --audit-level=moderate` before releases. Review install scripts before approving builds (`pnpm approve-builds`).
- Set security headers (`helmet` or equivalent), explicit CORS origins, rate limits, request size limits. Never build shell commands or SQL by string concatenation; use `execFile` with argument arrays. Avoid `eval` and `new Function`. Guard against prototype pollution and path traversal on user-supplied keys and paths.

## Tools
| Capability | Provider | Type |
|---|---|---|
| `docs.library` | `context7` (Express, Fastify, Vite, Vitest, Vue, Svelte, Astro, Drizzle, zod) | MCP |
| `app.run` | `run` | Skill |
| `test.browser` | `browser-verify` (only for UI frameworks) | Skill |
| `ui.build` | `ui-build` (only for Vue/Svelte/Astro UI work) | Skill |
| `review.security` | `security-review` | Skill |
| `review.diff` | `code-review` | Skill |

No stack-specific MCP is assumed.

## Architecture fit
- Services: `src/<domain>/` with routes, service, and repository per domain (`layered` or `screaming`); shared infrastructure in `src/lib/` or `src/infra/`. Entry point only wires dependencies.
- Libraries: `src/index.ts` as the single public surface; internals unexported.
- CLIs: `src/cli.ts` (argument parsing) separate from `src/commands/*` (logic), so logic is testable without spawning a process.
- Meta-frameworks (Nuxt, SvelteKit, Astro): respect their file-based routing and conventions over the profiles above.

## Anti-patterns
- Unvalidated `req.body` / `process.env` / `JSON.parse` results trusted as typed.
- Floating promises; unhandled rejections; missing timeouts on network calls.
- Blocking the event loop with sync I/O or heavy CPU in request handlers.
- `console.log` as logging; swallowing errors in empty `catch`.
- Adding a dependency for something Node ships natively.
- Mixing CJS and ESM; deep imports of other packages' internals.
- Tests that depend on network, wall-clock time, or execution order.
- Running a non-detected package manager (e.g. `npm install` in a pnpm repo).

## Official docs
- https://nodejs.org/docs/latest/api/
- https://nodejs.org/api/test.html
- https://www.typescriptlang.org/docs/
- https://expressjs.com
- https://fastify.dev/docs/latest/
- https://vitest.dev/guide/
- https://eslint.org/docs/latest/
- https://zod.dev
- https://github.com/pinojs/pino
- https://nodejs.org/en/learn/getting-started/security-best-practices
- https://docs.npmjs.com/cli/configuring-npm/package-json
