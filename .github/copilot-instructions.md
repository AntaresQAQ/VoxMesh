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
- Do not introduce unrelated refactoring, cleanup, dependency updates, or features.
- Preserve the platform-independent Agent Core and adapter boundaries defined in the MVP specification.
- Use strict TypeScript and explicit validation and error handling. Do not bypass type safety.
- Add complete unit, integration where applicable, and end-to-end coverage for every functional change.
- Run applicable format, lint, type-check, test, and production-build checks before declaring completion.
- Never reveal or commit secrets or sensitive data.
- Never commit, amend, rebase, tag, push, force-push, create or merge a pull request, or release without explicit user confirmation for that specific operation.

When instructions conflict or requirements are unclear, stop before implementation and ask the user to resolve the ambiguity.
