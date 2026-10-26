# 0047 · The eyes: a seen change is looked at before it is done

**Status:** accepted (2.0.19). Supersedes the browser clause of ADR 0011 ("browser verification only when the user asks"). Extends ADR 0010 (every applicable step blocks once) and ADR 0045 (nothing read is saved).

## Context

ADR 0011 removed the browser from the routine after one costly check that decided nothing: the agent offered it, the user gave a test account, and screenshots were misread. Real use of 2.0.18 showed the other side. On big UI tasks, new modules and screens built from the user's screenshots, the user could not tell how far the build matched the reference, and a build or a spec passed over a button that kept its old height. Jsdom computes no layout, so a spec cannot see it; only a rendered page can.

Test 0 (2026-10-25, one static local page, ego 0.6.0.16): 390 px emulation by `page.cdp("Emulation.setDeviceMetricsOverride")`, a measured width (a button held to 28 px by specificity), a real click and the state after it all worked, but every `Page.captureScreenshot` timed out. After `ego-browser upgrade` (0.6.1.11) the same page captured in about 120 ms.

## Decision

- **The eyes run by themselves.** At the end of an L2/L3 task that created or changed something seen, and of an L1 change of CSS/HTML only with no spec, a browser must have measured an element (computed size or style, a script run in the page) or clicked it with the resulting state, after the task's last change. A build, a spec, a `goto` or a snapshot alone is not the look of the screen. The testigo `eyes` ("Ojos", `routine.json`) blocks once.
- **The way out.** `Ojos: no (<why>)` after the block (a dev server that cannot start, a screen behind a login the user has not made); it passes as a declared exception, never as a pass, and the Cierre says "inferida" with the check for the user. With no browser on the machine the testigo does not apply and the record says so.
- **The provider is what the machine has.** ego-browser first (on `PATH`, or where its installer puts it), then Playwright where the project declares it, then the agent's own browser panel (read from the calls the turn made). The hook reads tool calls, never words: an `ego-browser nodejs` call counts when its script, or the file it imports, measures or clicks.
- **The source of truth** is what the user sent: their screenshots or a design link. The Cierre answers each listed element "igual / parecido / falta" with its measurement. The model compares; there is no pixel diff.
- **Host.** `localhost` and the local names only, under the user already logged in on the platform: Waymark creates no test users or profiles and signs in nowhere, and never types credentials. The one other host is a design-reference URL the user wrote in the request, read-only. No command that clears the browser profile.
- **The record keeps** `observed.eyes = { provider, calls, measures, afterLastChange, references }`: counts only, never a URL or the text of a page. Captures live outside the repo.
- **The rule is in the instructions block** (`templates/instructions.md`): "Eyes: localhost, no credentials" replaces "never offer or run browser verification", and the testigo is quoted. The block does not grow (10,950 → 10,942).

## Alternatives considered

- **Keep it on request (ADR 0011).** The user cannot judge a big build against a reference by reading code, and the agent has no other way to see.
- **A pixel diff.** Brittle across fonts and rendering; the model compares the two images and the measurement backs it. Reconsider with real data.
- **Only the agent's panel.** Not every agent has one, and the hook cannot see what an agent could have called; ego works from any shell.

## Consequences

- A seen change costs a browser round (about the cost of the checks 0011 removed) but it is bounded: one task space, one measurement per element, no offers and no accounts.
- A machine with no ego and no declared Playwright keeps the old behaviour; the panel counts only when the agent used it.
- `skills/browser-verify` gains the mode `eyes` and ego as first provider; the departments, stacks and UI skills say the eyes run by themselves instead of "only when the user asks".
- Still to build: the `eyes` row of `memory.md` for the dev server, and the captures folder with its 7-day clean-up listed by `check`.
