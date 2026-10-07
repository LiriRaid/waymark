# Consult mode (questions)

Part of the `waymark` core skill. Read when the request is a question (level Q).


Questions also go through Waymark, read-only:
1. **Recall** — project memory and memory MCP: answered before? Reuse and say so.
2. **Route** — load the department that owns the topic (endpoint → `dept-backend`, "dónde va esto" → `dept-architecture`, "por qué falla" → `dept-qa`…); use its Rules and Tools to know where to look.
3. **Ground** — search the code and cite `file:line`; library behavior via `library-docs`; never answer from memory of a library or from guesswork. Unverifiable parts are stated as such.
4. **Answer** — start with `Waymark → Q · <dept>`; no gates, no `## Cierre` unless something was learned.
5. **Learn** — if it took real investigation, put the answer in the Cierre's Aprendido (the hook saves it to engram) so next time it is a lookup.
