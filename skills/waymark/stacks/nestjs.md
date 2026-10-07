# Stack: NestJS

## Detect
Signals the agent checks (waymark `references/project-detection.md`): `@nestjs/core` in `dependencies` of `package.json`, or `nest-cli.json` at the project root. Also read: `@nestjs/testing`, `class-validator`, `zod` / `nestjs-zod`, `@prisma/client` / `prisma`, `typeorm`, `@nestjs/typeorm`, `@nestjs/websockets`, `@nestjs/bullmq`, `jest`, `vitest`, `supertest`.

## Commands
Default commands the agent runs in the Exit protocol; verify each once, then record it in project memory. `<pm>` = package manager from the lockfile. Owner rule: NestJS projects use pnpm, even if no lockfile exists yet.

| Gate | Command | Notes |
|---|---|---|
| typecheck | `<pm> run typecheck` if script `typecheck` exists; else if `tsconfig.app.json` exists `<pm> exec tsc --noEmit -p tsconfig.app.json`; else if `tsconfig.json` exists `<pm> exec tsc --noEmit` | Standard Nest apps hit the `tsconfig.json` branch. Monorepo apps may have `tsconfig.app.json` per app. |
| lint | if `eslint` in dependencies: `<pm> exec eslint {files}`; else `<pm> run lint` if script exists | Changed files only. The default Nest `lint` script uses `--fix` over `src/` and `test/`; do not use it as a gate. |
| test | `<pm> run test` with `CI=true` if script `test` exists | Unit tests, non-watch (the Nest `test` script is `jest`, which does not watch). E2E runs separately via `test:e2e`; record it in project memory when a database is available. |
| build | `<pm> run build` if script exists | Runs `nest build`. |
| format | `<pm> exec prettier --check {files}` | Not a gate. |

Project memory example (Quality gates, verified commands):

| Gate | Command | Verified |
|---|---|---|
| typecheck | `pnpm exec tsc --noEmit` | <date> |
| lint (changed files) | `pnpm exec eslint {files}` | <date> |
| test (full) | `pnpm run test` | <date> |
| build | `pnpm run build` | <date> |

If e2e tests need a database or Redis, keep them out of the default gate (they hang or fail without services); run them manually or in CI, and say so in the closing report.

## Conventions by department
Only what is specific to NestJS. General rules live in the `dept-*` department skills (`dept-backend`, `dept-data`, `dept-security`, `dept-qa`).

### Backend
- Modules with clear boundaries: `<domain>/<domain>.module.ts`, `.controller.ts`, `.service.ts`, `dto/`, `entities/`. A module exports only what other modules need. No circular module imports (`forwardRef` is a smell, not a fix).
- Dependency injection through constructors with `readonly` private parameters; depend on abstractions (tokens, interfaces) at real boundaries only. Providers are singletons by default; request-scoped providers have a performance cost, use them deliberately.
- Thin controllers: route, validate, delegate. Business logic in services; persistence in repositories or the ORM client wrapped by a service.
- DTOs validate every input at the boundary. Enable a global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` when using `class-validator` / `class-transformer`, or the zod equivalent (`nestjs-zod`, `ZodValidationPipe`). Do not mix both styles in one project.
- Separate input DTOs from response shapes; never return ORM entities that contain secrets (password hashes, tokens). Use serializers, `ClassSerializerInterceptor`, or explicit mappers.
- Cross-cutting: guards for authentication and authorization, interceptors for logging, mapping, caching and timeouts, pipes for validation and transformation, exception filters for uniform errors.
- API: REST under a version prefix (`/api/v1/`); uniform error body `{ error: { code, message, details } }`; correct HTTP status codes; pagination on any list that can grow.
- Configuration through `@nestjs/config` with schema validation at boot (zod or Joi); no `process.env` reads scattered through services.
- Realtime and queues (if present): WebSocket gateways authorize in the handshake; heavy work goes to BullMQ jobs, not inside the request or gateway handler.
- Use the built-in `Logger`; no `console.log`.

### Testing
- Jest is the Nest default; Vitest (with `unplugin-swc` for decorator metadata) is acceptable when the project already uses it. Keep the project's runner.
- Unit tests: `Test.createTestingModule` with the provider under test and mocked collaborators (`useValue` or `jest.fn`). Do not mock the class under test.
- E2E tests: `supertest` against `app.getHttpServer()`, bootstrapped with the same global pipes, filters, and prefix as `main.ts` (extract a shared `configureApp(app)` if it is not already shared). Use a dedicated test database or Testcontainers; reset state between tests.
- Every bug fix gets a regression test. Test guards and pipes directly, not only through controllers.

### Data & state
- Prisma: schema in `prisma/schema.prisma`; schema changes go through `prisma migrate dev` (never edit applied migrations; migrations are immutable after merge). Never hand-write migration SQL: generate it with `prisma migrate dev --create-only` (writes the migration without applying it) or `prisma migrate diff --from-<state> --to-schema prisma/schema.prisma --script` (no data touched; Prisma ≤ 6 names it `--to-schema-datamodel`; check the installed version). Applying a migration to a real database needs the user's yes. Regenerate the client after changes; wrap `PrismaClient` in a `PrismaService` with `onModuleInit` and shutdown hooks. Select only needed fields; avoid N+1 by using `include` / `select` deliberately.
- TypeORM: migrations over `synchronize: true` (never in production); repositories injected via `TypeOrmModule.forFeature`; explicit relations loading.
- Tables and columns `snake_case` (use `@map` / `@@map` in Prisma). Indexes on foreign keys and queried fields. Multi-step writes in transactions. If Supabase PostgreSQL is used, enable RLS on user-data tables.

### Security
- Authentication via guards (JWT with `@nestjs/jwt` / Passport); authorization checked per route or per resource, never assumed from the frontend. Secrets only through config, never in code or logs.
- `helmet`, explicit CORS origins (no wildcard in production), rate limiting (`@nestjs/throttler`), body size limits.
- Never log tokens, passwords, or PII. Return generic messages to clients; stack traces stay server-side.
- Parameterized queries only; `$queryRaw` with tagged templates, never string concatenation. Run `<pm> audit --audit-level=moderate` before releases.

## Tools
| Capability | Provider | Type |
|---|---|---|
| `docs.library` | `context7` (NestJS, Prisma, TypeORM, class-validator, BullMQ, Supabase) | MCP |
| `app.run` | `run` | Skill |
| `review.security` | `security-review` | Skill |
| `review.diff` | `code-review` | Skill |
| `claude.api` | `claude-api` (only if the service calls the Anthropic API) | Skill |

No stack-specific MCP is assumed.

## Architecture fit
- `layered` / modular (Nest default): `src/<domain>/` per bounded context, `src/common/` for filters, pipes, guards, decorators shared across domains, `src/config/`. Modules must not reach into another module's internals; go through exported services.
- `screaming`: domain folder names at the top of `src/`, as above. For hexagonal variants, keep ports (interfaces and tokens) in the domain and adapters (Prisma, HTTP clients) in infrastructure.

## Anti-patterns
- Business logic in controllers; ORM entities returned straight to clients.
- Missing or non-global `ValidationPipe`; `whitelist` off; trusting `req.body` types.
- `synchronize: true` outside local dev; editing merged migrations.
- N+1 queries; unbounded list endpoints; heavy synchronous work in the request cycle.
- Circular dependencies hidden with `forwardRef`; `@Global()` modules used to avoid declaring imports.
- Catch blocks that swallow errors; `console.log`; `process.env` read in services.
- E2E tests that bootstrap the app differently from `main.ts`.
- Wildcard CORS in production; endpoints without authorization.

## Official docs
- https://docs.nestjs.com
- https://docs.nestjs.com/techniques/validation
- https://docs.nestjs.com/fundamentals/testing
- https://docs.nestjs.com/security/authentication
- https://www.prisma.io/docs
- https://zod.dev
- https://jestjs.io/docs/getting-started
- https://owasp.org/API-Security/editions/2023/en/0x11-t10/
