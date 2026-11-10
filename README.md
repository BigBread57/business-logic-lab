# Business Logic Lab

Business Logic Lab is a toolkit and Codex skill for investigating business workflows across roles, interfaces and services. It records scenarios, executions, evidence, versions and remaining work across multiple runs. The agent designs the investigation and interprets business expectations; the toolkit executes supported operations and accounts for the results.

[Русская версия](README.ru.md) · [Documentation](docs/INDEX.md) · [Usage](docs/usage.md) · [QA skill](.agents/skills/business-logic-qa/SKILL.md)

## Quick start

Requirements: Node.js 22 or later. The runtime uses only Node's standard library; installation of npm packages is not required. `just` is optional.

```sh
node --version
npm run lint
npm test
npm run demo -- --out work/my-first-campaign
```

The demo requires a **new** output directory. It starts and stops a local HTTP fixture, creates synthetic data, runs a scenario and native tests, and retains the results. Read `work/my-first-campaign/campaign/report.md`. The skipped role test and untested delete scenario are intentional: reconciliation accounts for remaining work and does not mean every scenario passed. Use a different output path for another run.

## What it does

- Maintains campaigns with stable scenarios, run versions, findings, evidence and outstanding checks.
- Executes bounded HTTP scenarios and supports project-provided native clients, observations and correlated stages.
- Records existing test commands and JUnit results, including skipped tests and artifacts.
- Helps explore inputs and action sequences, reproduce supported failures and resume work after changes.
- Manages project-provided environment recipes, diagnostics and snapshots with explicit retention policies.

For a real system, define the scope, environment, roles, limits and expectations; inspect contracts and record unknowns; create a campaign and run; execute scenarios; then reconcile results and remaining work. A response alone is not proof of a business outcome, and unknown expectations remain questions. See [how the project works](docs/overview.md) and [usage](docs/usage.md).

## Project map

| Path | Contents |
| --- | --- |
| `.agents/skills/business-logic-qa/` | Agent workflow, contracts, templates and Node.js helper scripts |
| `examples/` | Self-contained campaign demo |
| `docs/` | Guides, reference, design decisions and verification |
| `tests/` and `scripts/` | Automated tests and repository checks |
| `openspec/` | Specifications and development changes |
| `projects/` | Project-specific integrations and historical examples, not runtime prerequisites |
| `runs/` and `work/` | Local evidence and working data; excluded from Git |

For another project, install or copy the skill as described in [usage](docs/usage.md). The Codex host is the verified target; other hosts and external integrations require their own verification. Native clients and environment commands are trusted integrations, not a sandbox.

## Before publishing

The directory contains project-specific examples and historical references. Review the intended audience, integration details and the exact staged files before uploading; do not publish credentials, local data or evidence by accident. See [publication and handoff](docs/publication.md). No license is specified: the owner must choose one before offering reuse under license terms.
