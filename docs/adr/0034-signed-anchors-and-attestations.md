# 0034 · The anchor signed at the close, a signed attestation, and a key lifecycle

**Status:** accepted (2.0.18, point 6). Amends ADR 0027 §6 (the records were not signed) and §7 (the attestation was not signed).

## Context

The chain of records is anchored in git, so editing or deleting a record is caught, and so is rewriting the log and chaining it again while the anchors survive. What it cannot resist is someone who can rewrite the repository, the notes and the log together: nothing says who vouched for the anchor. ADR 0027 said so and left the signature as a later option. The release already carries a signature made with an ssh key (`ssh-keygen -Y sign`, checked against `skills/waymark/ALLOWED_SIGNERS`); the user's own tasks can use the same kind of key.

## Decision

`scripts/sign.mjs` (and `waymark.mjs sign`):

- **What is signed.** When a task closes, the hook signs the anchor that already chains the records: the log's id, the kind, the number of records, the last hash and the time (`waymark-anchor/v1`), with namespace `waymark-anchor`. One `ssh-keygen` call (about 40 ms) per task, and per rewrite anchor (`forget`: who rewrote the log signs the rewrite). The signature is a `{ kind: "sig", n, hash, at, signedAt, state, sig }` line appended to the same notes ref as the anchors (`refs/notes/waymark-anchor`), so it travels with `notes push` and `notes setup` and no new ref is needed. `anchorsFor` does not return those lines: the chain reads the anchors it always read.
- **Which key** (the user's choice, 2026-10-17): `WAYMARK_SIGNING_KEY`, else the `Signing key: <path>` line of `~/.waymark/preferences.md`, else git's `user.signingkey` when `gpg.format` is `ssh`. A public key file works with ssh-agent. The key is never read, printed or copied: only its path goes to `ssh-keygen`. With no key nothing is signed and nothing is written.
- **A locked key.** The hook never prompts. `ssh-keygen` with no terminal fails in about 0.2 s on a key with a passphrase, and the hook records `state: "locked"` for that anchor (`verify`: `unsigned (key locked)`). `waymark.mjs sign --pending` signs those from the user's terminal, where `ssh-keygen` can ask for the passphrase, only on the user's yes; it stops at the first wrong passphrase. A signature made later is marked `late` (`signed by <key> (signed later)`): it says the key's holder vouched for that anchor when they signed it, not when the task closed. The anchors from before signing began are not signed retroactively.
- **Trust.** `verify` trusts the release's `ALLOWED_SIGNERS` plus the user's own `~/.waymark/ALLOWED_SIGNERS` (git's allowed-signers format: several keys, each with ssh's `valid-after` and `valid-before`) and revokes the keys listed in `REVOKED_SIGNERS` (release and user; one public key per line, compared by fingerprint). A key's validity is judged as of the time it signed. The states: `signed by <key>`, `signed, key revoked`, `signed outside its validity`, `signed, key not trusted`, `BAD signature` (the anchor or the signature was edited), `unsigned (key locked)`, `unsigned`.
- **What fails.** `BAD signature` fails `verify` (a signature that does not match its anchor is tampering). Every anchor from the first one that carries a signature line should be signed: any other state after it is a warning, and `--require-signed` makes it fail (`--require-signature` implies it and also asks for the release's). The anchors before signing began are history, not a gap.
- **The attestation.** `attest --out file.json` writes `file.json.sig` (namespace `waymark-attestation`); `verify --attestation file.json` reports `signed by <key>`, `unsigned` or `BAD signature` (an edited statement), and `--require-signed` fails on anything but signed.

## What a signed anchor proves, and what it does not

It proves that the holder of the signing key vouched, when the task closed, for the log's length and last hash, so a log rewritten and chained again cannot be re-anchored under that key without the key. It does not prove that the content of a record is true; that the key belongs to the person it names (the keys `verify` trusts come from files, and whoever controls those files controls the verdict); or when it was signed (`signedAt` is the hook's clock, not a timestamp authority, so a validity window can be dodged by someone who controls the machine's clock and the key). A key left unlocked on a machine signs whatever runs there, including a hook an attacker caused to run. The point is to make rewriting the history detectable by someone who does not have the key, not to make the agent's work correct.

## Alternatives considered

- **Sign every record.** More calls and more notes (questions, confirmations); the user chose one signature per task.
- **Sign the record hash, not the anchor.** The anchor already commits to the log's length and last hash and is what git holds; signing it is one step and covers both.
- **A new notes ref for signatures.** Needs its own push, fetch and merge. A line in the anchor ref reuses all three.
- **Ask for the passphrase in the hook.** It would hang a turn on an agent that has no terminal. Rejected for `locked` and `sign --pending`.
- **Sign the past with `sign --all`.** A signature today on an anchor from last week proves only that the key was held today. Not offered.
- **Only the release's `ALLOWED_SIGNERS`.** Someone else using Waymark could not verify their own signatures without editing the repository.

## Consequences

- Scorecard checks 3.3 to 3.7 pass; criterion 3 is limited by what a signature cannot prove, not by what is missing. No task of the author's is signed yet: the hooks installed are the ones from before this release, and no signing key is set up here, so the first signed anchor comes after the reinstall and the choice of a key path.
- `verify` calls `ssh-keygen` once per signed anchor, so its time grows with the number of signed tasks (about 80 ms each).
- The chain, `forget` and the notes machinery are unchanged for a project with no key.
