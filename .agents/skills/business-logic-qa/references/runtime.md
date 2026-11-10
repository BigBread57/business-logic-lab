# Executable exploration runtime

Use this reference for observations without an oracle, file uploads, state search, adapter budgets and repeatable environments. Scripts are relative to this skill. Node 22+; no npm dependencies.

## Observation-only runs

`qa.mjs init --mode observation --config profile.json --out runs/new` needs no knowledge or approval. Each scenario has `mode: "observation"`, a nonempty `question`, HTTP `steps`, and no rule IDs or assertions. A completed scenario returns `observed`; transport/precondition failures remain blocked/inconclusive. Captures are allowed. Observation scenarios also work inside an approved conformance run. Independent approved invariants belong in separate conformance scenarios.

`journal` accepts `{id, mode:"observation", question, outcome:"observed", summary, attachments:["evidence.txt"]}`. Attachments must already exist within the run. Observation records cannot claim business pass/violation, checks or rule coverage; confirmation and defect regression generation require an approved violation. Reports include an `observations` array and ordinary evidence links, including unanswered questions. Observation-only manifests contain empty knowledge and no approval; use a new conformance run after agreement.

## Shared action protocol

The existing `max_requests` is the shared total operation cap for all cooperating transports. Optional `max_actions` can lower it; the smaller cap wins. All share `max_parallel`, `request_timeout_ms` and the run deadline. `requests` remains a compatibility alias; report fields `operations`, `by_transport`, `actions`, and `uncertain_actions` show actual admitted operations. Historical independent meters are not retroactively combined.

Declare exact adapter resources and allowed permissions in the profile:

```json
{"adapters":{"database":{"transport":"db","resources":["lab-database"],"permissions":["read","mutate"]}}}
```

Permissions must also appear in the profile's top-level permissions. Supported adapter transports: browser, kafka, db, native. Use named actors from the profile. SDK example:

```js
import { performAction } from './qa.mjs';
const rows = await performAction(run, {
  id: 'lookup-001', adapter: 'database', actor: 'author',
  resource: 'lab-database', permission: 'read', operation: 'select-object'
}, async ({ signal, lease }) => client.query({ signal, deadline: lease.deadline }));
```

The client must support cancellation or otherwise stop itself at the supplied deadline. Each callback performs one primitive operation. Instrument every publish, query, poll, browser navigation or other chosen action separately. Avoid nesting lease-taking callbacks at concurrency one. A UI action and the HTTP request it causes are distinct primitives if both are instrumented; define that accounting in the plan.

For other languages/tools use `action-begin --run RUN --action action.json --out lease.json`, execute the one admitted operation, then `action-complete --run RUN --lease lease.json --result receipt.json`. Receipts use `status: completed|failed|uncertain`, optional summary and relative evidence attachments. `failed` means execution is known to have stopped; an accepted mutation with unknown effects is `uncertain`. `beginAction` and `completeAction` are also exported. Admission is persisted before returning the lease; lease tokens are hashed in the meter. Completion cannot be submitted twice.

`performAction` marks exceptions/timeouts uncertain. Unknown actions retain their active slot and consumed count across restarts. Reconcile target effects using IDs/readback, save evidence, then call `action-reconcile --run RUN --id ID --record record.json` with an evidence-backed summary and attachments. Reconciliation releases the slot, preserves the admission and never refunds the count. It remains possible after deadline. A process killed while holding `meter.lock` requires explicit investigation of that interrupted writer before removing its lock.

Folder UI/API proxy supports `QA_PARENT_RUN=/absolute/run`: its control run ID and deadline must match the parent manifest; actor names must match the parent's actors and target `api` must point at the real upstream. Its admitted HTTP requests join the parent's meter. Legacy mode remains for historical replay. Legacy Python RSA harnesses retain their own counters: migrate their primitive operations through this protocol before claiming a unified run; do not count an entire harness invocation as one request.

This is cooperative admission, not isolation of arbitrary shell, browser or DB clients. Persist business observations through `journal` or scenarios separately from transport receipts.

## File requests

Configure `upload: {"root":"./fixtures", "max_bytes":1048576}` in the profile. The root resolves relative to the profile when initializing a run. Each upload path must resolve to a regular file under that root; external symlinks, oversized totals and mismatched optional SHA-256 hashes are blocked before admission. Uploads support POST/PUT/PATCH and replace JSON body.

```json
{"target":"api","actor":"author","method":"POST","path":"/documents","upload":{"type":"multipart","fields":{"description":"Synthetic fixture"},"files":[{"field":"file","path":"sample.csv","filename":"sample.csv","content_type":"text/csv"}]}}
```

Use `upload: {"type":"binary","path":"sample.csv","content_type":"text/csv"}` for a raw body. Evidence stores metadata, field values, size and SHA-256; file bytes remain in fixtures. Multipart boundaries are generated by the platform; the size cap includes fields and framing. Limit: 100 files and profile cap up to 64 MiB. Use synthetic files: binary data is copied verbatim into generated regressions and cannot be automatically redacted.

Portable regressions copy each file under their own `.fixtures/uploads`, preserve hashes and use a relative fixture root. They keep the original assertions and capture templates and require matching bytes on replay. Parent-budget verification copies the portable fixtures into the dedicated run/uploads namespace and uses source: run; paths remain confined to that directory. A changed source fixture must not silently replace the original failing input.

## Data generation and state search

`explore.mjs sample` adds standalone `const`, standalone `anyOf` branches, array `uniqueItems` and object `dependentRequired` to the documented subset. Constants are cloned, dependencies are closed transitively, uniqueness uses JSON-value equality. Seeds reproduce concrete output. Unsatisfiable uniqueness or excessive generation fails within a finite node/attempt cap. Unsupported keywords still fail; this is not full JSON Schema/OpenAPI or semantic fixture inference.

`search.mjs paths --model model.json --depth 4 --limit 100 --out paths.json` enumerates bounded legal transition sequences, including cycles/repeats. Model fields: `initial`, named `states`, `transitions` with unique `id`, `from`, `to`. Output contains selected paths, enumerated model states/transitions and explicit truncation. Limits: depth 30, paths 10000; enumeration is bounded breadth-first search over a supplied model.

For `search.mjs run --run RUN --model model.json --out NEW_DIRECTORY --depth 4 --limit 30 --shrink-trials 50`, add executable `steps` to transitions, a full conformance `reset` scenario with baseline assertions, and a `probe` scenario with the original business assertions. The profile must permit reset and every HTTP operation. Provide captures/readbacks to verify semantic preconditions and state changes; declared graph edges alone are not evidence of actual server states. Reset gets a fresh experiment ID before every trial and reduction attempt. Search actions share the parent budget; expired/exhausted/blocked execution stops with persisted partial results.

On an observed violation the reducer first replays the original, then removes chunks of transitions. A candidate is retained only when it follows a legal path and reproduces the same failed rule/path/operator/expected-value signature. Inconclusive candidates are rejected; blocked candidates stop reduction. Reports retain the original evidence, all trial inputs, reset IDs, reduction outcomes, replay JSON and budget stops. Replay includes reset and the original probe. A completed reduction is deletion-minimal for that model/signature and evaluation schedule, not a proof of globally smallest input or deterministic remote concurrency.

`minimizeSequence` is exported for native adapters: supply an evaluator returning `outcome` and a stable `signature`, a deadline, finite `max_trials`, and an `onTrial` persistence hook. The evaluator must reset and instrument each primitive operation. It can reduce action sequences or arrays of input chunks; binary-aware and transaction-schedule-specific reduction requires the domain adapter.

## Environment lifecycle

For persistent environments use [retention and diagnostics](environments.md). A recipe with `retention: "preserve"` retains resources on setup/callback failure and refuses explicit cleanup. Doctor/start/stop/snapshot/resume are project-command phases; an unconfigured diagnostic is unavailable. Default ephemeral behavior below remains compatible.

`lifecycle.mjs prepare --recipe recipe.json --out NEW_DIRECTORY` executes a trusted recipe's `prepare` argv commands and saves `environment.json`, command status and redacted logs. Each command needs a unique `id`, `argv`, finite `timeout_ms` (up to 10 minutes), optional absolute cwd and env references. `${session}` and `${namespace}` resolve to a fresh private session and generated `bll-UUID`; `${env:NAME}` references an existing variable. Commands run without a shell. Recipes are executable user/project instructions, not a sandbox.

`cleanup --session DIRECTORY` executes the saved cleanup argv commands, skips completed cleanup steps and retains failures for retry. Setup failures automatically attempt cleanup. Exported `withEnvironment(recipe, dir, fn)` always cleans up after the callback. Setup is never silently resumed/restarted over an existing directory. An interrupted active command needs reconciliation; cleanup remains available independently of QA deadlines. Keep external credentials in referenced environment variables, and make cleanup commands idempotent and scoped to the generated namespace.


## Campaign and native clients

Use [campaign workflow](campaigns.md) across runs and versions. [Injected adapters](adapters.md) reuse action admission; native-only profiles may omit HTTP targets/origins when they declare adapters. Fault operations require `fault` permission separately from ordinary mutation. [Native test artifacts](test-artifacts.md) retain exact cases, skips, commands and versions.

An interrupted experiment claim is distinct from a transport action. After independent readback, `claim-reconcile --run DIR --id CLAIM --record FILE` records `result_id`, evidence-backed `summary` and `attachments` pointing to an existing reconciliation observation. The original claim is retained and reconciliation remains available after deadline. Transport effects use `action-reconcile`.
