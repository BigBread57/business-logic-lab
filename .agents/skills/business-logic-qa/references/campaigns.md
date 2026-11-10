# Campaign workflow

Use a campaign for sustained work, multiple runs, several workers, version changes or a consolidated report. The command and record contracts are in [campaigns](campaign-contracts.md). Run `campaign.mjs --help` from the sibling scripts directory for the CLI.

## First run

1. Resolve scope, authorization, retention policy and application-specific sources. Create the campaign and explicit discovery roots before dispatch.
2. Register stable scenarios: functionality, components, source/pattern pointers, expectation or unknown question, and remaining obligations. Use [planning](planning.md) for the initial plan and applicability matrix.
3. Prepare/check the environment. For existing resources or requested data retention use preserve; [environment recipes](environments.md) provide named project probes, start/stop and snapshots. Missing probes mean unavailable coverage.
4. Initialize a run with its own fixed deadline and shared limits. Register it with actual source/deployment/dependency versions.
5. Follow the execution loop below.

## Resume

1. Run `campaign.mjs resume --campaign DIR` and read context.md. Read historical reports only when an issue or selected scenario points to them.
2. Reconcile unfinished executions, worker handoffs and uncertain mutations by independent readback. Keep original claims and evidence; use claim/action reconciliation rather than deleting them.
3. Reuse an unexpired run only within its permissions and remaining budget. A user-authorized extension gets a new run; preserve previous deadlines.
4. Pick one queued scenario and state its novelty. Keep blockers and unknown expectations visible while continuing independent work.

## Changed version

1. Capture checkout state, lock/config hashes, installed dependencies, runtime versions and deployed image/schema identifiers as applicable. Verify that the running environment uses the intended versions.
2. Supply component versions to `plan/resume --versions FILE`. Review the proposed impacted scenarios against actual changed contracts and code; component links are an aid, not exhaustive impact analysis.
3. Give justified regressions new execution IDs and keep historical finding observations. A fix claim alone does not resolve a defect.

## Execution loop

1. Select a new/unfinished case or explain a justified regression. Resolve its oracle or explicitly use observation mode.
2. `execution-begin` before external effects. Assign bounded worker charters with scenario IDs, namespace/session, shared run, rules, deadline and result path when delegation is supported and appropriate.
3. Execute primitives through the shared runtime or [native adapters](adapters.md). Save exact fixtures, correlations and before/after readback. Read [interservice](interservice.md) for asynchronous chains.
4. Save a result immediately. Confirm evidence-backed violations and create/verify applicable regressions before finalizing its execution; keep generated-unrun regressions explicit.
5. `execution-finish` links result IDs and remaining obligations. Empty remaining requires an explicit completeness decision. Register finalized native test, chain, environment and source artifacts.
6. Refresh campaign context/report after each scenario or worker batch. Unknown effects consume operations and require reconciliation before replay.

## Finish

1. Stop admitting new actions before the deadline and account for in-flight work.
2. Finish worker handoffs, register all runs/applications and inventory discovery roots.
3. Generate the campaign report with `--require-reconciled true`. If it fails, retain the partial report and resolve accounting issues without rerunning mutations blindly.
4. Report passed conditions, current/historical defects with versions, unresolved rules, incomplete tests, exclusions and environmental limits. Reconciled does not mean exhaustive or all passed.
5. Follow the selected retention policy. Snapshots describe state; they are not backups of external data.
