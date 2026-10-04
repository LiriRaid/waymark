# Stack: React (Next.js App Router, Vite)

## Detect
Signals the agent checks (waymark `references/project-detection.md`): `react` in `dependencies` of `package.json`. Sub-flavor from further signals: `next` or `next.config.*` means Next.js; `vite` or `vite.config.*` means Vite SPA; `react-native` / `expo` means mobile (out of scope, use `generic`). Also read: `@testing-library/react`, `vitest`, `jest`, `eslint`, `typescript`, `tailwindcss`.

## Commands
Default commands the agent runs in the Exit protocol; verify each once, then record it in project memory. `<pm>` = package manager from the lockfile (pnpm, yarn, npm, bun).

| Gate | Command | Notes |
|---|---|---|
| typecheck | `<pm> run typecheck` if script `typecheck` exists; else if `tsconfig.app.json` exists `<pm> exec tsc --noEmit -p tsconfig.app.json`; else if `tsconfig.json` exists `<pm> exec tsc --noEmit` | Vite templates use `tsconfig.app.json` (project references); Next.js uses plain `tsconfig.json`. `next build` also typechecks. |
| lint | if `eslint` in dependencies: `<pm> exec eslint {files}`; else `<pm> run lint` if script exists | Changed files only. Newer Next.js removed `next lint`; use ESLint directly. |
| test | `<pm> run test` with `CI=true` if script `test` exists | Non-watch. Vitest runs once when `CI` is set; Jest does not watch under `CI`. If the script is `vitest` alone and watch persists, record `vitest run` in project memory. |
| build | `<pm> run build` if script exists | `next build` or `vite build`. For Next.js it also lints and typechecks per config. |
| format | `<pm> exec prettier --check {files}` | Not a gate. |

Project memory example (Quality gates, verified commands):

| Gate | Command | Verified |
|---|---|---|
| typecheck | `pnpm exec tsc --noEmit` | <date> |
| lint (changed files) | `pnpm exec eslint {files}` | <date> |
| test (full) | `pnpm exec vitest run` | <date> |
| build | `pnpm run build` | <date> |

## Conventions by department
Only what is specific to React. General rules live in the `dept-*` department skills (`dept-frontend`, `dept-ux-ui`, `dept-qa`, `dept-security`).

### Frontend
- Function components and hooks only. No class components in new code (error boundaries are the one exception unless `react-error-boundary` is used).
- Follow the Rules of Hooks; keep `eslint-plugin-react-hooks` on. Do not silence `exhaustive-deps`; fix the dependency or restructure.
- Derive values during render instead of syncing state in `useEffect`. Effects are for synchronizing with external systems only (subscriptions, DOM APIs, network not handled by a data library).
- If the React Compiler is enabled (React 19, `babel-plugin-react-compiler`), do not add `useMemo` / `useCallback` / `React.memo` by reflex. Without it, memoize only where profiling or referential stability requires.
- Lists need stable `key` values (ids, never array index for reorderable data).
- Controlled vs uncontrolled inputs: pick one per field. For forms prefer the project's library (React Hook Form, TanStack Form) or React 19 form actions (`useActionState`, `useFormStatus`).
- Accessibility: semantic elements first, labelled controls, keyboard support, visible focus.

#### Next.js (App Router)
- Server Components by default. Add `"use client"` only at the smallest leaf that needs state, effects, or browser APIs. Never import server-only modules (db clients, secrets) into client components; mark them with `import "server-only"`.
- Data fetching in Server Components or route handlers; mutations via Server Actions or route handlers. Validate every Server Action input on the server (zod) and re-check authorization inside it.
- Understand the caching layers (fetch cache, Full Route Cache, router cache) for the installed major version before relying on them; check the docs via `context7` because defaults changed between 14, 15 and 16.
- Use `next/image`, `next/font`, `next/link`, `metadata` / `generateMetadata`. Route-level `loading.tsx`, `error.tsx`, `not-found.tsx`.
- Environment variables: only `NEXT_PUBLIC_*` reach the browser. Never put secrets there.

#### Vite SPA
- Env via `import.meta.env` and `VITE_` prefix only for public values. Code-split routes with `lazy()` and `Suspense`. Routing via React Router or TanStack Router, whichever the project already uses.

### Testing
- Vitest (Vite and modern Next.js) or Jest (older or `next/jest`), plus Testing Library (`@testing-library/react`, `user-event`, `jest-dom`).
- Query by role and accessible name (`getByRole`), not by test id or class. Use `userEvent` not `fireEvent`. Prefer `findBy` / `waitFor` over arbitrary timeouts.
- Mock the network (MSW) rather than component internals. Do not assert on implementation details such as state values or hook calls.
- Async Server Components are not unit-testable with Testing Library; test the extracted logic (e2e with Playwright only when the user asks).
- TDD for logic; regression test for every bug fix. UI changes: specs and the build; the browser (`test.browser`, `app.run`) only when the user asks.

### Data & state
- Server state in TanStack Query / SWR / Server Components, not copied into global client stores. Local state with `useState` / `useReducer`; lift only as needed; context for low-frequency values. Global client state (Zustand, Redux Toolkit) only when the project already uses it.
- Never mutate state objects; return new references. Type API payloads with zod schemas and infer types from them where zod is present.

### Security
- Never use `dangerouslySetInnerHTML` with unsanitized input. Do not store tokens in `localStorage`; prefer HttpOnly cookies. Authorize on the server for every action and route handler, not only in UI. Keep secrets out of client bundles.

## Tools
| Capability | Provider | Type |
|---|---|---|
| `docs.library` | `context7` (React, Next.js, TanStack, Vite, Testing Library) | MCP |
| `ui.build` | `ui-build` | Skill |
| `ui.system` | `ui-system` (covers React, Next.js, shadcn/ui) | Skill |
| `ui.audit` | `ui-audit` | Skill |
| `test.browser` | `browser-verify` | Skill |
| `app.run` | `run` | Skill |

No stack-specific MCP is assumed. If the project uses shadcn/ui and a shadcn MCP is present in the session, it may be used for component lookup.

## Architecture fit
- Next.js: `app/` routes as the composition layer; feature folders (`features/<feature>/{components,hooks,server,schemas}`) under `src/`, `components/ui` for shared primitives, `lib/` for infrastructure. Compatible with the `screaming` architecture profile.
- Vite SPA: `src/features/<feature>`, `src/shared`, `src/app` (router, providers). Same dependency rule: features do not import other features; shared does not import features.
- Respect the project's existing structure if it differs (Bulletproof React, FSD).

## Anti-patterns
- `useEffect` to derive state or to fetch when the framework or a data library provides it.
- `"use client"` at the top of a whole page or layout without need.
- Index as `key` on dynamic lists; missing or fake dependency arrays.
- Prop drilling through five levels where composition or context fits, and the opposite: context for fast-changing values.
- Testing implementation details; snapshot tests of large trees.
- Importing server-only code in client components; secrets in `NEXT_PUBLIC_*`.
- Disabling ESLint rules file-wide to pass the gate.

## Official docs
- https://react.dev/learn
- https://react.dev/reference/react
- https://react.dev/learn/you-might-not-need-an-effect
- https://nextjs.org/docs/app
- https://nextjs.org/docs/app/building-your-application/rendering/server-components
- https://vite.dev/guide/
- https://vitest.dev/guide/
- https://jestjs.io/docs/getting-started
- https://testing-library.com/docs/react-testing-library/intro/
- https://tanstack.com/query/latest
- https://eslint.org/docs/latest/
- https://playwright.dev
