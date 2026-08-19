# Claude Code Instructions

Before planning, editing, or running implementation commands, read and follow:

1. [MVP Development Specification](docs/MVP.md)
2. [Mandatory Development Rules](docs/DEVELOPMENT_RULES.md)
3. [Shared Coding Agent Instructions](AGENTS.md)

The linked documents are authoritative. In particular:

- All repository content and code comments must be in English.
- User conversation may be in English or Chinese.
- Functional behavior must be discussed and explicitly confirmed before implementation.
- Changes must remain within the confirmed scope.
- Never modify `main` directly; work on a dedicated `<type>/<short-description>` branch created from the latest `main`.
- All changes must reach `main` through a reviewed pull request with passing required CI.
- Commit messages and PR titles must use an English prefix such as `feat:`, `fix:`, or `docs:`.
- Split unrelated concerns and different change types into focused commits.
- Complete unit, integration where applicable, and end-to-end tests are required for every functional change.
- Implementation changes must include thorough English developer documentation for behavior, configuration, architecture, failures, and extension points.
- Public contracts and non-obvious or security-sensitive logic require concise JSDoc or reasoning comments; comments must explain why rather than narrate syntax.
- Web Console pages must be composed from small, single-purpose components rather than monolithic files.
- Every new or changed Web Console component must include focused behavioral unit tests.
- Every Web Console change must meet WCAG 2.2 AA and verify keyboard, focus, semantics, forms, responsive zoom, and contrast across English/Chinese and Light/Dark themes.
- jsx-a11y linting and representative Playwright axe scans are required; accessibility failures must not be silently suppressed.
- Applicable format, lint, type-check, test, and production-build checks must pass.
- Never commit, push, create or merge a pull request, or perform any other Git remote operation without explicit confirmation for that exact operation.
- Preserve existing user work, secrets, data, API compatibility, and the platform-independent architecture.

If requirements or instructions are ambiguous or conflicting, pause before implementation and ask the user to clarify.
