# Knowledge and approval

Create `knowledge.json` with `project`, `sources`, `rules` and `gaps` arrays. Sources have `id`, `path`, `revision` (commit hash for code), and `kind` (business/code/contract). Rules have stable `id`, `statement`, source IDs, `status` (candidate/approved), and optionally an observation window. Code-derived candidates need business confirmation; existing tests are evidence, not automatic truth.

Collect roles and object ownership, allowed and forbidden transitions, invariants, idempotency, intended side effects and temporal conditions. Distinguish an invariant that must always hold from convergence after processing. List intentionally unmodelled/unknown branches. Rules are concise independently checkable statements, not copies of implementation code.

Provide a readable knowledge summary for human agreement. After explicit agreement mark only agreed rules approved and run `approve --knowledge <file> --out <approval.json> --by <reviewer>`. This records the file hash and reviewer, not a cryptographic human signature: the host remains responsible for obtaining real user agreement. Approval files cannot be used after editing the knowledge.

Start from `assets/knowledge.example.json`. It is deliberately unapproved. Store credentials only in environment variables or the host's credential store. A profile contains references to those variables, never their values.

Reuse the agreed bundle for subsequent runs. If sources change, inspect whether relevant rules changed and request new agreement only for affected business decisions. Reapprove the resulting snapshot explicitly. If disagreement remains, retain it as a gap and test independent agreed rules.
