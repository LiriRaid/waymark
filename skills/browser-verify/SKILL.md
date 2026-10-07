---
name: browser-verify
description: "Waymark tool (test.browser), owner dept-qa. Verify a web change in a real browser: \"verifica que funcione\", \"pruébalo en el navegador\", \"se ve bien en móvil\", screenshots, console errors, smoke/e2e, responsive. Local dev hosts only. Not unit tests."
---

# Browser Verify

> **Precondition.** Tool of `dept-qa` (supporting `dept-frontend`). If that department skill is not loaded in this conversation, load it first and use its brief (what, why, where, how) as the input of this skill. Skip only for L0 edits.

## Approach
A passing test suite says the code compiles and the units behave; only a rendered page says the user can do the job. This skill turns the brief's acceptance criteria into observations in a real browser and returns evidence, not opinions.
- **Look before you touch.** Every interaction starts with a fresh view of the page (accessibility tree, text or screenshot). Selectors and coordinates come from what is rendered now, never from guessing at the source.
- **Wait for readiness, not for time.** Wait for the server to answer and for the page to settle (network quiet, target element present). Fixed sleeps are a last resort and always short.
- **Use what the session already has.** Prefer browser tools already wired into the session over installing anything.
- **Local only, fake data only.** Verify against `localhost`, `127.0.0.1`, `[::1]`, `*.localhost` or `*.test`. Use seed/fixture or generated test accounts, never the user's real credentials, never a production URL.
- **Every criterion gets a verdict.** Pass, fail, or not verified with a reason. Silence is not a pass.

### Guardrails
- **MUST** recon before every interaction sequence; re-read after navigation or a re-render.
- **MUST** stay on local development hosts; refuse production or third-party URLs for interaction.
- **MUST NOT** type real passwords, tokens, card or ID numbers; use test values from the project's seeds/fixtures or generated ones recorded there.
- **MUST NOT** install browsers or packages without an explicit yes.
- **MUST** stop servers you started and leave the user's running.
- **SHOULD** keep scripts throwaway in the scratchpad; promote to a committed e2e test only when `dept-qa` asks for one.

### Provider order
Decide once per session, top to bottom; stop at the first that works. Say which one was used in the output.

| # | Provider | How to detect | Notes |
|---|---|---|---|
| 1 | Built-in browser pane / preview tools | Tool list or `ToolSearch` shows tools such as `preview_start`, `navigate`, `read_page`, `find`, `computer` (screenshot), `read_console_messages`, `read_network_requests`, `resize_window` | Best option: no install, the user can watch. `resize_window` takes presets (mobile 375, tablet 768, desktop) and a `colorScheme` for light/dark. Screenshots come back inline, not as files. |
| 2 | Browser extension MCP (e.g. a Chrome extension server) | Deferred tools named like `mcp__<chrome-server>__navigate`; load the whole set in ONE `ToolSearch` call | Runs in the user's real browser profile: never read their other tabs, history or saved credentials. |
| 3 | Playwright via Node | `@playwright/test` or `playwright` in `package.json` | `pnpm exec playwright ...` (or the project's package manager). Saves screenshots to disk. |
| 4 | Playwright via Python | `playwright` in `pyproject.toml` / `requirements*.txt` | Use the project's environment (`uv run`, `poetry run`, venv). |
| 5 | Nothing available | — | Ask before installing anything (`pnpm add -D @playwright/test` + `pnpm exec playwright install chromium`). If the user declines, report every criterion as *not verified* and give manual steps. |

### Server lifecycle
Starting, reusing or stopping the dev server → `references/server-lifecycle.md`.

## Inputs
| Input | Source |
|---|---|
| Brief | the `dept-qa` / `dept-frontend` brief: acceptance criteria, affected screens, states, viewports |
| Stack conventions | `../waymark/stacks/<stack>.md` → *Commands* and *Testing* |
| Project context | `<project>/.waymark/memory.md` → *Quality gates* (dev server row), *Gotchas*, test accounts |
| Known patterns | `patterns/` in this skill (generic flows) + project skills (project-specific) |

## Output contract
Always return to the department:

```
Browser verify · provider: <built-in pane | chrome MCP | playwright-node | playwright-python> · url: <local url> · server: <started by me / reused>
Criteria
- ✔ <criterion> — <what was observed>
- ✘ <criterion> — <observed vs expected> — <screenshot ref>
- not verified: <criterion> — <reason>
Console / network: <none new> | <level · message · source> | <failed request · status>
Screenshots: <paths or inline step refs>
Server: stopped / left running (not mine)
```

## Pattern library (grows with use)
- Before building, list `patterns/` and read the matching file, if any (`patterns/README.md` explains the format).
- After verifying a reusable flow that has no pattern yet (login with a seed user, a CRUD form, a modal, a paginated table, a theme toggle), write `patterns/<pattern>.md` from `../waymark/templates/pattern.template.md`: intent, anatomy of the check, states to cover, a11y checks, pitfalls, one adapter per provider used. Project-specific routes and accounts go to project memory, not here.
- Update an existing pattern only with new, verified information (novelty check, waymark `references/learning.md`).

## Modes
Read **only** the mode the task needs (one file); never load all modes.

Pick the smallest mode that proves the brief. `dept-qa` browser verification for any UI change = smoke + the relevant parts of states + evidence.
- **smoke** — any UI change; golden path of the changed feature. → `modes/smoke.md`
- **states** — new or restyled components, screens with async data, responsive or theming work. → `modes/states.md`
- **regression** — a previously reported bug was fixed, or a change touches code near a known bug. → `modes/regression.md`
- **evidence** — closing an L1+ UI task, or the user asks for screenshots or console output. → `modes/evidence.md`

## Stack adapters
Stack-specific notes → `references/stack-adapters.md` (read only the project's stack row).

## Learned notes
_Grows with use (waymark `references/learning.md`). Dated, non-obvious notes about using this tool. When there are more than ~10, fold them into the body above and clear this list._
