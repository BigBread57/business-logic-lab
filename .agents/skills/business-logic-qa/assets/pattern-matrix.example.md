# Per-function pattern and hypothesis matrix

Status: draft. Library version/review date: fill from references/patterns.md. Link this artifact from test-plan.md.

## Selected functions

| Function ID | UI/API entry points | Source pointers: contract, implementation, state/ownership | Actors/data | Risk and dependencies |
| --- | --- | --- | --- | --- |
| F-upload | Project-specific | Pending inspection | Task-derived | Binary upload executor needed if applicable |
| F-move | Project-specific | Pending inspection | Two accounts/shared object if relevant | Version and hierarchy semantics |

## Baseline applicability and execution

Repeat this section per selected function. Consider every ID P01–P20; group rows only if each ID and its rationale remain identifiable. Empty cells are unresolved work, not proof of non-applicability.

| Function | Pattern IDs | Applicable / not-applicable / unknown | Rationale + source | Concrete scenario IDs / oracle or gap | Priority | Planned / executed / blocked / deferred | Evidence or reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F-upload | P11 | unknown | Inspect route and accepted formats | Valid control + format/type/content variation; oracle pending | Task-derived | blocked | Adapter availability not yet established |
| F-move | P07 | unknown | Inspect shared writes and version fields | Common-object competing moves; semantics pending | Task-derived | planned | No execution evidence yet |

## Hypotheses derived beyond stock examples

| ID | Function | Origin: project / observation / combined | Source or parent observation | Assumption and experiment | Oracle: approved rule / contract / open question | Scenario/evidence or disposition |
| --- | --- | --- | --- | --- | --- | --- |
| H-1 | F-move | project | Actual subtree/read-model update code | Determine which descendants/projections must agree after a move, then exercise the affected ones | Pending agreement where necessary | Not executed |

If no extra hypothesis is supported, record inspected sources and why; do not fabricate novelty. Preserve new observations and the experiments they motivated as linked entries.

## Coverage closeout

- Functions and baseline IDs reviewed; unknown applicability remaining:
- Concrete valid/invalid/boundary/sequence/concurrent scenarios generated:
- Baseline versus project-/observation-derived cases executed:
- Blocked tooling/access, budget deferrals, unsupported oracles:
- Observed outcomes, effects, repeatability and replay paths:
- Proposed reusable lessons (unconfirmed items remain proposals):

Matrix completeness is a planning/review obligation of the agent. Current helper scripts do not parse or enforce this Markdown matrix, and a complete matrix does not prove exhaustive test quality.
