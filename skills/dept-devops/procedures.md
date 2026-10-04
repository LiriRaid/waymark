# dept-devops · Procedures

Loaded on demand from `SKILL.md` → *Procedures*. Read only the section the task needs.

### Git: commit (only when the user asks)
1. `git status` and `git diff`; never stage unrelated files, build output or secrets.
2. On the default branch with a non-trivial change: create a branch `<type>/<short-kebab-description>` first.
3. Conventional Commit: `<type>(<scope>): <imperative summary ≤ 72 chars>`, blank line, body with the why. Types: `feat` `fix` `refactor` `perf` `test` `docs` `build` `ci` `chore` `revert`. Breaking: `!` plus `BREAKING CHANGE:` footer.
4. Add the trailer `Waymark-Task: <task ID>` (the ID the per-prompt hook offered; it links the commit to the task's record) and the attribution lines the session requires, if any.
5. New commit; no `--amend` unless asked. A failing pre-commit check: fix the cause and commit again.

### Git: pull request (only when the user asks)
1. Run the gates for the level (`dept-qa`); run `code-review` on the branch diff.
2. Rebase or merge the latest default branch; resolve conflicts preserving both intents.
3. Title in Conventional Commits. Body: what, why, how verified, risks, rollback.
4. Small and single-purpose; split diffs that mix refactor and behavior change.

### Git: destructive operations
1. `reset --hard`, `clean -f`, `push --force`, branch deletion, history rewrite: confirm with the user and state what will be lost.
2. Prefer `--force-with-lease` on feature branches. Never force-push the default branch.

### Build
1. Use the build command from project memory → *Quality gates*, else the stack profile.
2. Install from the lockfile in frozen/CI mode; a lockfile change must be intentional and committed with the dependency change.
3. Run pre-build generation scripts the project declares (manifest scripts) before building.
4. New warnings, budget overruns and deprecations are defects to fix or report.
5. Keep build output, dependency folders and caches out of version control.
6. Record any non-obvious build flag or gotcha in project memory.

### CI pipeline (new or changed)
1. Mirror the local gates in order: install → typecheck → lint → test → build. Fail fast.
2. Pin runtime and tool versions; cache dependencies keyed by the lockfile hash.
3. Run on pull requests and the default branch; require green checks before merge.
4. Secrets only from the CI secret store; never echo them.
5. Verify provider syntax with `library-docs` when not verified this session.

### Environments and configuration
1. Twelve-Factor: config in the environment, not in code. One artifact promoted across environments when the stack allows.
2. Document every required variable (name, purpose, example) in an example file with no real values.
3. Fail at startup with a clear message when a required variable is missing.

### SSR / prerender deploy concerns
1. Server-rendered routes must not touch browser-only globals; guard them per the stack profile.
2. Decide per route: static prerender, server render on request, or client-only. Record it in project memory; do not change it at deploy time.
3. Verify hydration with the build's prerender/SSR output and the server-render tests (in the browser with `browser-verify` only when the user asks): no mismatch warnings, no content flash, no duplicate requests.
4. Caching headers and CDN rules consistent with the rendering mode.
5. Never disable SSR or hydration to hide an error; find the root cause.

### Deploy and rollback (only when the user asks)
1. Deploy only artifacts that passed CI. Tag releases with semantic versions when the project versions releases.
2. Prefer progressive strategies (blue/green, canary, feature flags) for risky changes.
3. Migrations backward-compatible first (expand → migrate → contract) with `dept-data`.
4. Smoke test after deploy with a health endpoint (`browser-verify` only when the user asks).
5. Know the rollback before deploying: previous artifact, revert commit or flag off.

### Observability
1. Structured logs with correlation id, non-sensitive user/tenant id and sanitized parameters.
2. Consistent log levels; no secrets, tokens or personal data in logs.
3. Health/readiness checks; latency, error-rate and saturation metrics on critical paths.
4. Errors caught at a boundary are logged with context or rethrown, never swallowed.

## Anti-patterns
- Committing or pushing without being asked.
- Force-pushing the default branch or bypassing git checks.
- "Works locally" without a clean install from the lockfile.
- Hardcoded URLs, ports or credentials per environment.
- Disabling SSR/hydration instead of fixing a browser-global access.
- Skipping pre-build generation scripts the project depends on.
- Migrations that break the running release; logs with tokens or personal data.
- Deploying without a known rollback.

## References
- DORA: https://dora.dev · Google SRE Book: https://sre.google/books/
- Conventional Commits: https://www.conventionalcommits.org · SemVer: https://semver.org
- The Twelve-Factor App: https://12factor.net
- OpenTelemetry: https://opentelemetry.io/docs/ · ITIL 4
