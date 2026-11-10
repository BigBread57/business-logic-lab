# Business Logic Lab

This is a general QA product. Keep core contracts and agent instructions independent of application names, transports and vendors. Project-specific integrations and examples belong under projects/ or examples/.

- Start with [README](README.md) and [documentation](docs/INDEX.md). Runtime entry points are in package.json.
- For QA, use [business-logic-qa](.agents/skills/business-logic-qa/SKILL.md). Sustained work uses a persistent campaign and explicit remaining obligations.
- For implementation, inspect the relevant OpenSpec change and tests before editing. Node 22+, standard library only unless a dependency is justified.
- Preserve historical runs and evidence. Existing environments and user requests to keep data require preserve policy; inspect the project's commands before execution.
- Record exact scope, versions and verification. Unknown business expectations remain questions/observations.
- Run just lint and just test for runtime changes; use targeted checks while developing. Durable behavior changes require documentation updates and review.
- Keep helper CLI help, SDK contracts, examples, references and tests consistent. Native clients are injected; they own cancellation and real resource semantics.
- Follow the user's tooling preferences. Use glab for GitLab; do not publish messages or changes without applicable authorization.
