## Source Task

- Task: `business-logic-lab-v1` — user-approved specification at docs/design/specification.md, this chat, 2026-10-22.

## ADDED Requirements

### Requirement: Approved knowledge and configured scope
The system SHALL preserve source-linked rules, require an approved knowledge snapshot for execution, and validate configured targets, actors, permissions and time/load bounds.

#### Scenario: Knowledge changes after approval
- WHEN a rule bundle changes after approval
- THEN execution refuses that approval and requests a new agreed version.

### Requirement: Cross-role and interservice execution
The skill SHALL explore UI and API, read code for hypotheses, use isolated actors, correlate cross-service evidence and evaluate eventual results against agreed windows.

#### Scenario: Consumer indexing becomes visible through search
- WHEN a scoped operation is accepted by raw-data-consumer
- THEN the scenario can correlate its identifier through OpenSearch and speech-analytics within a bounded observation window, or report unavailable observations explicitly.

### Requirement: Task-derived settings before execution
The agent SHALL derive functionality, application roles, account allocation, worker count, load responsibilities and scenario scope from the initial task, resolve settings before starting the test budget, and persist a test plan. Existing user settings and permissions SHALL be reused; missing required decisions SHALL be clarified. Worker perspectives, application roles and accounts SHALL be recorded separately. The Markdown plan is agent-managed rather than enforced by the HTTP helper.

#### Scenario: Multiple workers share one application role
- WHEN the task requires concurrent execution of the same operation by equal-rights users
- THEN the plan assigns independent accounts/sessions with the same role to workers, an explicitly shared object, a preparation barrier, observations of overlap or scheduling limitations, and the agreed final-state invariant.

#### Scenario: Load across several workers
- WHEN multiple workers generate load
- THEN their assignments specify operation mix, account/role distribution, concurrency, duration, aggregate operation bounds and stop conditions under one shared deadline.

### Requirement: Boundary and deliberate contract-deviation exploration
The agent SHALL generate relevant boundary, invalid-sequence, malformed-input, ownership and concurrency hypotheses beyond documented valid paths for each selected workflow, and record omitted classes with reasons. Expected rejection or normalization SHALL come from approved sources; unknown expectations SHALL remain gaps while independent invariants are evaluated.

#### Scenario: Undocumented invalid action
- WHEN an intentional contract deviation has no approved expected response
- THEN the agent records the input, observations and documentation gap, checks any applicable approved invariants and continues independent scenarios instead of inventing a business verdict.

### Requirement: Durable bounded orchestration
The system SHALL persist task outcomes and evidence independently of model context, enforce request timeouts within the run budget and preserve completed operations when resuming.

#### Scenario: Interrupted mutation
- WHEN an operation has an in-progress claim but no recorded result
- THEN automatic replay is refused until reconciliation instead of repeating a potentially completed mutation.

### Requirement: Reports and regressions
The system SHALL produce Markdown and JSON reports with coverage, gaps, evidence and replay metadata, and generate runnable tests with the original expected behavior for confirmed defects.

#### Scenario: Defect remains unfixed
- WHEN a generated regression test replays a confirmed violation
- THEN the test fails rather than accepting the observed incorrect behavior as expected.

### Requirement: Real-project validation
The implementation SHALL prepare a knowledge draft for the user-selected repositories and distinguish local tooling verification from live business-process validation.

#### Scenario: Business knowledge is not yet agreed
- WHEN code-derived draft rules have not been approved
- THEN the skill produces the draft and prerequisites and continues independent implementation without claiming live QA passed.

### Requirement: Generated inputs and recorded histories
The skill SHALL generate varied synthetic inputs satisfying structural and agreed semantic constraints, preserve concrete generated values and replay metadata, and vary sequences and repetitions within a shared budget. It SHALL durably record action intent, completion or uncertain outcome and observations with actor/role/session/correlation, and analyze cross-actor histories. Exploratory cases without approved business oracles SHALL remain observations rather than invented pass/fail.

#### Scenario: Partial or uncertain execution
- WHEN a generated action has started but no completion was observed
- THEN its history remains available as uncertain, and automatic mutation replay requires reconciliation.

#### Scenario: Generated valid and invalid inputs
- WHEN agents explore a function repeatedly
- THEN they preserve varying valid samples with dependencies and preconditions, distinguish deliberate contract deviations and report achieved coverage.

### Requirement: Source-linked patterns and project-derived exploration
The skill SHALL use a versioned source-linked baseline of common functional/security risk patterns to prepare a per-function applicability matrix, and SHALL inspect project-specific contracts, states, transactions, roles and integrations for additional hypotheses. Unknown applicability and deferred execution SHALL be explicit; a checklist or source catalogue SHALL NOT constitute completed testing or automatic business expectations.

#### Scenario: Code reveals a compound operation
- WHEN a selected function performs multiple writes or asynchronous side effects
- THEN the plan derives concrete partial-failure, ordering or concurrency hypotheses from those operations, records their source and oracle or open question, and links resulting evidence or deferral.

#### Scenario: A pattern has no executable adapter
- WHEN file-upload patterns apply but no binary/multipart executor is available
- THEN they remain blocked coverage with a required adapter, rather than being marked passed from a pattern-library entry.
