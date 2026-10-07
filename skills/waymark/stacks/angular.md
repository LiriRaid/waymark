# Stack: Angular (v17 through 21)

## Detect
Signals the agent checks (waymark `references/project-detection.md`): `angular.json` or `@angular/core` in `dependencies` of `package.json`. Version comes from `@angular/core`. Optional layers from dependencies: `@angular/ssr` (SSR), `tailwindcss`, `primeng`, `@lucide/angular` or `lucide-angular`, `gsap`, `@analogjs/vitest-angular`, `angular-eslint` / `@angular-eslint/*`.

## Commands
Default commands the agent runs in the Exit protocol; verify each once, then record it in project memory. `<pm>` = package manager from the lockfile. Owner rule: Angular projects use pnpm, even if no lockfile exists yet.

| Gate | Command | Notes |
|---|---|---|
| typecheck | `<pm> run typecheck` if script `typecheck` exists; else if `tsconfig.app.json` exists `<pm> exec tsc --noEmit -p tsconfig.app.json`; else if `tsconfig.json` exists `<pm> exec tsc --noEmit` | Angular projects usually hit the `tsconfig.app.json` branch. Specs live in `tsconfig.spec.json` and are not covered by it. |
| compile (L1 UI) | `<pm> exec ng build --configuration development` | The quickest check that also type-checks templates (`tsc` does not read them): no optimization or budgets, so faster than `build` and with a shorter output. Skip env/prebuild scripts unless the build needs their output. L2+ still runs `build`. |
| lint | if `eslint` in dependencies: `<pm> exec eslint {files}`; else `<pm> run lint` if script exists | Changed files only. `ng lint` is not used by the default gate. |
| test (scoped, while working) | Vitest: `<pm> exec vitest related {files} --run`; else the spec files by path | Only the specs that import the changed files; the full suite once at the end (L2+). |
| test | `<pm> run test` with `CI=true` if script `test` exists | Full suite, once at the end. Non-watch. `ng test` with the Vitest builder respects `CI`. The Karma-era `ng test` stays in watch mode, so recommend a `test:ci` script and record it in project memory. |
| build | `<pm> run build` if script exists | Runs `ng build`. In SSR projects with a preindex or prerender script, check `package.json` and run the preindex first. |
| format | `<pm> exec prettier --check {files}` | Not a gate. |

Project memory example (Quality gates, verified commands):

| Gate | Command | Verified |
|---|---|---|
| typecheck | `pnpm exec tsc --noEmit -p tsconfig.app.json` | <date> |
| lint (changed files) | `pnpm exec eslint {files}` | <date> |
| test (full) | `pnpm run test:ci` | <date> |
| build | `pnpm run build` | <date> |

With `@analogjs/vitest-angular`, use `pnpm exec vitest run`; with Angular's builder, `pnpm exec ng test --no-watch`.

## Conventions by department
Only what is specific to Angular. General rules live in the `dept-*` department skills (`dept-frontend`, `dept-ux-ui`, `dept-qa`, `dept-security`, `dept-data`).

### Frontend
- Standalone components only. No `NgModule` unless a documented justification exists (legacy v14-16 code is migrated incrementally, never mixed in new files).
- `ChangeDetectionStrategy.OnPush` on every new component.
- Signals for component state: `signal`, `computed`, `input()`, `output()`, `model()`, `viewChild()`, `linkedSignal()`, `resource()` / `httpResource()` where they fit (v19+/v21). `effect()` only for observable side effects (DOM, persistence, logging). RxJS only for real event streams.
- Update signals with `.set()` / `.update()`; never mutate the stored value.
- Zoneless (`provideZonelessChangeDetection()`) is the target; add no Zone-dependent code. For migrations use `angular-cli` `onpush_zoneless_migration`.
- `inject()` over constructor injection. `takeUntilDestroyed()` or `DestroyRef` for cleanup.
- Templates use control flow: `@if`, `@for (... ; track item.id)`, `@switch`, `@defer`. Never `*ngIf` / `*ngFor` in new code (`ng generate @angular/core:control-flow` migrates old code). `track` must be a stable key, not `$index` for mutable lists.
- Routing: lazy `loadComponent` for pages and layouts, `loadChildren` for feature route subtrees, functional guards and resolvers.
- SSR and hydration: every new public route must be server-renderable. Guard `window`, `document`, `localStorage` with `isPlatformBrowser` (or `afterNextRender` / `afterRender`). Keep `provideClientHydration()` active (with `withIncrementalHydration()` where used). Use `@defer (hydrate on viewport)` or `hydrate on interaction` for heavy blocks. SSR files: `main.server.ts`, `app.config.server.ts`, `app.routes.server.ts`. Never disable hydration to hide an error; find the DOM mismatch.

#### If Tailwind CSS 4 is present
- Tailwind first; dedicated CSS only when utilities do not cover it. Use existing tokens (`@theme`, CSS variables in the global theme file) before adding new ones. No inline styles except justified dynamic bindings. Do not add breakpoints if fluid layout solves it.

#### If PrimeNG is present
- Import components individually (standalone). Theme via `@primeuix/themes` with the project preset, wired through `providePrimeNG(...)` in `app.config.ts`. Runtime theming must keep `--p-primary-*` / `--p-surface-*` in sync. Verify ARIA (`get_component (accessibility section)`) on overlays and forms. Do not replace existing PrimeNG components unasked; check props with the `primeng` MCP.

#### If Lucide is present
- Use icons registered in the project's icon provider (owner's projects: `core/common/icons/`). No ad-hoc imports of the whole library.

#### If GSAP is present
- Encapsulate scenes in feature services; clean up in `DestroyRef`; respect `prefers-reduced-motion`; run browser-only code behind SSR guards.

### Testing
- Vitest is the default (v4 era) with `@analogjs/vitest-angular` or Angular's `@angular/build:unit-test` builder; JSDOM environment, setup in `src/test-setup.ts`, specs co-located as `<file>.spec.ts`. Older projects may still use Karma/Jasmine: keep their runner, do not migrate unasked.
- TDD for services and logic: failing spec first, minimal implementation, refactor green.
- Prefer `TestBed` with real providers; mock only HTTP (`provideHttpClientTesting`) and true boundaries. Zoneless tests use `await fixture.whenStable()` instead of `fixture.detectChanges()` loops.
- Prove UI behavior with component specs and the build; the browser (`test.browser`, `app.run`) only when the user asks.

### Data & state
- Signals first; services `providedIn: 'root'` when singleton. `localStorage` only for UI preferences, never tokens, always SSR-guarded.
- Models live in `features/<f>/entities/` or `shared/models/`: `interface` for shapes, `type` for unions. No `any`; use `unknown` and narrow.

### Security
- Angular sanitizes interpolation; treat `[innerHTML]` and `bypassSecurityTrust*` as red flags. Never store session tokens in `localStorage` (prefer HttpOnly cookies). Tokens go in git-ignored `environment.local.ts`; no secrets in committed `environment*.ts`. Run `pnpm audit --audit-level=moderate` and review dependency scripts before `pnpm approve-builds`.

### Build
- Keep size budgets in `angular.json`; a budget error is a gate failure, not something to silence.

## Tools
| Capability | Provider | Type |
|---|---|---|
| `framework.cli` | `angular-cli` (`list_projects` (workspaces and versions), `search_documentation` (official angular.dev, version-aware), `get_best_practices`, `find_examples`, `ai_tutor`, `onpush_zoneless_migration`) | MCP |
| `ui.library` | `primeng` (`search` (find components/guides), `list`, `get_component` (API: props, events, templates, a11y), `get_example`, `get_guide` (theming, styled/unstyled, pass-through), `get_setup`, `validate_usage` (check a usage against the installed version), `version`) - only if `primeng` is in deps | MCP |
| `ui.build` | `ui-build` | Skill |
| `ui.refine` | `ui-refine` - only if `gsap` is in deps or motion is requested | Skill |
| `test.browser` | `browser-verify` | Skill |
| `docs.library` | `context7` for Tailwind, GSAP, Vitest, RxJS | MCP |

If an MCP fails to connect, fall back to `context7` and `angular.dev`, and say so in the closing report.

## Architecture fit
- `screaming` (owner default): `features/<feature>/{components,services,entities,routes}`, `shared/` for reusable pieces, `core/` for infrastructure (interceptors, providers, icons). Path aliases `@core/*`, `@features/*`, `@shared/*`. `core` never imports `features`; `shared` never imports `features`; features do not import other features.
- Nx projects: follow their tags and module-boundary lint rules instead.

## Anti-patterns
- Default change detection; `NgModule` in new code; `*ngIf` / `*ngFor` in new templates.
- Subscribing without cleanup; `BehaviorSubject` where a signal suffices.
- Direct signal value mutation; `effect()` used to derive state (use `computed`).
- `window` / `document` / `localStorage` without an SSR guard.
- Importing all of PrimeNG or Lucide; `any` in models.
- Components over 300 lines mixing logic and template.
- Cross-feature imports; speculative abstractions.

## Official docs
- https://angular.dev/guide/components
- https://angular.dev/guide/signals
- https://angular.dev/guide/templates/control-flow
- https://angular.dev/guide/zoneless
- https://angular.dev/guide/ssr
- https://angular.dev/guide/hydration
- https://angular.dev/guide/incremental-hydration
- https://angular.dev/guide/testing
- https://vitest.dev/guide/
- https://tailwindcss.com/docs
- https://primeng.org
