# Protocol · When stuck (two-strike rule)

Read at any level when a second attempt on the same problem failed.

The second failed attempt on the same problem means guessing has started. Stop varying the fix and switch method:
1. **Observe, do not assume.** Get the real state: the rule that wins in the stylesheets, the actual runtime value, the full error and stack, the real request/response, the version installed. **The browser is the user's** (`browser-verify` only when they ask for it; never offered or recommended) → give the user one copy-paste check (e.g. `getComputedStyle(document.querySelector('.x')).transform` in DevTools) with the expected value before and after the fix, and mark the fix *no verificado* until they confirm.
2. **Re-read the source of truth.** Official docs for the exact API and version (`library-docs`), and the code that actually runs (not the file you think runs: check imports, overrides, themes, generated files).
3. **Hypotheses.** List 2–3 possible causes; test first the check that rules out the most of them with the least effort. One change at a time.
4. **Ask once, precisely.** Still unclear → one concrete question to the user (which element / screen / input, a screenshot of the inspector, the exact steps), not a list of guesses.
5. **Record it.** When solved, the Cierre's Aprendido holds symptom, root cause, fix and what did not work; the end-of-turn hook saves it to engram.
