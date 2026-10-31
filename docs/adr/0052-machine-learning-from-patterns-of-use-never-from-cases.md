# 0052 · Machine learning: patterns of use, never cases (design, no model code)

**Status:** accepted as a design (2.0.20, point 12). Nothing in this ADR is built: the opt-in alpha is 2.1. It builds on ADR 0042 (no data of real projects leaves the machine or enters the repository) and ADR 0015 (what is learned lives in engram and in the project's memory, never in the agent's private memory).

## Context

Waymark already learns locally: a correction the user makes twice becomes a proposed line of the project's *Conventions*, a repeated procedure becomes a proposed skill, a failed testigo becomes an incident and, after repetition, a proposed rule (`learn.mjs`, `incidents.mjs`, `convention.mjs`). The user asked (2026-10-24) for a design of a learning that goes further, on one condition: it learns **patterns of use, never cases**, people share their own patterns, and Waymark sends nothing itself.

## Decision

1. **A pattern is a shape, a case is content.** A pattern says "in tasks of this kind the agent that asked for the reference before the first change closed with fewer ✘" or "a build of this form was not credited": counts, forms, outcomes and the rule they suggest. A case is anything of a task: the ask, a path, a file name, code, a transcript, a Cierre, a link, a repository name. Cases are never an input to anything that leaves the machine.
2. **Features are counts and shapes.** The inputs of a model are the fields the record already keeps without text: level, department, testigo results, the form of a command (the program and the kind of its arguments, never the arguments), counts of calls, blocks, returns to ego, tokens by link. Free text is never a feature, and neither is a hash of it: a hash of a prompt is a prompt that can be guessed.
3. **Training is local.** The user's machine computes its own patterns from its own records and keeps them in `~/.waymark/` (never in a project). Nothing is uploaded to train anything.
4. **Sharing is the person's act.** A person can export a file of their own patterns: plain JSON, readable, listing every field it carries, produced by a command they run and read before they send it by any channel they choose (an issue labelled `pattern` in the release's repository is the one Waymark documents). Waymark never sends, and a pattern file has no network step.
5. **Receiving is a proposal.** An imported pattern arrives like any other proposal of the card: the user accepts, edits or drops each one, and an accepted one becomes a line of *Conventions* or of `preferences.md` (*Adapt, never impose*: a pattern never overrides the repo or the user's rule).
6. **Privacy model.** Threats considered: re-identification of a project by its names (no names in a pattern); inference of code from counts (counts are coarse, buckets not exact values; a pattern needs at least five tasks behind it to exist); a pattern that is a case in disguise (a file lists its fields and the export refuses a field that holds more than a bucket, a form or a number); a hostile pattern that tries to instruct the agent (an imported pattern is data shown to the user, never text the agent reads as an instruction).
7. **Evaluation is held out, as 10.3 is.** A pattern is kept only if, on the user's own later tasks, it lifts a measured outcome above a random baseline; a pattern that does not is dropped and the record says so.

## Alternatives considered

- **Central collection of tasks or prompts to train a model:** rejected; it is the supply chain and the privacy exposure this project exists to avoid.
- **Embeddings or hashes of prompts as features:** rejected; a text can be recovered or guessed from them, and they would make a case travel as if it were a pattern.
- **Federated learning with a server that aggregates:** postponed; it needs a server Waymark does not run, and the same result is reached by people exchanging patterns they read.

## Consequences

The 2.1 alpha has a bounded scope: an export command, an import that only proposes, and the held-out evaluation, all offline. The design asks nothing of 2.0.20 beyond this text.
