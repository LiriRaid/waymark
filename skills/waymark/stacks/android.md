# Stack: Android (Gradle, Kotlin)

Generated from `templates/stack.template.md` for the external corpus (docs/adr/0027, 2.0.17 point 4); the commands are the Android Gradle plugin's own, checked against its documentation, not yet against a live task: verify each once and record it in project memory.

## Detect
Signals the agent checks (waymark `references/project-detection.md`): `settings.gradle` or `settings.gradle.kts` with a module that holds `src/main/AndroidManifest.xml`, the `com.android.application` or `com.android.library` plugin in a `build.gradle(.kts)`, a `gradlew` wrapper at the root, Kotlin sources under `src/main/java` or `src/main/kotlin`. Version catalogs live in `gradle/libs.versions.toml`.

## Commands
Default commands the agent runs in the Exit protocol; verify each once, then record it in project memory. Always the wrapper (`./gradlew`), never a global `gradle`; it needs a JDK and the Android SDK (`ANDROID_HOME`).

| Gate | Command | Notes |
|---|---|---|
| typecheck | `./gradlew compileDebugKotlin` | Compiles the debug sources of every module; the fast gate (`:app:compileDebugKotlin` for one module) |
| lint | `./gradlew lint` | Android Lint; `ktlintCheck` or `detekt` too when the project applies them |
| test | `./gradlew testDebugUnitTest` | JVM unit tests; instrumented tests (`connectedDebugAndroidTest`) need a device or emulator and are not a gate |
| build | `./gradlew assembleDebug` | Produces the debug APK; `bundleRelease` only for a release task |
| format | `./gradlew ktlintFormat` or `spotlessApply` | Only where configured; not a gate |

Project memory example (Quality gates, verified commands):

| Gate | Command | Verified |
|---|---|---|
| typecheck | `./gradlew compileDebugKotlin` | <date> |
| lint (changed files) | `./gradlew lint` | <date> (per variant, not per file) |
| test (full) | `./gradlew testDebugUnitTest` | <date> |
| build | `./gradlew assembleDebug` | <date> |

## Conventions by department
Only what is specific to Android and Kotlin. General rules live in the `dept-*` department skills.

### Frontend / Backend
- UI is Jetpack Compose or Views, not both in one screen; state hoisted to a `ViewModel` that exposes `StateFlow`/`UiState`; composables take state and callbacks, never a `ViewModel`.
- One-way data flow: UI → event → `ViewModel` → repository → data source; the repository is the single source of truth and decides cache versus network.
- Coroutines: `viewModelScope` / `lifecycleScope`, structured concurrency, dispatchers injected; never `GlobalScope`, never block the main thread.
- Dependency injection through the project's choice (Hilt or Koin); constructors, not field lookups.
- Resources in `res/` with string resources for text, never hard-coded; `dp`/`sp` units; support dark theme and large fonts.
- KDoc on public API: a summary, `@param`, `@return`.

### Testing
- ViewModel and repository logic as JVM unit tests with fake data sources and `runTest`; Compose UI tests with `createComposeRule`; screenshots only where the project already has them.
- A test is deterministic: injected dispatchers and clocks, no network, no real database file.

### Data & state
- Room migrations are versioned and exported (`schemaLocation`); never edit a shipped migration. Preferences through DataStore.

### Security
- No secrets in `build.gradle` or resources; `network_security_config` for cleartext rules; `exported` set explicitly on every manifest component; permissions requested at the point of use.

## Tools
| Capability | Provider | Type |
|---|---|---|
| docs | `library-docs` (developer.android.com, kotlinlang.org) | skill |
| lint | `./gradlew lint`, `ktlint`, `detekt` | CLI |
| build | `./gradlew` | CLI |

## Architecture fit
- `clean` and `layered` map to `ui/`, `domain/`, `data/` packages per feature; `feature-sliced` fits multi-module apps (`:feature:x`, `:core:data`) with the dependency direction pointing to `:core`.

## Anti-patterns
- Logic in an `Activity`/`Fragment`/composable; a `ViewModel` holding a `Context` or a view.
- `!!` on platform types; `runBlocking` on the main thread; leaking a `Context` into a singleton.
- A migration edited after release; a hard-coded string; an exported component with no permission.
- Running the full instrumented suite as a per-task gate.

## Official docs
- Android developers: https://developer.android.com/docs
- Guide to app architecture: https://developer.android.com/topic/architecture
- Jetpack Compose: https://developer.android.com/compose
- Kotlin: https://kotlinlang.org/docs/home.html
- Android Gradle plugin: https://developer.android.com/build
