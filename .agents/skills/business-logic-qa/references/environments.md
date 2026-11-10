# Environment lifecycle

An environment recipe is trusted JSON containing shell-free command argument arrays. Commands run on the local host and may change external resources; use project-supplied commands only after reviewing them. The lifecycle does not discover services or enforce ownership in external systems.

This self-contained example creates and removes a local marker. Replace its commands with the project's own provision, readiness, mount and version checks, and start and stop commands. Every command requires a unique ID within its phase, a nonempty `argv` array and `timeout_ms` between 1 and 600000. Optional `cwd` and string-valued `env` are supported. `${session}` and `${namespace}` expand at runtime; `${env:NAME}` references an existing environment variable. Credential-valued environment entries must use environment references, not literals.

```json
{
  "retention": "preserve",
  "resources": [{ "id": "marker", "owner": "${namespace}" }],
  "prepare": [{ "id": "create", "argv": ["node", "-e", "require('fs').writeFileSync('marker','ready')"], "timeout_ms": 5000 }],
  "cleanup": [],
  "doctor": [{ "id": "marker-present", "argv": ["node", "-e", "require('fs').accessSync('marker');console.log('marker present')"], "timeout_ms": 5000 }],
  "start": [{ "id": "start", "argv": ["node", "-e", "require('fs').writeFileSync('running','yes')"], "timeout_ms": 5000 }],
  "stop": [{ "id": "stop", "argv": ["node", "-e", "require('fs').rmSync('running',{force:true})"], "timeout_ms": 5000 }]
}
```

Run from the repository root, with the example saved as `recipe.json` and a new, nonexistent session directory:

```sh
node .agents/skills/business-logic-qa/scripts/lifecycle.mjs prepare --recipe recipe.json --out /tmp/example-session
node .agents/skills/business-logic-qa/scripts/environment.mjs doctor --session /tmp/example-session
node .agents/skills/business-logic-qa/scripts/environment.mjs snapshot --session /tmp/example-session
node .agents/skills/business-logic-qa/scripts/environment.mjs stop --session /tmp/example-session
node .agents/skills/business-logic-qa/scripts/environment.mjs resume --session /tmp/example-session
```

`doctor` executes every named check, records sanitized output and reports failures. No configured doctor, start or stop commands means the operation is unavailable, not healthy or successful. `resume` runs the configured start commands without rerunning preparation; it does not verify readiness unless the project also runs appropriate checks. Optional `snapshot` commands can collect project-specific state before the tool saves a uniquely named, read-only JSON state snapshot. This snapshot is an execution record, not a backup of external data. Each operation retains its named checks and separate logs in the session.

The default policy is ephemeral: setup and callback failures trigger cleanup, and explicit cleanup is available. `preserve` prevents automatic and explicit cleanup, including after failure; an empty cleanup list is allowed only for preserved recipes. Resource entries declare a unique ID and `owner: "${namespace}"`. Session path, namespace, recipe and declared ownership are checked against recorded digests before lifecycle operations. This detects accidental changes; it does not prove an external resource actually belongs to the session or protect against deliberate edits to the records. Project commands must enforce the namespace against the real resources they operate on.

Operations acquire an exclusive session lock and reject overlapping work, including snapshots. A killed process can leave the lock and an active operation behind, and its external effects may be uncertain. Inspect the process, external resources and recorded steps before manually reconciling a stale lock or active state. Do not simply retry a potentially unfinished mutation. Command timeouts are bounded, but cannot prove whether external effects completed.
