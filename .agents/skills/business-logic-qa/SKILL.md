---
name: business-logic-qa
description: Explore and verify business workflows across roles, APIs, UIs, workers and services; maintain durable campaigns, investigate sequences and failures, collect evidence and produce reconciled reports and regressions.
---

# Business Logic QA

Use the helpers in scripts/; their --help defines CLI options. Preserve the user's scope, environment, authorization, time, retention and team preferences. The workflow is application-independent; project examples illustrate mechanisms, not required infrastructure.

## Choose the route

- First run: read [knowledge](references/knowledge.md), [planning](references/planning.md) and [patterns](references/patterns.md). Inspect relevant contracts, code and tests; record source-linked expectations or explicit unknowns before execution.
- Sustained work, several runs or workers: use [campaign workflow](references/campaigns.md). Create stable scenario IDs, register runs with actual versions and save remaining obligations. Keep each run's original deadline.
- Resume: generate campaign context and reconcile uncertain effects before selecting the next case. Read historical evidence only for the selected work or accounting issues.
- Changed version: capture source/deployment/dependency state, review impacted scenarios and give regressions new execution IDs. Preserve defect history and verify fixes against original expectations.
- Final report: follow campaign reconciliation and [results](references/results.md). Include all registered work and explicit unfinished, blocked and excluded coverage.

## Expectations and scope

Obtain agreement for proposed business rules before conformance testing. Existing agreement persists; changing knowledge invalidates its saved approval. Record unknown rules as questions and continue independent observation-only scenarios. Code can suggest a hypothesis but does not automatically establish correct business behavior.

Derive roles, accounts, fixtures, worker count, concurrency and load from the task. Default budget is 20 minutes unless overridden. Preparation precedes the run clock; actions and session execution consume it. Ask only for missing decisions that block authorized work.

For each selected function maintain applicability and coverage of common patterns, then derive additional hypotheses from contracts, code and observations. Record non-applicability, unknowns, blockers and deferrals separately. Explain the novelty of new work or the reason for a repeat.

## Execute and checkpoint

1. Check the environment and versions. Use [retained environments](references/environments.md) for project-supplied doctor/start/stop/snapshot commands. Existing resources and requests to retain data require preserve policy. Missing checks are unavailable coverage.
2. Read [execution](references/execution.md) and [runtime](references/runtime.md) for exact resources, shared limits, admissions and uncertainty. HTTP scenarios use qa.mjs; native clients use [adapters](references/adapters.md) or the shared action protocol.
3. Record execution intent before effects. Use fixtures with stable correlation and concrete saved inputs. For asynchronous workflows read [interservice](references/interservice.md); for varied inputs and action sequences read [exploration](references/exploration.md).
4. Observe actual business effects through the applicable UI/API/state/events. Save before/action/after evidence, exceptions and uncertainty immediately. A response code or elapsed observation window alone does not prove the business outcome.
5. Keep expectations fixed. Save violations, contradictions and unknown outcomes; continue independent work. Separate severity, confidence and reproducibility. A single recorded race can establish a violation.
6. Confirm supported findings and create/execute applicable regressions before finalizing execution evidence. Preserve generated-unrun obligations. Do not change application code or publish CI changes as part of QA without authorization.
7. Finalize the execution with result IDs and remaining work; register finalized artifacts and refresh campaign context/report. Capture native suites using [test artifacts](references/test-artifacts.md), including skips and missing coverage.

## Delegate bounded work

When delegation is available and useful, assign independent perspectives with scenario IDs, applicable rules, isolated account/session and namespace, shared run limits, deadline and result path. Use explicitly shared objects and observable synchronization for concurrency experiments. Give workers compact charters instead of the full exploration history. Persist each worker handoff; the coordinator reconciles and reports the combined history. If delegation is unavailable, execute sequentially and record that limit.

## Finish

Reserve the final part of the budget for in-flight reconciliation, reports and regression status. Generate the report from persistent results; the reconciliation gate detects unassigned sources and unfinished work. Preserve partial reports when the gate fails. Completion means evidence and remaining obligations are accounted for, not that all functionality is proven correct.

Honor retention on success, failure and interruption. Snapshots are state records, not external-data backups. Missing access/tools remain blocked coverage. Plugin/CLI tools are preferred; for GitLab use glab.
