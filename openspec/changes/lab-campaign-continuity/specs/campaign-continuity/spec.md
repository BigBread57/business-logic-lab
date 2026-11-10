## Source Task

- Task: USER-2026-11-09 — implement generic QA product improvements and retain project examples only as illustrations.

## ADDED Requirements

### Requirement: Durable campaign registry
The system SHALL maintain stable scenario and defect IDs, immutable execution records, source/version context, explicit coverage states and finding history across registered runs. Concurrent writers SHALL not lose updates. Unknown expectations SHALL remain observations.

#### Scenario: Continue a partial scenario on a new version
- WHEN a scenario has a partial execution and another run is registered
- THEN its remaining obligations and historical evidence remain available independently of the new execution.

#### Scenario: Update finding status
- WHEN a finding is resolved
- THEN resolution requires linked passing verification on a stated version and prior observations remain in history.

### Requirement: Reconciled reports and continuation
The system SHALL derive campaign reports and continuation context from persistent records, include unexecuted scenarios and unfinished actions, validate evidence, detect unassigned results and describe source inventory. Partial reports SHALL remain available when reconciliation fails.

#### Scenario: Missing result assignment
- WHEN a registered run contains a result not assigned to an execution
- THEN the report includes the result and an issue and refuses reconciled status.

#### Scenario: Select new work
- WHEN changed components or untested scenarios are selected
- THEN the plan explains novelty or justified regression and preserves exclusions and blockers.

### Requirement: Reusable transport and chain support
The system SHALL provide client-injected message, database, document-store and fault operations using existing action admission, preserving binary payloads, duplicate ordered headers, correlation and uncertainty. Chain observations SHALL distinguish absence, missing visibility and elapsed observation windows.

#### Scenario: Observe a binary message
- WHEN a client returns a message with binary key and duplicate headers
- THEN the saved envelope preserves exact bytes and header order.

### Requirement: Retained environments
The system SHALL support explicit preserve policy, bounded diagnostics, environment snapshots, start/stop/resume and resource ownership. Preserve policy SHALL prevent cleanup on setup or callback failure and on explicit cleanup requests.

#### Scenario: Failed preparation of retained environment
- WHEN preparation fails with preserve policy
- THEN diagnostic state is saved and cleanup is not executed.

### Requirement: Native test evidence
The system SHALL retain exact native test commands, version metadata, source artifacts and case outcomes including skips without inferring exhaustive product coverage.

#### Scenario: Import native test result
- WHEN a JUnit artifact is imported
- THEN case identities, outcomes, skip reasons and artifact hashes are retained; missing collection/coverage evidence remains explicit.

### Requirement: Generic agent workflow
The skill SHALL route first run, resume, changed-version validation and final reconciliation through concise instructions with persistent checkpoints and bounded worker assignments. Examples SHALL not make a particular application, broker or database mandatory.

#### Scenario: Resume a campaign
- WHEN an agent resumes
- THEN it reads compact campaign context and reconciles uncertain mutations before choosing a new scenario.
