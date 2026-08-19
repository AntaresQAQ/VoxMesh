# GitHub Copilot Repository Instructions

Before suggesting or implementing changes, read and follow:

- [MVP Development Specification](../docs/MVP.md)
- [Mandatory Development Rules](../docs/DEVELOPMENT_RULES.md)
- [Shared Coding Agent Instructions](../AGENTS.md)

The linked documents are authoritative and mandatory.

## Core Requirements

- Use English for all repository content, documentation, code comments, tests, logs, errors, configuration descriptions, and user-facing copy.
- Conversation with the user may be in English or Chinese.
- Discuss and explicitly confirm behavior, scope, risks, acceptance criteria, and testing before implementing any functional change.
- Never edit directly on `main`; use a dedicated `<type>/<short-description>` branch based on the latest `main`.
- Deliver changes through a reviewed pull request with passing required CI.
- Use English Conventional Commit-style commit messages and PR titles such as `feat: ...`, `fix: ...`, and `docs: ...`.
- Split unrelated concerns and different change types into focused, reviewable commits.
- Do not introduce unrelated refactoring, cleanup, dependency updates, or features.
- Preserve the platform-independent Agent Core and adapter boundaries defined in the MVP specification.
- Use strict TypeScript and explicit validation and error handling. Do not bypass type safety.
- Provide thorough English developer documentation for implemented features, APIs, configuration, architecture boundaries, failures, operations, and extension points.
- Add concise JSDoc and reasoning comments for public contracts, security-sensitive logic, invariants, state machines, workarounds, and non-obvious trade-offs; do not restate obvious code.
- Keep Web Console components small, cohesive, and single-purpose; split pages into focused components, hooks, and feature boundaries.
- Add complete unit, integration where applicable, and end-to-end coverage for every functional change.
- Add focused behavioral unit tests for every new or changed Web Console component.
- Meet WCAG 2.2 AA and verify keyboard access, visible focus, semantic HTML, form status, responsive zoom, and contrast in English/Chinese and Light/Dark themes.
- Run jsx-a11y linting and representative Playwright axe scans; do not suppress accessibility failures without explicit approval and tracking.
- Run applicable format, lint, type-check, test, and production-build checks before declaring completion.
- Never reveal or commit secrets or sensitive data.
- Never commit, amend, rebase, tag, push, force-push, create or merge a pull request, or release without explicit user confirmation for that specific operation.

When instructions conflict or requirements are unclear, stop before implementation and ask the user to resolve the ambiguity.
