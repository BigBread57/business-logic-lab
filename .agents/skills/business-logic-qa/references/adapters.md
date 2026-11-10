# Native adapter API

`scripts/adapters.mjs` provides transport-independent wrappers around injected clients. Configure the adapter name, resource and permissions in the run profile. Each method admits exactly one call through `performAction`, consuming the shared action budget; exceptions and timeouts remain uncertain and require reconciliation. Client implementations must honor the provided `signal` and absolute Unix millisecond `deadline`; cancellation cannot undo an accepted external effect. An uncertain action can keep an admission slot occupied, including during recovery. Reconcile it using independent evidence before retrying.

```js
import { createAdapter, encodeEnvelope, saveEvidence, createChain } from '../../.agents/skills/business-logic-qa/scripts/adapters.mjs';

const api = createAdapter({ run, actor: 'reviewer', adapter: 'broker', resource: 'test-topic', client: {
  // Bridge the supplied context to the actual client's cancellation mechanism.
  read: (input, { signal, deadline, actionId }) => brokerRead(input, { signal, deadline, actionId }),
} });
const message = await api.read({ correlation: 'example' });
const attachment = await saveEvidence(run, 'envelope', encodeEnvelope(message));
const chain = createChain(run, { correlation: { request: 'example' }, stages: ['published', 'processed'] });
await chain.observe('published', { state: 'present', provenance: `Evidence: ${attachment}` });
await chain.observe('processed', { state: 'not_observable', provenance: 'No access to consumer state' });
```

The injected methods are `publish`, `read`, `offsets`, `query`, `documentRead`, `search`, `metadata`, `injectFault`, and `recoverFault`. Each accepts `(input, { signal, deadline, actionId })` and returns its client result. Each call to read or poll must use a wrapper separately. `query` uses read permission by default; the caller must set `input.permission = 'mutate'` for a mutating query. Clients are trusted to respect that classification. The caller owns database connections, transaction boundaries, rollback, SQL parameterization and resource cleanup; this module does not manage them.

`encodeEnvelope` accepts a JSON-safe message with byte-array or null `key` and `value`, plus ordered `headers` as `[string, bytes-or-null]` pairs. It encodes these fields in base64; `decodeEnvelope` restores Buffers and header order. Offset and other metadata must be JSON-safe; use strings for offsets exceeding JavaScript's safe integer range. Supply an actual `headers` array, including an empty one when no headers exist. Raw evidence is stored under unique exclusive filenames with restrictive file permissions. It is **not sanitized**: review payloads, metadata and provenance for credentials and personal data before saving, and protect the run directory. It is distinct from sanitized action records and is not a business verdict.

`createChain` creates a tracker and writes a new durable JSON snapshot after each observation. Call `checkpoint()` before effects to persist all initial pending stages. Each returned receipt includes its relative `evidence` path. `resumeChain(run, relativeSnapshot)` restores correlation, chain ID and stage states after a restart; it validates path containment and the saved structure. Register finalized snapshots with the campaign. Each snapshot has ordered stages, provenance and an explicit incomplete list; `present` alone completes a stage. `absent` means the observer actually checked and saw absence; `not_observable` means visibility was unavailable; `window_elapsed` requires `window_ms` and means a bounded observation ended without confirmation. Unobserved stages are `pending`. Snapshots preserve prior observations even when a later observation changes a stage. Correlation and provenance are supplied by the caller and are not independently verified.

Fault injection requires `duration_ms` from 1 to 60000. The injected client and target must enforce expiry independently; the wrapper cannot guarantee recovery if the process dies or an injection effect is uncertain. `withFault(input, callback)` admits injection, runs the callback, then admits recovery even if the callback throws. Recovery errors remain uncertain. The callback must itself be bounded, and each client call within it must use an admitted operation. Do not use this helper against resources outside the approved run profile.

The automated tests use deterministic injected client fixtures and a real local HTTP server to exercise admission and cancellation propagation; they do not establish compatibility with any particular broker or database driver.
