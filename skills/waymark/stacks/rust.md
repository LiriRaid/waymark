# Stack: Rust

Generated from `templates/stack.template.md` for the external corpus (docs/adr/0027); the commands are Cargo's own and were checked against its documentation, not yet against a live task: verify each once and record it in project memory.

## Detect
Signals the agent checks (waymark `references/project-detection.md`): `Cargo.toml` at the root (a `[workspace]` table means a multi-crate workspace; run commands per crate with `-p <crate>` or for all with `--workspace`), `Cargo.lock`, `rust-toolchain.toml`.

## Commands
Default commands the agent runs in the Exit protocol; verify each once, then record it in project memory.

| Gate | Command | Notes |
|---|---|---|
| typecheck | `cargo check --all-targets` | Compiles without producing binaries; the fast gate |
| lint | `cargo clippy --all-targets -- -D warnings` | Needs the `clippy` component; warnings fail the gate |
| test | `cargo test` | Non-watch; `--workspace` for every crate; doc tests run too |
| build | `cargo build` | `--release` only when the task is about performance or packaging |
| format | `cargo fmt --check` | A gate in CI, `cargo fmt` fixes it |

Project memory example (Quality gates, verified commands):

| Gate | Command | Verified |
|---|---|---|
| typecheck | `cargo check --all-targets` | <date> |
| lint (changed files) | `cargo clippy --all-targets -- -D warnings` | <date> (clippy runs on the crate, not on single files) |
| test (full) | `cargo test --workspace` | <date> |
| build | `cargo build` | <date> |

## Conventions by department
Only what is specific to Rust. General rules live in the `dept-*` department skills.

### Frontend / Backend
- Errors are values: return `Result<T, E>`; use `?`; a library defines its error type (`thiserror`), an application may use `anyhow`. `unwrap`/`expect` only where failure is a bug, with a message that says why.
- Prefer borrowing over cloning; take `&str`/`&[T]` in parameters, return owned types. Make invalid states unrepresentable with enums and newtypes.
- Modules mirror the public API: `lib.rs` re-exports what is public; everything else is `pub(crate)`. Keep `main.rs` thin and move logic to the library crate so it can be tested.
- Public items carry `///` docs; examples in docs are compiled as tests.
- Async: pick one runtime (`tokio`) and do not block inside async code; use `spawn_blocking` for blocking work.

### Testing
- Unit tests live next to the code in `#[cfg(test)] mod tests`; integration tests in `tests/`; snapshot or property tests (`insta`, `proptest`) where output is large or input space wide.
- A test is deterministic: no clocks, no network, no shared temp paths.

### Data & state
- Serialization through `serde` with explicit field names; migrations versioned, never edited after release.

### Security
- No `unsafe` without a `// SAFETY:` comment stating the invariant; run `cargo audit` or `cargo deny` for advisories and licenses.

## Tools
| Capability | Provider | Type |
|---|---|---|
| docs | `library-docs` (docs.rs, the Rust book) | skill |
| lint | `cargo clippy` | CLI |
| advisories | `cargo audit` / `cargo deny` | CLI |

## Architecture fit
- A binary crate over a library crate (`src/main.rs` + `src/lib.rs`) is the usual shape; `hexagonal` fits services (ports as traits in the domain module, adapters in their own modules); a CLI is `layered`: parse → run → render.
- Workspaces split by responsibility (`core`, `cli`, `server`); dependencies point to `core`.

## Anti-patterns
- `unwrap()` on input or I/O; `clone()` to silence the borrow checker; `Rc<RefCell<…>>` as a default.
- Stringly-typed errors; panics for expected failures.
- Blocking calls inside async functions; holding a lock across `.await`.
- `#[allow(...)]` to hide a clippy warning instead of fixing it.

## Official docs
- The Rust Programming Language: https://doc.rust-lang.org/book/
- The Cargo Book: https://doc.rust-lang.org/cargo/
- Clippy lints: https://doc.rust-lang.org/clippy/
- Rust API Guidelines: https://rust-lang.github.io/api-guidelines/
- docs.rs: https://docs.rs
