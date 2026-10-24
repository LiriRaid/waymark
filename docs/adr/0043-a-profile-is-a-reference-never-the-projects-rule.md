# 0043 · A profile is a reference, never the project's rule

**Status:** accepted (2.0.19). Supersedes the `.gitignore` decision of ADR 0013 and the `.gitignore` line of ADR 0017: Waymark's ignores go to `.git/info/exclude`.

## Context

Four days of real use of 2.0.18 (three projects, one author) showed one failure that did the most harm. The architecture profile `screaming.md` stated a generic Scope Rule ("used by one feature → inside it; 2+ → shared") and `dept-architecture` repeated it as the default placement. A frontend whose author had kept every UI piece in one shared folder since its first commit was handed that rule as if it were the project's own: an agent moved dozens of files out of the shared folder "because they had one consumer", wrote the rule into the project's own ADR and instruction file, and later sessions obeyed it. Undoing it touched hundreds of files and cost four sessions. Nothing in Waymark had read the repository's history, the project's `memory.md` still held the template's placeholders, and the choice window offered the move as "recommended" without saying it went against months of structure.

The same weakness showed in smaller places: stack profiles said "pnpm, even with no lockfile" for repos that had their own; Waymark wrote its ignore lines into the project's versioned `.gitignore` (and once left that file without its final newline); a rule the user stated was saved in the agent's own memory folder, where no other agent reads it.

The author's standing rule applies: Waymark follows each developer's stack, architecture and way of working and never imposes its own.

## Decision

- **A profile is a reference.** `screaming.md` keeps the Scope Rule as one variant, "profile default", beside a *Shared UI* variant; placement, conformance and "common violations" say which variant a rule belongs to. Stack profiles say the repo's lockfile and versions win.
- **The convention is detected from the repo.** `waymark.mjs convention` censuses where components, modals, services, models and styles live, names the commit that first added the structure, lists the project's own docs and reads the lockfile. It is read-only and deterministic. `--move <from> <to>` returns the verdict a window shows: "follows the convention" or "CONTRADICTS the project's convention"; with no convention (too few pieces, or no shared and feature layers) the answer is "profile default", never "the project's rule".
- **memory.md carries it.** When *Architecture* still holds the template's placeholder, the session hook writes what the census found, with its evidence, marked "(to confirm)"; a line a person wrote is never touched. The first task asks the user to confirm it once.
- **A structural change is its own question.** Moving files between layers, splitting or merging files, a new kind of folder is L3 and goes in its own choice window, even when the user chose "recommended" for everything else: what moves, the convention detected and its first commit, and one line that says follows or CONTRADICTS. When it contradicts, the recommended option is not to move. A convention that contradicts the repo's history is never written into the project's own docs without the user's explicit decision.
- **User rules go where every agent reads them**, by scope: preferences valid everywhere → `~/.waymark/preferences.md`; a project's rules → its `memory.md` → *Conventions*; each with a date and the user's phrase, an older contrary rule marked expired. A turn that writes into an agent's native memory folder gets a non-blocking note from the end-of-turn hook saying where the rule belongs (no new testigo: the fixed context does not grow).
- **Waymark writes nothing versioned into the user's repo.** Its ignore lines go to `.git/info/exclude` (a worktree shares it); a line the project's own `.gitignore` already holds is kept. `waymark.mjs check` lists lines 2.0.18 wrote into a versioned `.gitignore` and `waymark.mjs localize [--apply]` moves them, leaving the project's own lines.

## Alternatives considered

- **Keep the profiles as rules and only ask before moving.** The failure was not the missing question but a profile that answered it before anyone asked; and the window said "recommended". Rejected.
- **Detect the convention in the procedure text only.** Not testable with synthetic repos and dependent on the model remembering it, which is what failed. Rejected for a script.
- **A new blocking testigo for the native-memory write.** It costs a `routine.json` row and its claim in the fixed context, which is over its threshold. A one-line notice carries the same information. Rejected for now.
- **Keep `.gitignore` for Waymark's lines so every clone and agent shares them.** Every clone gets its own exclude from its own Waymark; sharing them is what put Waymark in the project's diff. Rejected.

## Consequences

- A repo with a convention is never told to move toward a profile; a repo with none gets the profile default and says so.
- `convention.mjs` guesses from names and `@Component`; a repo it cannot read (few pieces, no shared and feature layers) says "no convention detected" and the agent describes the repo by hand as before.
- Projects that 2.0.18 touched keep their `.gitignore` lines until `check` offers the move; the move is the user's yes, and the resulting `.gitignore` change is theirs to commit.
- Tests use synthetic repositories only: no project name, path or prompt (ADR 0042).
