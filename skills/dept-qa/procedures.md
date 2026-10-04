# dept-qa · Procedures

Loaded on demand from `SKILL.md` → *Procedures*. Read only the section the task needs.

### Quick bug triage (L1)
1. **Recall:** project memory → *Solved problems* by symptom; known → apply it.
2. **Reproduce the symptom precisely** from the user's words or screenshot: what, where, when it works and when it does not (e.g. "works after refresh, fails after navigating").
3. **Locate the exact target** (element, file, selector, function) and read only the relevant lines.
4. **Stale view after an action?** Check what reloads it: another tab or window (`window.open`, `target="_blank"`), a cache in a service or store, a reused route or component that does not re-fetch. Rule this out before blaming the backend.
5. **Explain every symptom** with one cause; a cause that explains only some of them is not the cause yet.
6. **Evidence:** observe the real state, or give the user the one-line check (*When stuck* → plan B).
7. **Smallest fix**, then the L1 gate (lint/typecheck of changed files) and *Solved problems* entry.

### Test pyramid — choose the level
1. **Unit** (most): pure logic, services, state, mappers. No network, DB or browser.
2. **Integration** (fewer): component + template, endpoint + DB, repository + real store. Test the seam.
3. **End-to-end** (fewest): critical journeys only (login, checkout, main CRUD), with `browser-verify` only when the user asks.
4. Put each assertion at the lowest level that can prove it.

### New feature or behavior (TDD: red / green / refactor)
1. Turn acceptance criteria into test names (one behavior each, Given/When/Then).
2. **Red:** write the smallest failing test. Run it; confirm it fails for the expected reason (assertion, not compile or import error).
3. **Green:** minimum code that makes it pass. No extra branches "for later".
4. **Refactor:** clean names, remove duplication, keep tests green after every step.
5. Repeat per criterion; add edge cases: empty, null, boundaries, error paths, permissions.
6. Run the gates for the level (below).

### Bug fix
1. **Reproduce:** exact steps, input, observed vs expected. UI: reproduce with a failing spec (`run` / `browser-verify` only when the user asks).
2. **Root cause:** hypothesis, confirm with logs, debugger or a minimal test. Do not patch the symptom.
3. **Failing regression test** at the lowest pyramid level. Run it; it MUST fail.
4. **Fix:** smallest change that addresses the root cause. The regression test MUST now pass.
5. **Gates:** run the gates for the level; rerun the original reproduction steps.
6. Structural cause → hand off to `dept-architecture` and note it in the report.

### Run the quality gates yourself
Commands come from project memory → *Quality gates* (`<project>/.waymark/memory.md`), else `../waymark/stacks/<stack>.md` → *Commands*. Never invent a command; if none is verified, discover it per the stack profile, run it once and record it in project memory.

| Level | Gates |
|---|---|
| L1 | typecheck · lint (changed files) · related tests |
| L2 | L1 + build |
| L3 | typecheck · lint · full test suite · build |

1. Run non-interactively (no watch mode). Read the first error; fix top-down: typecheck → lint → test → build.
2. Erroring file in your diff → it is yours, fix it.
3. Not in your diff → prove it is pre-existing in a clean copy of HEAD that never touches the user's changes: `git worktree add <tmp> HEAD` → install if needed → rerun the exact failing command there → `git worktree remove <tmp>`. Fails there too = pre-existing; quote command and error ("comprobado en copia limpia de HEAD: falla igual"). Never `git stash` the user's work (staged state and new files can be lost). The command is not allowed (permission denied, no git) → do not retry: write "previo: no comprobado (sin permiso para <command>)".
4. Never skip, comment out or loosen a test or lint rule to get green.
5. After 3 honest attempts, stop and report the remaining failures verbatim; do not claim done.

### Browser verification (only when the user asks)
Never offer or recommend it, and never choose it on your own: it spends many tokens and misreads screens. When the user asks:
1. Start the app with `run` (dev command from project memory or the stack profile).
2. With `browser-verify`: golden path, then at least two edge cases (empty, error, long content, slow network).
3. Console and network: no new errors or failed requests.
4. Check narrow (mobile) and wide (desktop) viewports, keyboard navigation and visible focus.
5. Screenshot visual changes and mention them in the report.

### Code review (L2+, before done or a PR)
1. Run `code-review` on the current diff.
2. Verify each finding technically (reproduce or read the code path). Fix real issues; justify rejected ones in one line.
3. L3: `simplify`, applying only behavior-preserving changes. Security-relevant diff → `security-review` via `dept-security`.
4. Human feedback: confirm each point technically before changing code.

### Quality score (L3 or explicit request only)
Define the unit (module, feature, context). Score each area 1–10 against the project's own profiles. For every area < 8 give a fix with `path:line`. ≥ 8 everywhere = healthy · 6–7 = log and schedule · < 6 = fix before merge.

| # | Area | Evaluate |
|---|---|---|
| 1 | Architecture conformance | Checklist of `architectures/<arch>.md` passes; names reveal the domain |
| 2 | Boundaries & dependencies | No forbidden imports; shared code truly shared |
| 3 | Framework best practices | Stack profile idioms; no deprecated APIs |
| 4 | State & data flow | Single source of truth, explicit ownership, no hidden mutation |
| 5 | Clean code | Small units, no dead code, clear names |
| 6 | Maintainability | Single responsibility, low coupling |
| 7 | Type safety | No untyped escapes or needless casts |
| 8 | Testing | Logic, edge cases, regressions covered; low mocking |
| 9 | Styling architecture (UI, else N/A) | Tokens over literals, no specificity hacks |
| 10 | Config & secrets | Injected per environment, nothing hardcoded |
| 11 | Error handling & observability | Handled at boundaries, logged with context |
| 12 | Scalability & performance | No god units, N+1 or unbounded work |
| 13 | Regression risk | Changes isolated, no silent coupling |

Output: table `# · Area · Score · Verdict`, then `Overall: XX/130 (X.X/10)` (exclude N/A and say so), then `Issues to fix (score < 8)` as `[Area] — problem — path:line — fix`.

## Anti-patterns
- Declaring done without running the app or the tests.
- Tests that assert on mocks instead of outcomes.
- Flaky tests "fixed" with retries or sleeps.
- Claiming "pre-existing" without the clean-copy proof, or stashing the user's changes to get it.
- Using gate commands that were never verified in this project.

## References
- ISO/IEC/IEEE 29119 (Software testing) · ISO/IEC 25010 (Product quality)
- ISTQB Foundation Level: https://www.istqb.org
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Kent Beck, *Test-Driven Development: By Example*
