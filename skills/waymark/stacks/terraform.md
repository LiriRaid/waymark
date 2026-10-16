# Stack: Terraform (OpenTofu)

Generated from `templates/stack.template.md` for the external corpus (docs/adr/0027); the commands come from the Terraform CLI documentation, not yet from a live task: verify each once and record it in project memory. `tofu` replaces `terraform` where the project uses OpenTofu.

## Detect
Signals the agent checks (waymark `references/project-detection.md`): `*.tf` files at the root or under `modules/`, `.terraform.lock.hcl`, `versions.tf` (`required_version`, `required_providers`), `terraform.tfvars` or `*.tfvars`. A module repository has `main.tf`, `variables.tf`, `outputs.tf` and an `examples/` folder.

## Commands
Default commands the agent runs in the Exit protocol; verify each once, then record it in project memory.

| Gate | Command | Notes |
|---|---|---|
| typecheck | `terraform validate` | Needs `terraform init -backend=false` first; no cloud credentials |
| lint | `terraform fmt -check -recursive` | `terraform fmt -recursive` fixes; add `tflint` when `.tflint.hcl` exists |
| test | `terraform test` | Terraform 1.6+ and a `tests/` folder of `.tftest.hcl`; skip when there are none |
| build | none | `terraform plan` needs credentials and state: never a gate, run only when the user asks |
| format | `terraform fmt` | Not a gate |

Project memory example (Quality gates, verified commands):

| Gate | Command | Verified |
|---|---|---|
| typecheck | `terraform init -backend=false && terraform validate` | <date> |
| lint (changed files) | `terraform fmt -check {files}` | <date> |
| test (full) | `terraform test` or `none (no .tftest.hcl)` | <date> |
| build | `none (infrastructure is planned, not built)` | <date> |

## Conventions by department
Only what is specific to Terraform. General rules live in the `dept-*` department skills.

### Frontend / Backend
- A module has one purpose: `variables.tf` (typed, described, validated), `outputs.tf`, `main.tf` (or one file per concern), `versions.tf` (pinned `required_version` and provider constraints). No provider blocks inside reusable modules.
- Names are `snake_case`; resources of one kind use `this` when a module creates a single one. Use `for_each` over `count` when items have identities.
- Never change a resource address without a `moved` block; a rename is a state operation, not an edit.

### Testing
- `terraform validate` and `fmt -check` on every change; `.tftest.hcl` with `command = plan` for logic and mocked providers for module behavior; `examples/` must still validate.

### Data & state
- State is remote and locked; never edit it by hand, never commit it. Secrets are never in `.tfvars` that is committed; mark `sensitive = true` on variables and outputs.

### Security
- No credentials in code or variables files; least-privilege IAM; scan with `trivy config .` or `checkov` when the project uses them. A plan that destroys or replaces is shown to the user before any apply; apply is never run by the agent.

## Tools
| Capability | Provider | Type |
|---|---|---|
| docs | `library-docs` (Terraform language, provider registry) | skill |
| lint | `tflint` | CLI |
| security scan | `trivy config` / `checkov` | CLI |

## Architecture fit
- `layered` by lifecycle: `modules/` (reusable), `environments/<env>/` or workspaces (compositions), `examples/` (usage). Dependencies point from environments to modules, never the other way.

## Anti-patterns
- Running `apply` or `destroy` from the agent; editing state; `-target` as a habit.
- Provider configuration or hard-coded regions inside a module; unpinned provider versions.
- Wide `count` toggles that change addresses; copy-pasted resources instead of a module.
- Secrets in plain variables or outputs.

## Official docs
- Terraform language: https://developer.hashicorp.com/terraform/language
- CLI commands: https://developer.hashicorp.com/terraform/cli
- Tests: https://developer.hashicorp.com/terraform/language/tests
- Style guide: https://developer.hashicorp.com/terraform/language/style
- Registry: https://registry.terraform.io
- TFLint: https://github.com/terraform-linters/tflint
