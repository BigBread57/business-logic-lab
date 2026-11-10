## Source Task

- Task: USER-2026-11-02 — implement the four requested laboratory improvements.

## ADDED Requirements

### Requirement: Observation-only execution
The helper SHALL initialize observation-only runs without knowledge approval, execute and journal observations without rule IDs, and report them separately from approved-rule coverage. Observation scenarios SHALL NOT emit business pass or violation or become confirmed defects.

#### Scenario: Unknown expected behavior
- WHEN a scoped HTTP observation is executed without a business oracle
- THEN its concrete input and response are recorded as observed, and no rule coverage is fabricated.

#### Scenario: Approved-rule compatibility
- WHEN a conformance scenario references unknown rules or lacks assertions
- THEN it is rejected before sending requests as before.

### Requirement: Unified adapter admission
All cooperating transports SHALL use one durable meter, operation cap, concurrency cap and immutable deadline. External adapters SHALL declare actor, allowed resource and permission before acting. Interrupted admissions SHALL remain uncertain until explicitly reconciled with evidence.

#### Scenario: Mixed transports
- WHEN HTTP, browser, Kafka and database adapters act concurrently
- THEN they share the same finite allowance and active slots and appear in the report.

#### Scenario: Interrupted adapter
- WHEN an admitted action has no known completion
- THEN its reservation survives restart, remains visible and cannot be silently reused.

### Requirement: Upload fixtures
HTTP scenarios SHALL support JSON, binary files and multipart fields/files, restrict fixture reads to a declared root, enforce finite upload size, preserve hashes and copy files into portable regressions.

#### Scenario: Multipart replay
- WHEN a confirmed multipart failure is exported
- THEN the generated test includes its file bytes and preserves the original assertion after the source fixture disappears.

### Requirement: Richer deterministic data and bounded state search
The exploration helper SHALL generate deterministic composite/unique/constant data within explicit limits, enumerate bounded legal paths through a declared state model, execute paths against reset baselines and reduce a reproduced failure only while its original failure signature remains observed.

#### Scenario: Uncertain reduction candidate
- WHEN a shorter candidate is blocked or inconclusive
- THEN it is not accepted as reproducing the defect and the known reproducer is retained.

### Requirement: Repeatable owned lifecycle
Lifecycle tooling SHALL persist preparation/cleanup state, execute argv commands without a shell, use fresh owned namespaces, block reuse of incomplete setup and retain failed cleanup for retry. The RSA recipe SHALL configure source paths, initialize fresh databases/topics/index/accounts, and clean only its own Compose project and config volume.

#### Scenario: Partial setup failure
- WHEN preparation fails after resources were created
- THEN failure is saved and cleanup can remove only resources named in the persisted session.

#### Scenario: Fresh replay
- WHEN a new RSA session is prepared
- THEN it receives new owned volumes and identities without renewing any historical run deadline.
