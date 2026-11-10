# Business Logic Lab v1

## Source Task

- Task: `business-logic-lab-v1` — user-approved specification at docs/design/specification.md, this chat, 2026-10-22.

## Why

Codex needs a repeatable way to explore documented business processes across roles and services without losing evidence or treating existing code as the source of correctness.

## What Changes

- Add a repository-scoped skill for knowledge preparation, approval, coordinated exploration and regression generation.
- Add dependency-free Node scripts for validated profiles, approved-knowledge snapshots, deadlines, HTTP experiments, persistent results, reports and runnable regressions.
- Prepare a source-cited knowledge draft for speech-analytics, raw-data-consumer and OpenSearch. Live checks require approved business rules and a configured local/dev target.

## Capabilities

### New Capabilities

- `business-logic-qa`: evidence-based, resumable QA of business rules across users and services.

## Impact

Changes stay in this project. No application fixes, pipeline publication, production runs or global configuration changes are part of QA. Real-project rule approval and unavailable live environments remain explicit prerequisites rather than fabricated verification.
