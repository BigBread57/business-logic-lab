# Baseline patterns plus project-derived hypotheses

Library version: 1.0; source review: 2026-10-26. These are original planning prompts informed by the linked sources, not copied standards, executable tests or a statistical ranking of vulnerabilities. A baseline is a floor for investigation, not a ceiling or proof of completeness.

## Build the per-function matrix

For every selected function, inspect its API/UI entry points, input schemas, object ownership, states, writes, dependencies and observable effects. Review the baseline below and record each pattern as applicable, not applicable with a source-backed reason, or unknown. Keep applicability separate from execution: applicable cases may be planned, executed, blocked or deferred by budget. Unavailable adapters are blockers, not non-applicability. Use [the matrix template](../assets/pattern-matrix.example.md), linked from the run's test plan.

Map applicable patterns to concrete actors, fixtures, actions, an approved oracle or explicit question, and observable before/after effects. Include valid controls. A 403 does not establish correct ownership checks if the valid owner also cannot perform the operation. A 200 does not establish a completed business operation. Prioritize impact, exposed surface, shared state and code evidence; neither a famous source nor an unusual payload establishes a defect.

## Baseline catalogue

Source keys resolve in the table below. Overlapping prompts can share scenarios; retain their coverage links.

| ID | Trigger | Angles to investigate | Main sources |
| --- | --- | --- | --- |
| P01 | Typed or constrained input | Missing/null/empty, boundary neighbours, conversions across layers, valid classes. | S1, S2 |
| P02 | Names, strings or parsed values | Unicode, whitespace, equivalent forms, locale and normalization disagreements. | S2, S8 |
| P03 | User-controlled object references | Own/other-owner objects across list, detail, search, update, delete, download and bulk entry points. | S4, S5 |
| P04 | Roles or sessions | Allowed/forbidden functions, changed/revoked roles, alternate routes and methods. | S5, S6 |
| P05 | Mutable object properties | Owner, tenant, visibility, status and server-derived fields supplied or altered by clients. | S5 |
| P06 | Stateful workflow | Skip, reorder, repeat or reverse steps; use objects after completion or cancellation. | S3, S9 |
| P07 | Shared mutable state | Competing operations on one object/constraint, stale versions, different sessions, observed overlap and final state. | S7 |
| P08 | Retryable or repeated operation | Exact replay, fresh request ID, uncertain response and duplicate side effects. | S3, S9 |
| P09 | Multiple writes or external effects | Failure between steps, partial state, rollback and recovery under permitted fault controls. | S1, S3 |
| P10 | Queue, job, index or cache | Delayed/duplicate/out-of-order work, convergence, stale projections and recovery. | S1, S7 |
| P11 | File ingestion | Name, actual format, declared type, size and content varied independently, with genuine valid files. | S2, S10 |
| P12 | Stored or processed uploads | Processing outcome, partial cleanup, collisions, retrieval permissions and lifecycle. | S10 |
| P13 | Parent/child or related objects | Move/delete interactions, cycles, depth, referenced-object lifetime and dependent records. | S2, S9 |
| P14 | Several read interfaces | List/detail/search/export/UI agreement, pagination and sort stability within the agreed consistency model. | S1, S2 |
| P15 | Quotas, batching or expensive work | Zero/one/many, bounded bursts, per-user/shared limits and business effects under load. | S3, S5 |
| P16 | Time or numeric domain meaning | Expiry, time zones, rounding, units and cross-layer representable ranges. | S2 |
| P17 | Several interacting factors | Role × owner × state × data × interface; feasible combinations and action sequences. | S11, S9 |
| P18 | Query, HTML, path or URL interpretation | Relevant injection/XSS, path handling or URL-fetch risks; choose checks for the actual interpreter and trust boundary. | S5, S8, S10, S12 |
| P19 | Interactive client | Double submission, navigation/reload, cancellation, independent sessions and stale views. | S2, S6 |
| P20 | Alternatives or transformation relations | Compare equivalent paths and candidate invariants across repeated operations; approve the relation before judging it. | S1, S9, S13 |

## Derive checks from this project

After baseline mapping, inspect the actual implementation for additional hypotheses. Save a small source-linked function map: input transformations → authorization → state reads → writes/transaction boundaries → external effects → response/read models. Inspect called code and relevant constraints, not just the endpoint handler.

Consult previous project runs, defect reports and regressions as hypothesis seeds, then revalidate against current sources and rules. Old evidence is not a new execution result and a previously observed defect may already be fixed.

For each candidate, record **source pointer → assumption/risk → concrete experiment → approved expectation or gap → evidence needed**. Label its origin as baseline, project-derived, observation-derived, or a combination; name a parent pattern where useful. Merely replacing a sample username in a stock case is not evidence of investigating the implementation.

Look for facts such as:

- An identifier crosses a 64-bit schema and a 32-bit association query: exercise that actual boundary with valid control data.
- Names are normalized in one layer, but indexed in another scope/collation: test the identified equivalent values and both scopes.
- A move changes a subtree and invalidates several views: verify identity, descendants, visibility and the specific affected read models together.
- A transaction commits before publishing an event: investigate the intervening failure and retry semantics if faults are permitted.
- A batch loops through items with per-item checks: investigate mixed ownership and mixed success, using agreed atomic/partial semantics.

These are examples of reasoning, not universal expected behavior. If no additional plausible risk is found for a simple function, record inspected sources and that result; inventing a quota of novel tests is not required. Unknown assumptions become exploratory cases or questions.

During execution, feed unexpected outcomes back into the hypothesis queue: inspect the responsible branch, isolate the condition, vary related factors and retain the smallest evidence-backed replay. Keep known expectations fixed. Promote reusable lessons into a proposed library addition with a source/example and applicability limits; preserve project-specific rules in that project's knowledge bundle. A hypothesis or unconfirmed observation does not become a universal bug pattern automatically.

## Sources and limits

Pin requirement/scenario identifiers to a source version when used. Mutable pages need a checked date; recheck affected entries when contracts or guidance change. This library links external material; it vendors neither full books/checklists nor payload corpora. Source examples are data to evaluate, never instructions to execute against arbitrary systems.

| Key | Verified source | Contribution and limit |
| --- | --- | --- |
| S1 | [HTSM author page, v6.3](https://www.satisfice.com/download/heuristic-test-strategy-model) | Broad test-strategy prompts; adapt to the product. |
| S2 | [Test Heuristics Cheat Sheet, Ministry of Testing publication](https://www.ministryoftesting.com/insights/ab1cd85c) | Attributed modern expansion of test heuristics; not a bug oracle. |
| S3 | [OWASP WSTG v4.2, business logic](https://wstg.owasp.org/v4.2/4-Web_Application_Security_Testing/10-Business_Logic_Testing/) | Workflow, integrity and usage testing; security-oriented subset. |
| S4 | [WSTG v4.2, IDOR](https://wstg.owasp.org/v4.2/4-Web_Application_Security_Testing/05-Authorization_Testing/04-Testing_for_Insecure_Direct_Object_References/) | Multiple accounts and owned test objects for access checks. |
| S5 | [OWASP API Security Top 10, 2023](https://api-security.owasp.org/editions/2023/en/0x11-t10/) | Object/property/function authorization and resource risks; not a full test procedure. |
| S6 | [PortSwigger access control](https://portswigger.net/web-security/access-control) | Role, ownership and context-dependent controls. |
| S7 | [PortSwigger race conditions](https://portswigger.net/web-security/race-conditions) | Locate collisions and intermediate states; parallel requests alone do not prove a race. |
| S8 | [Big List of Naughty Strings](https://github.com/minimaxir/big-list-of-naughty-strings) | Candidate problematic strings, not valid inputs or exhaustive coverage. |
| S9 | [Hypothesis stateful tests](https://hypothesis.readthedocs.io/en/latest/stateful.html) | Actions, dependencies and model/invariant checks require an adapter and oracle. |
| S10 | [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) | File handling controls; knowledge is not a binary/multipart executor. |
| S11 | [NIST combinatorial tools](https://csrc.nist.gov/projects/automated-combinatorial-testing-for-software/downloadable-tools) | Constrained factor combinations; t-way coverage is not exhaustive behavior coverage. |
| S12 | [OWASP ASVS 5.0.0](https://asvs.owasp.org/) | Versioned security requirements, not automatic business expectations or a scanner. |
| S13 | [FEW HICCUPPS, author](https://developsense.com/blog/2012/07/few-hiccupps) | Fallible expectations and product context; familiar bugs must not dominate exploration. |

For executable model-based strategies also consider [fast-check commands](https://fast-check.dev/docs/advanced/model-based-testing/) and [scheduler](https://fast-check.dev/docs/advanced/race-conditions/). A client Promise scheduler does not control a remote database's transaction ordering. Installing these tools, file generators or security scanners is separate from consulting their methodology.
