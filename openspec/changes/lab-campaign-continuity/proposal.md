## Source Task

- Task: USER-2026-11-09 — implement the proposed QA product improvements, keeping contracts and instructions application- and transport-independent.

## Why

Independent runs do not provide a durable cross-run view of scenarios, findings, incomplete actions and version-specific evidence. Manual summaries lose traceability and make continuation expensive. Persistent environments also need an executable retention policy.

## What Changes

- Add campaign-level scenario and defect registries, immutable execution history, version-aware planning and compact continuation context.
- Generate campaign reports from registered runs with evidence/link checks, unassigned result detection and explicit reconciliation status.
- Add reusable client-injected adapters, exact message envelopes and correlated chain observations using the existing shared action budget.
- Extend lifecycle with preserve policy, diagnostics, snapshots, start/stop/resume and explicit ownership.
- Capture native test artifacts with exact case outcomes, skip reasons, commands and versions.
- Update generic skill workflows, examples and documentation without rewriting historical evidence or changing application services.

## Capabilities

### New Capabilities

- `campaign-continuity`: durable QA campaigns, report reconciliation and reusable execution support.

## Impact

Node 22 standard library; no new runtime dependency. Existing standalone runs remain supported. No production mutations, cleanup of historical resources, Git operations or publication are part of this change.
