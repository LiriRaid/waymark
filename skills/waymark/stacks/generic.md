# Stack: Generic (unknown stack fallback)

## Detect
Signals the agent checks (waymark `references/project-detection.md`): used when no other stack profile matches and project memory sets no stack. Typical cases: Rails/Ruby, Python, Go, Rust, Java/Kotlin, .NET, PHP, Elixir, monorepos with mixed languages, repositories with only scripts or docs. With no known stack there are no default commands, so the agent must discover the project's real commands before claiming anything works.

## Commands
There are no default commands for an unknown stack: the agent discovers them (below), verifies each once and records them in project memory. Do not treat "no gates ran" as "all green".

| Gate | Command | Notes |
|---|---|---|
| typecheck | none by default | Discover (see below) then record in project memory. |
| lint | none by default | Discover then record in project memory. |
| test | none by default | Discover then record in project memory. Must be non-watch. |
| build | none by default | Discover then record in project memory. |
| format | none by default | Not a gate. |

For Node-based layouts: if a `package.json` exists the `node` profile applies instead of this one, with `<pm>` taken from the lockfile.

### Discover commands, in this order
1. **Project docs**: `README*`, `CONTRIBUTING*`, `docs/development*`, `CLAUDE.md`, `AGENTS.md`. Look for sections named Development, Testing, Build, Contributing.
2. **Task runners**: `Makefile` (`make -n <target>` or read targets such as `test`, `lint`, `check`, `build`), `justfile`, `Taskfile.yml`, `package.json` scripts, `Rakefile`, `noxfile.py`, `tox.ini`, `build.gradle*`, `pom.xml`, `Cargo.toml`, `go.mod`, `mix.exs`, `composer.json`.
3. **CI configuration**: `.github/workflows/*.yml`, `.gitlab-ci.yml`, `azure-pipelines.yml`, `.circleci/config.yml`, `Jenkinsfile`. The commands CI runs are the authoritative gates; copy them exactly, including flags and environment variables.
4. **Tool config files**: `pyproject.toml` (`[tool.pytest]`, `[tool.ruff]`, `[tool.mypy]`), `.rubocop.yml`, `.golangci.yml`, `clippy` in CI, `.editorconfig`, `.pre-commit-config.yaml` (lists the lint and format hooks the team expects).
5. **Container files**: `Dockerfile`, `docker-compose.yml`, `.devcontainer/` often reveal the build and test entry points and required services.

Common command shapes, to be verified against the project before use, never assumed:

| Ecosystem | Test | Lint / typecheck | Build |
|---|---|---|---|
| Ruby/Rails | `bundle exec rspec` or `bin/rails test` | `bundle exec rubocop` | `bin/rails assets:precompile` |
| Python | `pytest` (via `uv run`, `poetry run`, or venv) | `ruff check`, `mypy` | `python -m build` |
| Go | `go test ./...` | `go vet ./...`, `golangci-lint run` | `go build ./...` |
| Rust | `cargo test` | `cargo clippy`, `cargo fmt --check` | `cargo build` |
| Java/Kotlin | `./gradlew test` or `mvn test` | `./gradlew check` | `./gradlew build` |
| .NET | `dotnet test` | `dotnet format --verify-no-changes` | `dotnet build` |

Package manager: Rails projects use Bundler (`bundle`), whatever `package.json` exists for assets. The repo's lockfile wins everywhere: respect lockfiles (`Gemfile.lock`, `poetry.lock`, `uv.lock`, `Cargo.lock`, `go.sum`).

### Record the commands in project memory
Once each command has run successfully, write it into the "Quality gates (verified commands)" table of the project memory file so future sessions skip discovery. Project memory is the agent's private layer, so no user approval is needed; ask the user only when a command is ambiguous. Example:

| Gate | Command | Verified |
|---|---|---|
| typecheck | `bundle exec srb tc` | <date> |
| lint (changed files) | `bundle exec rubocop {files}` | <date> |
| test (full) | `bundle exec rspec` | <date> |
| build | `bin/rails assets:precompile` | <date> |

Omit any gate that does not exist; use `{files}` only for tools that accept file arguments. Commands must be non-interactive and non-watch, and must exit non-zero on failure.

## Legacy repos (any stack)
A repo is legacy when its framework is under its legacy major (Angular before 14, React Scripts or Vue CLI before 5, Nuxt 2, Next before 12, NestJS before 8, Rails before 6, Django before 3, Laravel before 8, Spring Boot before 2) or when it needs an older runtime than this machine's. The repo's own versions, scripts and lockfile win over every profile, which assume current versions.
- **Runtime.** The version comes first from what the repo declares (`.nvmrc`, `.node-version`, `volta`, `engines`, `.ruby-version`, Gemfile `ruby`, `.python-version`, `requires-python`, `runtime.txt`, composer `php`, `.java-version`, `.sdkmanrc`, a Gradle toolchain, `.go-version`, `.tool-versions`, `mise.toml`), else from the framework's support table, else from a compile target read as a floor (`java.version`, go.mod `go`). When this machine's runtime is outside it, the session hook writes a `runtime` row per language in memory.md → Quality gates: `<lang> <folder>`, the folder of that version in nvm, Volta, fnm, rbenv, rvm, pyenv, uv, SDKMAN, asdf, mise or the system JDKs, or `none (needs …)` when this machine has none. The hook's own re-run of a gate puts the folders first on the PATH. Run every gate that way (the session card gives the bash and PowerShell form); never `nvm use`, `rbenv global`, `pyenv global` or `sdk default`, which switch the machine's runtime.
- **Conventions are the repo's.** The patterns of its version are how it is written: follow them; the department rules for current versions apply to new code only where the repo already does.
- **What the testigos accept here.** A temp config a command makes and removes (`tsconfig.spec.tmp.json`) is no change. A build run in the background counts once its output shows success (read it before closing); a build that takes minutes may instead be declared `Build: no (<time>)`, and `Tests: no (<why>)` likewise. A styles-only change owes no full build. When the tests were already failing, write `| test (full) | broken at HEAD (<why>) | <date> |` in Quality gates: a failing test run is then the baseline's, with no clean copy to prove it.

## Conventions by department
Only what is specific to working in an unknown stack. General rules live in the `dept-*` department skills.

### Frontend / Backend
- Infer conventions from the code before writing any: naming, folder layout, error handling, how similar features are implemented. Copy the closest existing example.
- Do not import another ecosystem's patterns (for example Node idioms into a Python project).
- Verify unfamiliar library APIs with `context7` rather than from memory; if no provider is available, say so in the report.
- Smallest change that preserves current behavior; do not introduce new dependencies or abstractions unasked.

### Testing
- Find the test command and a nearby existing test; mirror its style, fixtures, and naming. Run the narrowest relevant test first, then the full suite if time allows.
- Every bug fix gets a regression test where a test harness exists. If the project has no tests, state that and verify manually (run the app, exercise the path).
- Never declare "done" on the basis of code reading alone; run something and report what ran.

### Data & state
- Check for migrations tooling before touching schemas; migrations are immutable after merge. Use parameterized queries. Never run destructive database commands without explicit user approval.

### Security
- No secrets in code or logs; use the project's existing config mechanism. Validate input at boundaries. Check the dependency audit tool of the ecosystem (`bundle audit`, `pip-audit`, `cargo audit`, `govulncheck`) when upgrading dependencies.

## Tools
| Capability | Provider | Type |
|---|---|---|
| `docs.library` | `context7` | MCP |
| `search.codebase` | `Explore` | Agent |
| `plan.implementation` | `Plan` | Agent |
| `app.run` | `run` | Skill |
| `review.diff` | `code-review` | Skill |
| `review.security` | `security-review` | Skill |
| `memory.recall` | `engram` | MCP |

No stack-specific providers. If a capability has no provider in the session, do the work manually and state it.

## Architecture fit
Unknown by default. Read the top-level folder layout and decide: `layered` (controllers/services/repositories), `screaming` (folders named by domain), or the project's own convention. Record it in project memory once confirmed with the user. Do not reorganize folders to match a profile.

## Anti-patterns
- Guessing commands (`npm test` in a Ruby repo) instead of discovering them.
- Reporting green gates when none were configured or run.
- Installing global tools or changing system settings to make a build pass.
- Running watch-mode or interactive commands (they hang the gate).
- Recording commands in project memory that were never run successfully.
- Copying CI commands partially (dropping flags or env vars) and then trusting the result.
- Large refactors in an unfamiliar codebase before understanding its conventions.

## Official docs
- https://docs.github.com/actions/learn-github-actions (reading CI workflows)
- https://www.gnu.org/software/make/manual/make.html
- https://just.systems/man/en/
- https://taskfile.dev/usage/
- https://editorconfig.org
- https://pre-commit.com
- https://12factor.net
