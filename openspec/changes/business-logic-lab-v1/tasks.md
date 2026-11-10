# Tasks

- [x] 1. Create the portable Codex skill, knowledge/profile/scenario contracts and configuration examples; validate skill discovery metadata. Evidence: quick_validate.py returned Skill is valid.
- [x] 2. Implement approval integrity, profile validation, persistent run snapshots, deadlines and exclusive experiment claims; verify refusal paths. Evidence: tests/qa.test.mjs stale approval, deadline, claims and permissions tests passed.
- [x] 3. Implement scoped HTTP execution, independent actors, parallel/polling scenarios, bounded load and browser evidence journaling; verify on local HTTP integration tests. Evidence: real local HTTP integration tests passed, including global limits and eventual results.
- [x] 4. Implement Markdown/JSON coverage reports and regression generation/replay; verify a generated test fails for a retained defect. Evidence: generated portable regression failed on count=2 and passed on count=1; verify-regression records failure and shares run limits.
- [x] 5. Inspect selected repositories and prepare a source-cited interservice knowledge draft, configuration prerequisites and runnable candidate scenarios where facts support them. Evidence: projects/rsa, source revisions/file hashes and docs/research/real-project-discovery.md. Candidate does not imply live execution.
- [x] 6. Run just lint, just test, skill/OpenSpec validation and independent review; update usage, requirements and verification evidence. Evidence: docs/verification.md; 28 passed plus three targeted repeats, skill valid, change valid; independent review corrections covered by tests.
- [x] 7. Perform real-project acceptance using approved RSA C2/C3/C5/C7 on the user-selected new isolated local Docker stack; record applicable UI/API/multi-role/interservice checks and defect regressions. User approved bundle/environment in chat 2026-10-22; no further general execution approval required. Owner: this chat. UI URL and SLA remain explicit coverage gaps.
- [x] 7.1 Prepare isolated Compose resources, real dependencies, production source mounts, migrations and local identity fixtures; record transport-only deviations.
- [x] 7.2 Execute bounded live multi-perspective checks, persist actual observations and generate/replay regressions for confirmed findings; preserve raw coverage gaps.
- [x] 7.3 Verify tool changes, independently review added harness, update reports and clean up only owned running test services after evidence capture.

Live evidence: runs/rsa-live-20261022-01/live-summary.md. Applicable acceptance executed; UI/role/SLA/transport limitations explicitly retained. Confirmed race regression fails on retained defect; int32 contradiction separately classified. Owned stack stopped; unrelated containers retained. OpenSpec change kept active for review; no archive or source fixes performed.

- [x] 8. Clarify task-derived pre-run settings, application-role/account/worker allocation, same-role concurrent scenarios and mandatory boundary/contract-deviation exploration in the skill, template and docs; validate links, skill metadata and OpenSpec. Historical RSA evidence remains unchanged; this documentation follow-up does not claim a new live acceptance run. Evidence: lint links valid; skill valid; OpenSpec valid.

- [x] 9. Add reusable seeded constraint-based valid-data generation and durable append-only action history/analysis; support observations without business verdicts, test meaningful generator/history behavior, update skill/docs.
- [x] 10. Prepare isolated backend/frontend folder QA with two Analyst and one Users identities, task-derived role visibility inspection, approved folder rules, 600-second shared deadline/250 operations/4 concurrent operations. Execute repeated generated inputs, UI/API and concurrent shared-object cases; persist all actions/results and replay/regressions.
- [x] 11. Review additions, run verification, report scope/coverage/gaps honestly, stop only owned services and refresh outputs.

Folder follow-up evidence: runs/folders-live-20261022-01/live-summary.md. 249 recorded API operations, 40 cases, 2 mismatch classes (12 repeated cases), 2 exploratory outcomes; UI create/rename/role checks executed, unavailable UI publication/move recorded explicitly. Two native regressions failed on retained approved expectations. 44 tooling tests and independent final review passed; owned services stopped.

- [x] 12. Research primary test-design/security sources, add a source-linked baseline pattern library and per-function applicability/coverage matrix, require additional project/code/business-derived hypotheses, document limits and validate links/skill/OpenSpec. No new live application run is implied.

Pattern-library evidence (2026-10-26): docs/research/testing-heuristics-sources.md and security-pattern-sources.md; references/patterns.md v1.0 and assets/pattern-matrix.example.md. Lint links and skill metadata valid; OpenSpec valid; 44 existing tooling tests passed. Agent-managed planning contract only; no new live application run or automatic Markdown-matrix enforcement claimed.
