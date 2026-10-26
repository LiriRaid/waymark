# Architecture: Screaming (feature-first + Scope Rule)

## Quick ref
**Intent:** Top-level folders announce the business domain (inbox, contacts, billing), not the framework (components, services, controllers).
**Dependency rule:** `features/*` may import `shared/` and `core/`; `shared/` imports neither features nor core components; `core/` imports no features; no feature imports another feature.
**Detect:** `src/app/features/` or `src/features/` (Angular/React), `src/modules/<domain>/` (NestJS), `app/domains/` or namespaced `app/models/<domain>/` (Rails).
**A profile is a reference, never a rule.** The repo's own structure wins: run `W convention` and read *Variants* before placing or moving anything. The placement defaults below apply only where the repo shows no convention of its own, and are then recorded as "profile default", never as "the project's rule".
**Scope Rule (default only):** used by one feature only -> inside that feature; reused by 2+ features -> `shared/`; cross-cutting infrastructure (auth, http, realtime, config) -> `core/`.

## Layout
```
src/app/
  core/            infrastructure only: interceptors, auth, realtime, app config, layout shell
  shared/          reusable pieces: ui components, pipes, directives, pure utils, shared models (what counts as reusable: see Variants)
  features/
    <feature>/     named after the domain (inbox, contacts, billing)
      components/  dumb/presentational pieces of this feature
      pages/       routed containers (or at feature root)
      services/    state + data access for this feature
      entities/    (or models/) types and mappers of this feature
      <feature>.routes.ts   lazy route subtree
  app.routes.ts    loadChildren -> features/<feature>/<feature>.routes
```
Mappings:
- **Angular 21:** standalone only (no NgModule), signals, OnPush, `loadChildren: () => import('./features/inbox/inbox.routes')`. Aliases `@core/*`, `@features/*`, `@shared/*`.
- **React/Next:** `src/features/<feature>/{components,hooks,api,types}`, `src/shared/`, `src/core/` (or `lib/`). Next: `app/<route>` stays thin and imports from `features/<feature>` public entry.
- **NestJS:** one module per domain: `src/modules/<domain>/{<domain>.module,controller,service,dto,entities}`; cross-cutting in `src/common/` or `src/core/` (guards, filters, interceptors, config). Domain modules talk via exported services, never via another module's repository.
- **Rails:** `app/domains/<domain>/{models,services,controllers,serializers}` (or namespaces/engines per domain: `app/models/billing/invoice.rb`, `Billing::InvoiceService`); cross-cutting in `lib/` or `app/lib/`.

## Variants (conventions this layout takes in real repos)
The folder names are the same; what differs is what goes in `shared/` and what stays in a feature. The census of `W convention` says which one the repo follows; its evidence (where the pieces live, the commit that set it) is written to `memory.md` → Architecture.
| Variant | `shared/` holds | A feature holds |
|---|---|---|
| Scope Rule (profile default) | what 2+ features use | what only that feature uses, UI included |
| Shared UI | every reusable UI piece (components, modals, pipes), even with one consumer | business logic: models, services, routes, pages |
| Shared library + feature screens | a library of reusable UI pieces (`shared/components`), even with one consumer | its screens and the modals and panels only that screen uses |
A folder that has held a library of UI pieces since a commit is a home of its own: a move out of it contradicts the convention even when the features hold more pieces. A repo that matches none: describe what it does in `memory.md` and follow that. Never move a piece from one layer to the other to make a repo match a variant.

## Dependency rules
| From | May import | Must not import |
|---|---|---|
| `features/<a>` | own files, `shared/`, `core/` | `features/<b>` (any other feature) |
| `shared/` | `shared/`, third-party libs | `features/`, `core/` services |
| `core/` | `core/`, third-party libs, `shared/` pure utils | `features/`, `shared/components` |
| `app.routes.ts` | lazy `import()` of feature routes | static imports of feature components |

If two features need the same contract, move it to `shared/` (type/interface) or communicate through an event/store in `core/`.

## Placement rules
Rules 1 and 2 are the Scope Rule variant: they apply only when `memory.md` → Architecture says so or the repo has no convention (then they are "profile default"). In a Shared UI repo a new reusable UI piece goes in `shared/` from its first use.
1. Used by exactly one feature? -> inside that feature, even if it looks generic. Do not pre-emptively share.
2. A second feature now needs it? -> move it to `shared/` in the same change and update both consumers.
3. Is it infrastructure (http interceptor, auth session, websocket client, app config, error handler)? -> `core/`.
4. Is it a new business capability? -> new `features/<domain-name>/` with its own `*.routes.ts`, registered with `loadChildren`.
5. Generic folder names (`utils/`, `helpers/`, `common/`, `misc/`) at feature level are forbidden; name by what it does in the domain (`conversation-filters.ts`).
6. A generic util with no domain meaning that two features use -> `shared/utils/<specific-name>.ts`, never `core/`.

## Conformance checklist
Replace `<feature>` with the feature being edited.

- [ ] No feature imports another feature — check: `grep -rnP "from '(@features/|(\.\./)+features/)(?!<feature>)" src/app/features/<feature>` returns nothing.
- [ ] `shared/` does not import features — check: `grep -rnE "features/|@features/" src/app/shared` returns nothing.
- [ ] `core/` does not import features or shared components — check: `grep -rnE "features/|@features/|shared/components|@shared/components" src/app/core` returns nothing.
- [ ] Features are lazy — check: `grep -nE "loadChildren|loadComponent" src/app/app.routes.ts` lists the feature; `grep -nE "^import .*features/" src/app/app.routes.ts` returns nothing.
- [ ] No NgModule introduced — check: `grep -rn "@NgModule" src/app` returns nothing (or only documented justifications).
- [ ] No generic folders inside the feature — check: `find src/app/features/<feature> -type d \( -name utils -o -name helpers -o -name common -o -name misc \)` returns nothing.
- [ ] Scope Rule variant only: new shared code has 2+ consumers — check: `grep -rln "<SharedSymbol>" src/app/features` lists at least 2 features.
- [ ] Routes file exists and is named after the domain — check: `ls src/app/features/<feature>/<feature>.routes.ts`.
- [ ] Functions <= 30 lines, components <= 300 lines — check: `wc -l` on touched component files.
- [ ] No `any`, no dead or commented-out code in touched files — check: `grep -rnE ":\s*any\b|as any" <touched files>` returns nothing.
- [ ] Names reveal the domain (`ConversationListComponent`, not `ListComponent`/`Manager`/`Helper`) — review touched file names.

## Clean Code expectations
- One responsibility per file; a feature service owns that feature's state only.
- Pages orchestrate, components render, services hold state and I/O; no HTTP in components.
- Prefer small, intention-revealing functions; name by domain language, not technical role.
- Scope Rule variant: refactor to share only after the second real use (two is enough to move to `shared/`).

## Common violations -> fix
| Violation | Fix |
|---|---|
| `features/inbox` imports `features/contacts/contact.service` | Extract the contract to `shared/` (type) or expose data via a `core/` store/event |
| Component used by one feature lives in `shared/` | Scope Rule variant only: move it into the feature. In a Shared UI repo it is not a violation: leave it |
| `core/` holds a generic `StringUtils` | Move to `shared/utils/` under a specific name |
| `shared/` component injects a feature service | Pass data via `input()`/`output()`; feature container injects the service |
| Feature route statically imported in `app.routes.ts` | Use `loadChildren: () => import('./features/<f>/<f>.routes')` |
| Folder `components/` at app root holding domain pieces | Move into the owning feature |
| NestJS service injects another module's repository | Import that module and use its exported service |

## Enforcement tooling
- Angular/React/TS: `eslint-plugin-boundaries` or `@nx/enforce-module-boundaries`; `dependency-cruiser` rules forbidding `features/a -> features/b`; `eslint no-restricted-imports` as a minimal option.
- NestJS: same TS tools; Rails: `packwerk` (when domains are packs) or Zeitwerk namespaces plus RuboCop custom cops.

## References
- Robert C. Martin, "Screaming Architecture" (2011, blog.cleancoder.com).
- Angular style guide and architecture: https://angular.dev/style-guide
- Scope Rule: one convention among others (single use -> feature, 2+ -> shared, cross-cutting -> core); the profile default only where the repo has none.
- Related: `feature-sliced.md` (stricter layered variant), `modular-monolith.md` (backend equivalent).
