# Stack: PHP (Composer, Laravel)

Generated from `templates/stack.template.md` for the external corpus (docs/adr/0027); the commands come from Composer, PHPStan, Pint and Laravel documentation, not yet from a live task: verify each once and record it in project memory.

## Detect
Signals the agent checks (waymark `references/project-detection.md`): `composer.json` at the root (`require.php`, `require-dev`), `composer.lock`; Laravel adds `artisan`, `bootstrap/app.php` and `laravel/framework` in `require`. A repo with both `composer.json` and a `package.json` that names no JS framework is PHP with a front-end build (Vite), not a Node project.

## Commands
Default commands the agent runs in the Exit protocol; verify each once, then record it in project memory.

| Gate | Command | Notes |
|---|---|---|
| typecheck | `./vendor/bin/phpstan analyse` | Only when `phpstan.neon` (or larastan) is configured; otherwise `composer validate --strict` is the manifest check |
| lint | `./vendor/bin/pint --test` | Laravel Pint, check mode; `./vendor/bin/pint {files}` fixes |
| test | `php artisan test` | Laravel; else `./vendor/bin/pest` or `./vendor/bin/phpunit`; non-watch |
| build | none (PHP is not compiled) | Front-end assets: `npm run build` when `package.json` has it |
| format | `./vendor/bin/pint {files}` | Not a gate |

Project memory example (Quality gates, verified commands):

| Gate | Command | Verified |
|---|---|---|
| typecheck | `./vendor/bin/phpstan analyse` | <date> |
| lint (changed files) | `./vendor/bin/pint --test {files}` | <date> |
| test (full) | `php artisan test` | <date> |
| build | `npm run build` (assets) or `none (PHP is not compiled)` | <date> |

## Conventions by department
Only what is specific to PHP and Laravel. General rules live in the `dept-*` department skills.

### Frontend / Backend
- PSR-12 and PSR-4 autoloading: one class per file, namespace mirrors the folder under `app/`.
- Laravel: thin controllers, validation in Form Requests, business rules in actions or services, authorization in policies. Eloquent models hold relations and scopes, not workflows.
- Configuration through `config/*.php` reading `env()` only inside config files; never call `env()` elsewhere.
- Strict types: `declare(strict_types=1);` in new files; typed properties, return types, enums over constants.

### Testing
- Feature tests hit routes with the HTTP test helpers and a refreshed database (`RefreshDatabase`); unit tests avoid the framework. Factories build the data, never fixtures edited by hand.

### Data & state
- Migrations are forward-only and never edited once merged; add a new one. Queries go through Eloquent or the query builder with bindings; avoid N+1 with eager loading (`with()`).

### Security
- Mass assignment guarded (`$fillable`); output escaped in Blade (`{{ }}`), `{!! !!}` only for trusted HTML; secrets only in `.env`, which is never read or committed.

## Tools
| Capability | Provider | Type |
|---|---|---|
| docs | `library-docs` (Laravel, PHP manual) | skill |
| static analysis | PHPStan / Larastan | CLI |
| style | Laravel Pint | CLI |

## Architecture fit
- Laravel's default is `layered` (routes → controllers → services/actions → models); larger apps move to `modular-monolith` (one folder per bounded context under `app/Domain` or `modules/`).

## Anti-patterns
- Fat controllers and models; business rules in Blade views; queries in loops.
- `env()` outside `config/`; secrets committed.
- Editing a merged migration; `DB::raw` with interpolated input.
- Suppressing PHPStan errors with `@phpstan-ignore` instead of fixing the type.

## Official docs
- PHP manual: https://www.php.net/manual/en/
- Laravel: https://laravel.com/docs
- Composer: https://getcomposer.org/doc/
- Laravel Pint: https://laravel.com/docs/pint
- PHPStan: https://phpstan.org/user-guide/getting-started
- Pest: https://pestphp.com/docs
- PSR-12: https://www.php-fig.org/psr/psr-12/
