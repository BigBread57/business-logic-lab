# Evidence, reports and regression

For cross-run work use the [campaign contracts](campaign-contracts.md). Register every run and finalized application/test/chain artifact. The generated report includes unassigned sources, unfinished work and version-specific finding history; `--require-reconciled true` refuses a clean reconciliation claim while saving a partial report. Reconciliation is independent of pass/fail and exhaustive coverage.

`report --run <dir>` reads persisted experiment files and produces `report.md` and `report.json`. Coverage is per approved rule: a pass in one scenario is scenario evidence, not universal proof. Include failed/blocked/inconclusive cases, untested rules, run deadline, uncertain claims and documentation gaps. Outcomes and confidence are independent fields.

Keep request method, sanitized URL, status, timestamps and bounded sanitized response data. Attach browser screenshots/traces, event identifiers and code/document source locations. Evidence paths must exist under the run. Use actual data and no credentials; scrub sensitive body fields before journaling externally produced files. The helper sanitizes structured records and configured secret values, but cannot scrub arbitrary binary attachments automatically.

Link the resolved test plan and report actual application roles/accounts, worker assignments, achieved load, concurrency overlap and untested combinations. Distinguish valid-path, boundary and intentional contract-deviation coverage. An unknown negative-case expectation stays a gap; report independently violated approved invariants separately.

Include per-function pattern coverage and project-/observation-derived hypotheses from the plan's matrix. Preserve non-applicability reasons separately from unexecuted applicable cases. Unknown applicability, missing adapters and budget deferrals stay visible. Pattern IDs describe where ideas came from; they are not business rule IDs and do not by themselves authorize a pass/fail verdict.

For a violation, reproduce on isolated data when possible. Confirmation is a coordinator decision supported by evidence, not a hardcoded requirement for two identical runs: a recorded single occurrence can establish a race violation, while a vague assertion cannot. `confirm` requires an evidence-backed rationale. It does not change the actual result.

`regression --run <dir> --id <experiment> --out <file.test.mjs>` emits an executable Node test for confirmed HTTP findings. The generated test reuses saved scenarios, approved knowledge and profile, resolves credentials from the environment and compares against original assertions. It fails while the defect remains. Use a fresh isolated environment/data namespace; never auto-replay dev mutations without the profile permitting them.

For UI, Kafka and other external findings generate a native test using the target repository's existing test harness and fixtures, save it under `regressions/`, execute its exact command and journal the status. Use stored evidence, approved assertions and the native transport. A human-only replay document is not a regression test. The HTTP generator refuses unsupported external scenarios rather than pretending they are covered. If dependencies/access/time prevent execution, record the test as unverified and leave the obligation open.

Use `verify-regression --run <dir> --id <experiment>` to run a generated HTTP regression and persist its status/log. This helper shares the parent's request limits and remaining deadline; standalone `node --test` creates a fresh run for CI. Rerender the report after verification. A failed test establishes only that its approved assertion or execution precondition failed: inspect the saved replay result to distinguish a retained defect from unavailable credentials or infrastructure.

CI publication is separate from creating a runnable test. Retained defects must fail; do not rewrite expected behavior, skip or quarantine them to obtain green checks. For probabilistic concurrency checks report scheduling limits and observed replay rate; seed alone does not control remote transaction ordering.

The [runtime contracts](runtime.md) add explicit observation records, per-transport action receipts, uncertain leases and upload fixtures copied into portable regressions. Transport completion is separate from a business verdict; report both experiment claims and uncertain actions.
