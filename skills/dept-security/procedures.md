# dept-security · Procedures

Loaded on demand from `SKILL.md` → *Procedures*. Read only the section the task needs.

### Security review of a change (L2+ with security impact)
1. List the trust boundaries the diff crosses: client→server, server→DB, server→third party, inbound webhook, file system.
2. Per boundary check: input validation, authn, authz, output encoding, error handling, logging.
3. Run `security-review` on the pending changes. Verify each finding technically; do not accept or dismiss blindly.
4. Grep the diff for secrets (keys, tokens, passwords, connection strings, private keys).
5. Fix or hand off findings; record accepted risks in the closing report.

### New or changed auth flow
1. Use the framework's vetted auth mechanism from the stack profile; never hand-roll crypto or session handling.
2. Passwords: slow adaptive hash (argon2id, bcrypt, scrypt). Tokens: short-lived access, rotated refresh, server-side revocation.
3. Browser tokens in HttpOnly, Secure, SameSite cookies, not in browser storage.
4. Authorize per request on the server: deny by default, check ownership/tenant, not just "logged in".
5. Tests: unauthenticated (401), wrong user/tenant (403), expired/revoked token, privilege escalation attempt.
6. Rate-limit login, reset and token endpoints; respond identically for unknown user and wrong password.

### Secrets handling
1. Read secrets from environment variables or the stack's encrypted secret store (stack profile).
2. Secret files (`.env`, key files, local config) in `.gitignore`; commit only an example file with placeholders.
3. If a secret was committed or logged: rotate it first, then purge history. Tell the user immediately.
4. A sensitive file is read only with the user's permission, given in the choice window the guard's block asks you to open (this task, this session or always), never from your own text or a chat message. What you read is never written down: not in memory, a note, an Aprendido or a mem_save (the hook masks the values of the project's `.env*` files and reports one that reaches a diff or a commit).
### Dependency audit
1. Run the stack's audit command (stack profile → *Commands*).
2. Block on critical/high with a known fix: upgrade or patch. No-fix findings: document exposure and mitigation.
3. New dependency: check maintenance, adoption, license, install scripts. Never approve install/build scripts without reading them.
4. Commit lockfiles; pin versions per the stack convention.

### Threat model (L3, or new external surface)
1. Describe the data flow in 5–10 lines: actors, entry points, data stores, trust boundaries.
2. Apply STRIDE per entry point: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege.
3. Per credible threat: threat, impact (low/med/high), mitigation, owner department.
4. Turn high-impact mitigations into acceptance criteria and tests before coding.
5. Include the table in the plan and the closing report.

### Security bug fix
1. Reproduce with a failing test demonstrating the exploit (no real secrets or production data).
2. Fix the root cause at the boundary, not only the reported payload.
3. Search for the same pattern across the codebase (`Explore`).
4. Keep the test as a regression guard.

## Anti-patterns
- "The frontend already hides the button" as authorization.
- Tokens in browser storage without justification.
- Sanitizer bypass or raw HTML with user content.
- Catch-all handlers that swallow auth or validation failures.
- Wildcard CORS with credentials.
- Logging full request bodies or headers.
- Rotating a leaked secret "later".
- Approving dependency install scripts without reading them.
- Allowlisting destructive commands for the agent to save prompts.

## References
- OWASP Top 10 (2021) — owasp.org/Top10
- OWASP API Security Top 10 (2023)
- OWASP ASVS — owasp.org/www-project-application-security-verification-standard
- OWASP Cheat Sheet Series — cheatsheetseries.owasp.org
- NIST SSDF SP 800-218 · ISO/IEC 27001:2022
- STRIDE threat modeling (Microsoft)
- Framework security guides: `../waymark/stacks/<stack>.md` → *References*
