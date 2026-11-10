# Task-driven test planning

Before every QA run, resolve testing settings through the agent and save `test-plan.md`, starting from [the template](../assets/test-plan.example.md). Derive them from the user's initial task and approved project knowledge. Reuse explicit preferences and permissions; present the resolved settings before execution. Ask for missing required scope, access or business decisions; routine choices within existing authorization do not need another approval. An unspecified business oracle becomes a documented gap. The run clock starts after knowledge agreement and planning; session setup and execution consume the run budget.

## Scope and assignments

Choose the functionality, workflows, services and role combinations needed to test the requested outcome. Determine how many distinct application roles, independent accounts and agent workers are useful; these are separate counts. Respect configured worker limits, available accounts and the host's capacity. State any substitutions or unavailable combinations before dispatch.

Assign each worker a testing perspective and explicit application role/account bindings. A worker can operate several accounts when the task requires it. Several workers can have the same application role, each with a separate account and session. Derive permissions from the approved role matrix and actual account setup, rather than inventing privileges. Credentials remain in the host's secret store/environment.

For same-role concurrency, assign at least two independent accounts to the same operation and deliberately shared business object. Specify starting state, preparation barrier, coordinated dispatch, completion observations and the shared final-state invariant. For example, two operators attempt to claim one unassigned item; the permitted owner count follows the agreed process. Launching agents at the same time is insufficient evidence of overlapping transactions. Record observed overlap or the scheduling limitation. Check distinct-role interactions where relevant, including ownership and forbidden actions.

Record load as a worker responsibility: operation mix, account/role distribution, iterations or rate, concurrency, duration, total request/native-operation limits and stop conditions. Several same-role users may generate load while other workers inspect business effects. Choose HTTP helper or a project-native k6/Locust/broker tool as appropriate. Share one run deadline and aggregate limits across all workers and load tools; a worker never receives its own full copy of the global allowance. Report achieved load and business invariants alongside errors and latency.

## Explore beyond the documented path

Use [the source-linked baseline and derivation workflow](patterns.md) and [per-function matrix](../assets/pattern-matrix.example.md). Review common risk patterns for each selected function and inspect actual implementation assumptions for additional cases. Link that matrix from the plan; list applicability separately from whether a scenario ran. Keep source-derived business hypotheses distinct from approved expectations.

For each selected workflow, add relevant boundary, invalid and unexpected-action hypotheses alongside valid controls. Select from:

- Numeric limits and just-outside values; zero, negative, empty, missing, null, malformed and oversized inputs; date/time boundaries.
- Skipped steps, forbidden state transitions, reversed order, stale versions, actions after completion/cancellation and replay of old requests.
- Exact duplicates, repeated equal-content operations, conflicting concurrent updates, out-of-order events and repeated delivery.
- Other-role or other-owner object references, unauthorized field changes, direct API actions bypassing UI restrictions, and expired/absent sessions within the designated test scope.
- Partial completion, retries after uncertain responses, interrupted dependencies and recovery where the environment profile permits faults.

These are candidate experiments, not assumptions about the correct result. For every selected negative scenario specify the violated contract, expected rejection or allowed normalization from an approved source, and invariants that must survive. Check partial writes, balances/counts, identity, side effects and downstream events, not only HTTP status. Accepted unusual input can be correct; a guessed 400 response is not a business oracle.

For undocumented outcomes, preserve the input and observations as a process/contract gap, evaluate any independent agreed invariants and continue unrelated work. Deliberate misuse remains inside the selected local/dev resources, load and fault permissions. List omitted scenario classes with reasons rather than pretending every class was exercised.

## Ready to execute

The plan is ready when scope, role/account/worker allocation, scenario queue with oracles or explicit gaps, environment permissions, load limits, deadline and evidence paths are resolved. Validate the executable profile separately. Store this plan and a compact worker charter with the run artifacts; each charter links only its applicable rules, cases and settings. `test-plan.md` is an agent-managed artifact: the HTTP helper does not parse it or enforce its role assignments. Keep profile `actors` as credential references and put domain roles/assignments in this plan.
