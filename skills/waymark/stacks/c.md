# Stack: C

Generated from `templates/stack.template.md` for the external corpus (docs/adr/0027, 2.0.17 point 4); the commands are CMake's, CTest's and the usual analyzers' own, checked against their documentation, not yet against a live task: verify each once and record it in project memory.

## Detect
Signals the agent checks (waymark `references/project-detection.md`): `CMakeLists.txt` at the root (or a `Makefile` next to `*.c` / `*.h` files); a `src/` or `include/` folder of C sources, `portable/` or `port/` folders for a kernel or HAL, a toolchain file (`*.cmake`, `arm-none-eabi-*`) for an embedded target. A repository that builds only for hardware has no test target on a developer machine: say so in project memory instead of inventing one.

## Commands
Default commands the agent runs in the Exit protocol; verify each once, then record it in project memory.

| Gate | Command | Notes |
|---|---|---|
| typecheck | none | The compiler is the typecheck: build with `-Wall -Wextra` (and `-Werror` where the project sets it) |
| lint | `cppcheck --enable=warning,style,performance --error-exitcode=1 .` | Or `clang-tidy` with the project's `.clang-tidy`; use what the repository already configures |
| test | `ctest --test-dir build --output-on-failure` | Needs a configured build; projects without a test target say so (embedded libraries often test elsewhere) |
| build | `cmake -S . -B build && cmake --build build` | Out-of-tree; `make` for a Makefile project; a cross build needs the project's toolchain file |
| format | `clang-format --dry-run --Werror <files>` | Only when `.clang-format` exists; not a gate otherwise |

Project memory example (Quality gates, verified commands):

| Gate | Command | Verified |
|---|---|---|
| typecheck | none (compiler warnings) | |
| lint (changed files) | `cppcheck --enable=warning,style --error-exitcode=1 <files>` | <date> |
| test (full) | `ctest --test-dir build --output-on-failure` or `none (<why>)` | <date> |
| build | `cmake -S . -B build && cmake --build build` | <date> |

## Conventions by department
Only what is specific to C. General rules live in the `dept-*` department skills.

### Frontend / Backend
- Fixed-width types (`uint32_t`, `size_t`) for anything with a size or a wire format; no `int` for sizes; `const` on every pointer that does not write.
- Ownership is a comment and a naming rule: who allocates, who frees; an API that returns a buffer says who releases it. In an embedded target prefer static allocation, and none after initialisation.
- Every function validates its pointer and length arguments at the public boundary (`configASSERT`-style macros where the project has them) and returns a status, not `void`, when it can fail.
- Headers carry the public contract only: include guards, `extern "C"` for C++ users, no definitions; each `.c` includes its own header first.
- Shared state touched by an interrupt is `volatile` and guarded by the project's critical-section primitive; an ISR never blocks or allocates.
- Comments say why, in the project's existing style (Doxygen blocks where it uses them).

### Testing
- Unit tests build against a host port or mocks; hardware-in-the-loop is a separate pipeline, not a developer gate.
- A test is deterministic: no timers, no uninitialised memory, no dependence on build flags.

### Data & state
- Struct layout across a wire or flash boundary is explicit (`__attribute__((packed))` with care, or serialise field by field); endianness is stated.

### Security
- No `gets`, `strcpy`, `sprintf` without a bound; check every length before a copy; integer overflow before an allocation size; MISRA C / CERT C rules where the project follows them.

## Tools
| Capability | Provider | Type |
|---|---|---|
| docs | `library-docs` (the project's own docs, cppreference) | skill |
| lint | `cppcheck`, `clang-tidy` | CLI |
| format | `clang-format` | CLI |
| build | `cmake`, `ctest` | CLI |

## Architecture fit
- `layered` fits most C libraries: public API, core, port or HAL; ports are the only place that knows the target. `modular-monolith` fits a firmware split into components with headers as contracts.

## Anti-patterns
- Global mutable state without an owner; functions that both parse and act.
- Macros for what a `static inline` function does; macros with side-effecting arguments.
- Casting away `const` or `volatile` to silence a warning; `#ifdef` forests instead of a port layer.
- A change that compiles on the host and was never built for the target when the task touches a port.

## Official docs
- CMake documentation: https://cmake.org/cmake/help/latest/
- CTest: https://cmake.org/cmake/help/latest/manual/ctest.1.html
- cppcheck manual: https://cppcheck.sourceforge.io/manual.html
- clang-tidy: https://clang.llvm.org/extra/clang-tidy/
- SEI CERT C Coding Standard: https://wiki.sei.cmu.edu/confluence/display/c
