# dept-data · Procedures

Loaded on demand from `SKILL.md` → *Procedures*. Read only the section the task needs.

### Schema migration
1. Describe the change in one line and classify it: additive (new table/column/index) or destructive (rename, drop, type change, NOT NULL on existing data).
2. Destructive changes MUST use expand/contract: (a) add new structure, (b) dual-write or backfill, (c) switch reads, (d) drop old structure in a later release.
3. Generate the migration with the project's own command first: `memory.md` → Conventions → `Migrations:` (detected from the repo and marked "to confirm" until the user confirms it; it may back up the database first). Only with none, the stack profile's. A migration file written by hand is asked about first. Never edit a migration merged or applied in a shared environment; write a new one.
4. Add constraints: NOT NULL, foreign keys, unique, check. Index foreign keys and columns used in WHERE/ORDER BY/JOIN.
5. Large tables: create indexes concurrently/online if the engine supports it; batch backfills; avoid long locks.
6. User or tenant data: define row-level access (database policy or enforced query scope) and hand off to `dept-security` for review.
7. Run migrate → rollback → migrate locally. Record that rollback works.
8. Update models/types and seeds/fixtures. Run the test suite.

### New query or repository method
1. Use the ORM or a parameterized statement; never concatenate input.
2. Select only needed columns; eager-load or batch associations to avoid N+1.
3. Run the engine's EXPLAIN on realistic data; add an index if a sequential scan hits a large table.
4. Paginate with a stable ordering (cursor on an indexed column preferred for large sets).
5. Test with zero, one and many rows.

### Server cache
1. Justify it: measured latency or load. No speculative caching.
2. Define key scheme `<feature>:<entity>:<id>[:<variant>]`, TTL and the write paths that invalidate it.
3. Invalidate on write (delete or version the key) in the code path that mutates the data, after commit.
4. Handle cache miss and backend unavailability; the app must work with the cache down.
5. Test: hit, miss, invalidation after write.

### Client state store
1. Classify the state: server cache (remote data), UI state (local, ephemeral), form state or URL state. Each has one owner.
2. Use the reactive primitive and store pattern from the stack profile. One source of truth; derive everything else (computed/selectors), never copy.
3. Update immutably through the store's API; no direct mutation of shared objects.
4. Side effects (persistence, logging, sync) go in dedicated effects, not inside derivations.
5. Remote data: track loading, error and empty states; dedupe concurrent requests; define refetch/invalidation after mutations.
6. Realtime updates: merge into the same store as fetched data, keyed by ID; ignore stale events by version/timestamp.
7. Server-rendered apps: guard browser-only APIs (storage, window) per the stack profile.

### Client persistence
1. Allowed in browser storage: UI preferences (theme, language, layout), non-sensitive drafts.
2. Not allowed: access/refresh tokens, PII, anything authorizing a request. Use HttpOnly cookies or memory.
3. Version persisted keys and tolerate missing/corrupt values (try/catch, schema check, fallback to default).

### Bug fix (data or state)
1. Reproduce with a failing test: query/migration test on the server, store test on the client.
2. Identify which source of truth is wrong or which copy diverged; state the root cause.
3. Fix at the source; remove the duplicated state rather than syncing it.
4. Keep the regression test.

### Refactor
1. Snapshot current behavior with tests (query results, store outputs).
2. Change structure only; data shape at the API and UI boundary stays identical.
3. Schema refactors follow expand/contract. L3: `Plan` agent first.

## Anti-patterns
- Editing an old migration to "fix" it.
- Rename/drop column in one step while old code is still deployed.
- Caching without invalidation ("we'll just wait for the TTL").
- Copying server data into several stores and syncing them manually.
- Mutating shared state objects in place.
- Business rules only in the client store.
- Tokens in browser storage.
- Adding an index "just in case" on every column.
- Reading browser-only APIs during server rendering.

## References
- DAMA-DMBOK — Data Management Body of Knowledge
- ISO/IEC 11179 — Metadata registries
- SWEBOK v4 — Software Construction
- Database engine, ORM and state library docs: `../waymark/stacks/<stack>.md` → *References*
