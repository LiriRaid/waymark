# 0002 · Waymark is a supply chain of the agent's work

**Status:** accepted (2026-10-02, Waymark 2.0.0-dev). Supersedes the naming alternative and the L2/L3-only decision gate of 0001. · gate "denied once" superseded by [0003](0003-strict-gate-and-tool-call-evidence.md)

## Context
0001 recorded "calling it a software supply chain" as rejected. That was not the user's decision: the user decided that Waymark **is** a supply chain and the docs say so, made defensible with arguments. The user also changed the decision rule: Waymark used to let the agent decide ("the agent still decides"); now the agent never decides alone. At every real decision it lists the optimal options, marks the recommended one (which may not be what the user needs), and the user picks; the record says that on that date the user decided it. The claim will be tested in a real A/B: the same micro-app feature, Waymark on one account and machine and gentle-ai on another, time-boxed. It compares tokens, time, whether the task was completed in full and as asked, hallucinations, and whether every decision was put to the user with options.

## Decision
Waymark is a **supply chain of the agent's work**: every change moves through defined stages, and each stage leaves verifiable evidence that ties it to its inputs and outputs:
- **Inputs:** the request (the user's words), the project memory, and a manifest per task (Waymark and agent version, model, MCP servers used, hashes of the instruction files).
- **Stages:** routing to the department that owns the task; the **user's decision** among the optimal options (any level, whenever there are 2+ valid ways; a single real way is recorded as `única (<why>)`); observed or inferred evidence; gates; review.
- **Outputs:** the files changed and the commits, each carrying the trailer `Waymark-Task: <task ID>`.
- **Record:** one line per task in a hash-chained log (each line holds the hash of the previous one), built by the hooks from what the transcript proves. The claims the hooks could not back are listed, not hidden.

The decision gate applies from L1 up: the pre-tool hook denies the first edit of a prompt once when no option was put to the user.

## Alternatives considered
- **"Provenance chain" without the supply-chain name (0001):** rejected by the user. The supply-chain shape (inputs → stages → outputs, each with attestable evidence) is what the system does; the name says so.
- **A software supply chain in the SBOM/dependency sense:** not what this is. Dependency audit stays with `dept-security`. The README states the difference so the claim cannot be refuted on that ground.
- **Gate only at L2/L3 (0001):** rejected, the agent kept deciding alone at L1.
- **Asking even when there is one way:** rejected by the user, one extra round on trivial tasks with nothing to decide.
- **Signed records (sigstore) and a verify command:** not now. Signing needs an account and network; `verifyChain` exists as a function for tests, and a CLI can follow if the A/B needs it.

## Consequences
- Positive: every task can be audited end to end (who decided what, when, with which inputs, and which commit it produced); an edited or deleted record breaks the chain; the A/B has hard evidence to compare.
- Negative: a deny at L1 when the agent forgets to ask (one retry when there is one way); ~100 more characters in the per-prompt reminder; a `git log` call (≤ 1.5 s timeout) at the end of turns that changed files.
- Follow-up: step 2 (log and memory in `<project>/.waymark/`), step 3 (reduce), step 4 (A/B protocol and its result table, with the user's criteria).
