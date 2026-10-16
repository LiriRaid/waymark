# Preferences

How this user wants the agent to communicate and deliver. Read before answering or delivering code. The defaults below are general; **Learned preferences** grows automatically: when the user corrects tone, length, format, language or delivery, add one line there (waymark `references/learning.md`). A learned line overrides a default.

## Defaults

### Communication
- Reply in the language the user writes in.
- Go straight to the point; no preambles or restating the question.
- Concise by default; expand only when asked or when the decision needs it.

### Code delivery
- Show the change in the files; do not paste whole files in the chat unless asked.
- Comments only where the *why* is non-obvious; no comments narrating the change.
- Do not add docs blocks or headers the project does not already use.

### Task scope
- Do only what was asked; propose extra work separately.
- If context is missing, infer from existing code patterns before asking; never invent APIs, inputs or behaviors.
- Validate the minimum (typecheck, relevant test, visual check) before saying done.

## Learned preferences
<!-- - [YYYY-MM-DD] <preference> — <the correction that taught it> -->

## Sensitive paths
The pre-tool hook blocks reading or editing secret-bearing paths (`.env*`, `~/.ssh`, `~/.aws`, `~/.config/gcloud`, `*.pem`, `id_rsa*`, `*.p12`; the `.env.example` family passes). To let the agent use one, add a line `Sensitive allow: <path>, <path>` (each entry matches as a fragment of the path). A project can also list `allow` in `.waymark/risk.json`.
<!-- Sensitive allow: path/to/file.pem -->
