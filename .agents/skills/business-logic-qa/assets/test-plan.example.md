# Test plan — fill before starting the run

Status: draft; replace illustrative assignments with those derived from the actual task.

## Task and settings

- Requested outcome and functionality:
- Included workflows/services; exclusions and reasons:
- Approved knowledge version and applicable rule IDs:
- Environment, allowed resources/data and existing user authorization:
- Budget: 20 minutes unless overridden; shared run deadline assigned at init:
- Team: coordinator plus task-derived worker count, within host/configured limits:
- Evidence/run directory:
- Campaign directory, stable scenario IDs and discovery roots:
- Source/deployment/dependency versions and snapshot artifact:
- Environment retention policy and named readiness/persistence probes:
- Missing decisions or coverage limitations:
- Per-function pattern/hypothesis matrix path (start from pattern-matrix.example.md):

## Application roles and worker assignments

| Worker | Testing perspective | Application role | Account / isolated session | Functionality / object scope |
| --- | --- | --- | --- | --- |
| worker-a | Concurrent claim | Operator | operator_a / session-a | Same selected item as worker-b |
| worker-b | Concurrent claim | Operator | operator_b / session-b | Same selected item as worker-a |
| worker-c, if relevant | Ownership/access | Supervisor | supervisor_a / session-c | Task-selected supervisory operation |

Role matrix source and verified account setup:

## Scenario queue

| Case | Class | Actors and starting state | Action / contract deviation | Expected outcome / approved invariant or gap | Evidence and completion observation |
| --- | --- | --- | --- | --- | --- |
| control | Valid workflow | Task-derived | Normal operation | Approved rule | UI/API plus applicable state/events |
| concurrent | Same-role concurrency | operator_a + operator_b, shared object | Same operation after preparation barrier | Task-derived final-state invariant | Dispatch/overlap and final state |
| boundary | Boundary | Task-derived | At limit and just outside | Contract source or explicit gap | Response and side effects |
| unexpected | Invalid sequence | Task-derived | Skip/reorder/repeat a step | Approved rejection/normalization or gap | Partial state and downstream effects |

Synchronization method, overlap evidence and scheduling limitations:
Other relevant boundary/invalid classes, or reasons for omission:

## Generated inputs and repeated exploration

- Conformance rules vs oracle-free hypotheses:
- Structural schemas and semantic fixture prerequisites:
- Generator/factory, seed/version and concrete dataset/ID output paths:
- Variants/repetitions per selected function, sequence lengths/order and concurrency schedules:
- Deliberate invalid/boundary inputs, distinguished from valid generated controls:
- Planned versus achieved coverage and budget-limited omissions:
- Action-history paths, UI/HTTP causal correlation and post-run domain analysis:
- New hypotheses from code assumptions/observations and their source pointers:

## Load assignment

- Responsible worker(s) and load tool:
- Operation mix, role/account distribution and test data ownership:
- Iterations or rate, concurrency and duration:
- Aggregate HTTP/native-operation bounds across all workers/tools:
- Business invariants under load, metrics and stop conditions:
- Fault actions, if permitted; otherwise record unavailable coverage:

## Dispatch and resume

- Charter/result path per worker:
- Shared resources for concurrency vs independent data namespaces:
- Checkpoint and uncertain-operation reconciliation:
- Execution intent/result IDs, explicit remaining obligations and finalized artifact IDs:
- Worker completion records and final reconciliation gate:
- Existing permissions sufficient, or unresolved required decisions:
