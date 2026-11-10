## Source and boundary

USER-2026-11-09. This is a new cross-run continuity capability layered over the completed standalone runtime. Existing runs, deadlines, regression fixtures and historical reports remain intact. No RSA-specific library is appropriate for the generic Node tool; reuse this project's action admission, sanitizer and lifecycle rather than importing application middleware.

## Storage and contracts

Campaign directories contain campaign.json, immutable numbered events and derived report/context files. Exclusive lock directories serialize writers; interrupted locks require investigation, never automatic deletion. Records refer to registered runs by stable IDs and relative result filenames. Immutable execution IDs reference run result IDs; scenarios retain explicit remaining obligations. Verdicts are taken from saved run evidence, not assigned from prose. Defects keep versioned observations and explicit verification references.

Reports scan all registered run results, claims and action meters, check evidence containment/existence and expose every unassigned or broken source. Reconciled means inventories were accounted for, not that all scenarios passed. Report provenance records source hashes so later file changes are visible. Plans select unfinished work or impacted regressions with an explicit reason; no universal coverage percentage is inferred.

Native adapters use injected clients to avoid coupling the core to broker/database packages. Primitive operations join existing action admission. Exact envelopes and stage receipts are separate from business verdicts. Lifecycle recipes are trusted shell-free instructions, with preserve policy and named resource ownership, diagnostics and independent state snapshots.

Native test imports retain original sanitized text and hash, exact argv and version metadata, optional collected-case and branch-coverage artifacts. JUnit is a deliberately bounded parser which rejects DTD/entities and malformed structures instead of pretending to support arbitrary XML.

## Verification

Use isolated temporary directories, real local HTTP/child processes and deterministic client fixtures. Prove interrupted operations, concurrency, partial reports, retention failures, exact bytes, changed versions, malformed artifacts and unresolved obligations. Existing regression portability tests must remain green. No historical service stack is started or cleaned.
