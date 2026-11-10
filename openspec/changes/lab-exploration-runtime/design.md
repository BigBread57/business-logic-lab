## Architecture

Extend qa.mjs for observation contracts, upload transport and durable action leases. Keep its current HTTP entrypoints and request counter as compatibility aliases; the counter becomes the shared total for cooperating transports. A lease records immutable actor/resource/permission metadata and a completion receipt inside the atomically replaced meter. Native callers receive the remaining deadline and must respect cancellation; the protocol is cooperative, not an OS sandbox.

Add search.mjs for bounded state-model paths and delta reduction, using callbacks for reset/step/readback so adapters remain project-owned. Persist every trial; only an explicit matching failure signature permits reduction. Add deterministic schema constructs to explore.mjs; reject unsupported schema semantics explicitly.

Add lifecycle.mjs for argv recipes with fresh namespaces and durable step state; add projects/rsa/local/lab.mjs as the executable RSA preparation/cleanup entrypoint. Configure Compose mounts, ports and config volume through environment variables instead of machine-specific paths. Prepare before starting the test clock; cleanup has its own finite command timeouts and remains possible after run expiry.

## Verification

Local HTTP integration for uploads and observation contracts; mixed-process admission and uncertain completion tests; actual subprocess lifecycle fixtures and Docker recipe/config inspection; deterministic state-machine integration with a retained defect, reset and shrinking. Existing generated regressions remain portable. No dependency installs or application source changes are required.

## Risks

Remote cancellation does not undo accepted mutations. Adapters must count each actual primitive operation, including polls; enclosing an opaque multi-request script in one lease is not exact accounting. State exploration is bounded by the supplied model; reset/readback correctness belongs to the adapter. Real RSA image availability is an external prerequisite, recorded separately from tooling tests.
