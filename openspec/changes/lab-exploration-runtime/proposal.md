## Source Task

- Task: USER-2026-11-02 — implement observation-only runs, richer transports/data and state exploration, repeatable environments, and a shared adapter budget.

## Why

Unknown expectations currently require a separate reporting path. Non-HTTP actions and replay preparation rely on project-specific manual controls. Add executable mechanisms while keeping existing approved-rule runs and portable regressions compatible.

## What Changes

- First-class observation-only runs and scenarios with no fabricated rule IDs or business verdicts.
- Multipart/binary uploads with portable fixtures; richer seeded data; bounded state graph exploration and failure-preserving sequence reduction.
- Shared durable admission/completion protocol for HTTP and native adapters, with a single deadline, operation cap, concurrency cap and uncertain-action reporting.
- Shell-free lifecycle recipes, isolated RSA Compose preparation, fresh identities and owned-resource cleanup; configurable source and dependency paths.

## Capabilities

### New Capabilities

- `exploration-runtime`: executable exploration, shared action accounting and repeatable environment lifecycle.

## Impact

Node 22 standard library only. Existing runs keep their original deadline and request cap. Historical evidence stays unchanged. Real RSA replay still requires application source checkouts, compatible Docker images and registry access.
