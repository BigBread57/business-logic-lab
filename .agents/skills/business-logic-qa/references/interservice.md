# Interservice checks

First discover the actual topology from source and environment. Include brokers, processors and background jobs; a business chain is not necessarily a chain of HTTP calls.

For each scenario define:

- Input boundary, payload/schema version and permitted transport.
- Correlation identifier and mapping at each stage, including tenant/owner identity.
- Expected persistence, index document, API projection and domain side effects.
- What must never happen versus what must converge, and the approved time window.
- Observation channels available, unavailable and potentially stale.

Keep an evidence timeline per correlation ID. A client timeout leaves operation completion unknown. Before resending, query observations and apply the documented idempotency policy. Duplicate transport delivery and duplicate business effect are different facts.

Exercise reordered/duplicate events, poison input, partial failure, index lag and role-dependent visibility when the agreed rules and environment allow them. Check both the direct persisted/indexed state and the API view where possible. Polling should observe, not create repeated business writes.

For raw-data-consumer / OpenSearch / speech-analytics, consult the prepared project knowledge instead of inventing a consumer REST endpoint. Kafka and Data Prepper can be required infrastructure even though their source repositories are outside the selected code scope. Use existing publisher/test harnesses after inspecting their real CLI/API and environment. Journal broker/UI observations through the helper; retain project-native integration tests for those transports rather than presenting HTTP-only replay as end-to-end proof.
