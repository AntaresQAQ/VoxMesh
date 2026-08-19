# Repository Instructions for Coding Agents

These instructions apply to Codex and any other coding agent that reads `AGENTS.md`.

## Required Reading

Before planning or changing this repository, read:

1. [MVP Development Specification](docs/MVP.md)
2. [Development Rules](docs/DEVELOPMENT_RULES.md)

`docs/DEVELOPMENT_RULES.md` is mandatory and is the canonical source for engineering workflow, testing, security, review, Git, and release requirements.

## Mandatory Workflow

- Communicate with the user in English or Chinese according to their preference.
- Write all repository content, documentation, comments, test names, logs, and user-facing text in English.
- Discuss requirements, behavior, scope, risks, acceptance criteria, and testing before implementing a functional change.
- Do not write behavior-changing code until the user explicitly confirms the proposed functional change.
- Never edit directly on `main`; create a dedicated `<type>/<short-description>` branch from the latest `main`.
- Deliver every change to `main` through a reviewed pull request with passing required CI.
- Use English Conventional Commit-style commit messages and PR titles such as `feat: ...`, `fix: ...`, or `docs: ...`.
- Split unrelated concerns and different change types into focused, reviewable commits instead of one catch-all commit.
- Keep changes strictly within the confirmed scope and preserve existing user changes.
- Do not commit, amend, rebase, tag, push, force-push, create a pull request, merge, or release without explicit confirmation for that specific operation.
- Every functional change must include complete unit, integration where applicable, and end-to-end tests.
- Run all applicable formatting, linting, type-checking, testing, and production-build checks before reporting work as complete.
- Never expose or commit secrets, credentials, tokens, personal data, or machine-specific configuration.
- Preserve the platform-independent architecture and dependency direction defined in `docs/MVP.md`.

If any instruction here conflicts with the linked documentation, stop and ask the user to resolve the conflict before implementation.
