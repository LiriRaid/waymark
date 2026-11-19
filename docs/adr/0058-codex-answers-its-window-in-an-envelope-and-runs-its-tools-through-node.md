# 0058 · Codex answers its window in an envelope and runs its tools through node

**Status:** accepted (2.0.21, in the making). Builds on ADR 0042 (detectors read the commands agents really run) and the Codex adapter of ADR 0022.

## Context

Ten Codex sessions of real use (33 tasks, 2026-10-31 to 11-11, all in one web project) showed three failures that were Codex's alone:

- Its tests and linter ran as `node node_modules/vitest/vitest.mjs …` and `node node_modules/eslint/bin/eslint.js …`. `runs.mjs` read only tsc and framework CLIs by that form, so no Codex test run counted: 14 stop blocks "a spec changed after the last test run" and most of its Tests ✘ were runs the hook never saw.
- The answer to `request_user_input_async` comes as a user message `<send_user_message_question_reply>[{"answer", "questionItemId"}]`. The adapter took it for a new prompt: each answer began a task of its own whose prompt was the envelope.
- 34 of its 102 window calls were refused by Codex ("unknown field `question`, expected `title` or `options`"), and a refused window never counts.

## Decision

1. `runs.mjs` reads vitest, jest, mocha, eslint, karma and cypress run by node from their package path, as it already read tsc and the framework CLIs.
2. `agents/codex.mjs` reads the envelope as the answer to the pending windows (matching by `questionItemId`, else by position; a free-text answer is the answer too), and `isPrompt` (`transcript.mjs`) leaves the envelope out, so the answer does not begin a task.
3. The Codex note (`note`, appended to every reminder and denial for that agent) gives the exact arguments of the window: `{"questions":[{"title":"<the question>","options":["A (Recomendado)","B"]}]}`, no other field.

## Consequences

- About 110 characters more in each Codex reminder; the refused windows each cost a round trip.
- The words of a free-text answer are in the recorded answer, not in the task's prompts: a skip quoted from them is read through ADR 0057's sources, not as a prompt.
- A Windows path with unquoted backslashes is still not parsed for any tool; the real Codex commands used forward slashes.
- Specs: `tests/real-use-2021.test.mjs` (cases "18:").
