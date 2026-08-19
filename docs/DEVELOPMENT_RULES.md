# Development Rules

This document defines mandatory rules for all human and AI-assisted work in this repository. These rules apply to every application, package, deployment target, script, test, and document unless the user explicitly approves an exception before implementation.

The keywords **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, and **SHOULD NOT** are normative.

Coding agents discover these rules through the repository instruction files:

- [Codex and shared agent instructions](../AGENTS.md)
- [Claude Code instructions](../CLAUDE.md)
- [GitHub Copilot instructions](../.github/copilot-instructions.md)

## 1. Communication and Language

- All repository content MUST be written in English, including documentation, source-code comments, user-facing copy, commit messages, pull request descriptions, test names, log messages, configuration descriptions, and error messages.
- Conversations with the user MAY be in English or Chinese, according to the user's preference.
- Code comments MUST explain intent, constraints, or non-obvious trade-offs. Comments that merely restate the code MUST NOT be added.
- Public APIs, exported types, configuration options, and operational procedures MUST be documented in English.

## 2. Discuss Before Implementing

- Requirements, expected behavior, scope, user experience, failure behavior, security implications, and acceptance criteria MUST be discussed before a functional change is implemented.
- The user MUST explicitly confirm the intended functional change before code that changes behavior is written.
- If requirements are ambiguous, implementation MUST pause until the ambiguity is resolved. Assumptions that affect behavior MUST NOT be silently introduced.
- A confirmation for one feature MUST NOT be treated as approval for unrelated refactoring, dependency upgrades, architecture changes, or additional features.
- Documentation-only corrections, formatting-only changes, and investigation MAY proceed without a separate functional approval when they do not change product behavior.
- If implementation reveals that the confirmed design is no longer suitable, work MUST pause and the revised design MUST be confirmed before continuing.

Before requesting confirmation, the proposed change SHOULD state:

1. The problem and desired outcome.
2. The behavior that will change.
3. The files or components expected to change.
4. Important alternatives and trade-offs.
5. Testing and migration requirements.
6. Known risks, compatibility concerns, and out-of-scope items.

## 3. Change Scope and Repository Safety

- Changes MUST be limited to the confirmed scope.
- Unrelated cleanup, formatting, renaming, refactoring, or dependency upgrades MUST NOT be included.
- Existing user changes MUST be preserved. Files or changes that were not created as part of the current task MUST NOT be reverted, overwritten, or deleted.
- Destructive operations, data deletion, schema resets, history rewriting, and irreversible migrations MUST require explicit user approval.
- Generated files MUST be produced by the project's documented generator or build process. Generated output MUST NOT be manually edited unless the project explicitly requires it.
- Temporary files, debug code, disabled tests, local credentials, and development artifacts MUST NOT be left in the repository.

## 4. Git and Remote Operations

- Changes MUST NOT be committed, amended, rebased, tagged, pushed, force-pushed, or submitted as a pull request without explicit user confirmation for that specific operation.
- Approval to edit files is not approval to commit.
- Approval to commit is not approval to push.
- Approval to push is not approval to create or merge a pull request.
- Force-pushes, history rewrites, branch deletion, and tag deletion MUST require explicit confirmation immediately before execution.
- Commits, when approved, MUST be focused and MUST use an accurate English commit message.
- Secrets, credentials, private keys, tokens, personal data, and machine-specific configuration MUST never be committed.

## 5. Architecture and Design

- The architecture and dependency direction defined in [MVP.md](./MVP.md) MUST be preserved.
- Agent Core MUST remain platform-independent, hardware-independent, provider-independent, and integration-independent.
- Business logic MUST depend on interfaces rather than vendor SDKs, operating-system APIs, hardware APIs, databases, or transport details.
- Platform-specific, provider-specific, and deployment-specific behavior MUST remain behind adapters.
- New abstractions MUST solve a current confirmed requirement. Speculative abstractions and premature generalization MUST NOT be added.
- Existing shared abstractions MUST be reused where appropriate. Similar logic MUST NOT be duplicated across packages without a documented reason.
- Public interfaces and cross-package dependencies MUST be minimal, explicit, strongly typed, and backwards-compatible unless a breaking change is confirmed.
- Global mutable state and hidden side effects MUST NOT be introduced.
- Time, randomness, network access, storage, and external services SHOULD be injectable when necessary for deterministic testing.

## 6. Implementation Quality

- TypeScript strict mode MUST remain enabled.
- `any`, unsafe type assertions, ignored type errors, and suppression directives MUST NOT be used to bypass type safety. Any unavoidable exception MUST be narrowly scoped, documented, and approved.
- Errors MUST be explicit, typed where practical, and handled at the correct boundary.
- Failures MUST NOT be silently swallowed or converted into success-shaped results.
- Input MUST be validated at trust boundaries, including HTTP, WebSocket, MCP, configuration, storage, and provider boundaries.
- Functions and modules SHOULD be small, cohesive, and named by responsibility.
- Public behavior MUST NOT depend on undocumented ordering, timing, environment state, or platform-specific behavior.
- New dependencies MUST be justified, actively maintained, license-compatible, and necessary. Standard library or existing project dependencies SHOULD be preferred.
- Dependency versions MUST be pinned through the lockfile. Unrelated dependency updates MUST NOT be included.
- Dead code, commented-out code, placeholder implementations, and unresolved TODOs MUST NOT be merged unless explicitly approved and tracked.

## 7. Testing Requirements

Every functional change MUST include complete automated tests.

### 7.1 Unit Tests

- All business rules, branches, validation paths, state transitions, error paths, and edge cases MUST have unit tests.
- Tests MUST be deterministic and isolated from real networks, real hardware, real clocks, external AI services, Home Assistant, and developer-specific state.
- Test doubles MUST model meaningful behavior and failure modes rather than only returning successful responses.
- Bug fixes MUST include a regression test that fails before the fix and passes after it.

### 7.2 Integration Tests

- Boundaries between packages, adapters, storage, HTTP APIs, WebSocket events, MCP clients, and provider implementations MUST have integration tests where unit tests cannot prove the contract.
- Database tests MUST verify migrations, constraints, transactions, rollback behavior, and compatibility with existing data.
- API tests MUST verify status codes, response schemas, validation errors, authorization behavior, and failure responses.

### 7.3 End-to-End Tests

- Every user-visible feature MUST have end-to-end coverage for its primary successful flow.
- End-to-end tests MUST also cover critical failure and recovery flows.
- Web Console features MUST be tested through the browser-facing interface, not only through direct API calls.
- Mock Mode MUST support reliable end-to-end testing without real hardware, Home Assistant, or paid external services.
- Platform-specific behavior MUST be tested on the relevant platform or in a representative CI environment before release.

### 7.4 Test Integrity

- Tests MUST NOT be skipped, disabled, focused, quarantined, or weakened to make a change pass without explicit approval and a documented tracking issue.
- Assertions MUST verify observable behavior, not implementation details, unless the implementation detail is itself a required contract.
- Flaky tests MUST be treated as defects. Automatic retries MUST NOT be used to hide nondeterminism.
- Test coverage MUST not decrease. Changed critical logic SHOULD have full branch coverage.
- A feature is incomplete if required unit, integration, or end-to-end tests are missing.

## 8. Required Validation

Before a change is presented as complete, all applicable project checks MUST pass:

```text
format check
lint
type check
unit tests
integration tests
end-to-end tests
production build
```

- The smallest relevant checks MAY be run during development, but the full required validation MUST pass before release.
- Validation failures caused by the change MUST be fixed, not ignored.
- Pre-existing failures MUST be clearly reported and MUST NOT be misrepresented as successful validation.
- Test output and generated snapshots MUST be reviewed. Snapshots MUST NOT be updated blindly.
- Manual verification MAY supplement automated tests but MUST NOT replace required automated coverage.

## 9. API and Compatibility Rules

- API inputs and outputs MUST use explicit schemas shared where appropriate between server and client.
- Runtime validation MUST exist even when compile-time types are present.
- Breaking changes to APIs, configuration, storage schemas, events, or package exports MUST be discussed and explicitly approved.
- Breaking changes MUST include a migration plan, compatibility strategy, and documentation.
- APIs MUST use stable error shapes and MUST NOT expose internal stack traces, secrets, or implementation details.
- Retries, timeouts, cancellation, idempotency, and rate limits MUST be considered for external calls and state-changing operations.
- WebSocket and event contracts MUST define event names, payload schemas, ordering expectations, and reconnection behavior.

## 10. Data and Migration Safety

- Schema changes MUST use versioned, forward-applicable migrations.
- Existing user data MUST be preserved by default.
- Migrations MUST be tested against representative existing data and an empty database.
- Destructive or irreversible migrations MUST require explicit user approval and a documented backup and rollback plan.
- Multi-step writes that must remain consistent MUST use transactions.
- Storage interfaces MUST prevent SQLite-specific behavior from leaking into Agent Core.
- Retention, deletion, and export behavior MUST be documented for conversation, message, configuration, and log data.

## 11. Security and Privacy

- Secrets MUST be loaded from approved secret or configuration mechanisms and MUST never appear in source code, tests, fixtures, logs, screenshots, documentation examples, or error messages.
- Sensitive values MUST be redacted before structured logging or telemetry.
- All external input MUST be treated as untrusted.
- Authentication and authorization MUST be enforced server-side. Client-side checks are not security controls.
- MCP tool access MUST follow least privilege. Tool names, arguments, and results MUST be validated.
- High-impact tool operations SHOULD require explicit user approval at execution time when permission workflows are introduced.
- Dependencies and container images MUST use maintained versions and SHOULD be reviewed for known vulnerabilities before release.
- Production defaults MUST be secure. Debug endpoints, permissive CORS, default credentials, and unrestricted network exposure MUST NOT be enabled by default.
- Personal and conversation data MUST be collected and retained only when required for confirmed functionality.

## 12. Logging and Observability

- Logs MUST be structured, actionable, and assigned an appropriate severity.
- Logs MUST include correlation identifiers for requests, conversations, agent runs, and tool calls where applicable.
- Secrets, credentials, raw authorization headers, and unnecessary personal data MUST NOT be logged.
- Expected errors MUST include enough context to diagnose the failure without exposing sensitive data.
- Health checks MUST distinguish process health from dependency readiness where applicable.
- Metrics that are unavailable on a platform MUST be represented as unavailable, not fabricated or treated as zero.
- New critical workflows MUST expose sufficient logs and events to diagnose success, failure, timeout, and cancellation.

## 13. Documentation

- Documentation MUST be updated in the same change as the behavior it describes.
- Setup instructions MUST be reproducible from a clean environment.
- Configuration documentation MUST include purpose, type, default, required status, security considerations, and examples with non-secret placeholder values.
- Architecture decisions with long-term impact SHOULD be recorded as Architecture Decision Records under `docs/adr/`.
- Operationally significant features MUST document startup, shutdown, health checks, failure modes, recovery, backup, and rollback.
- Documentation MUST describe current behavior. Planned behavior MUST be clearly labeled as planned and MUST NOT be presented as implemented.

## 14. CI, Review, and Release Gates

- Required validation MUST run in CI for pull requests and protected branches.
- A change MUST NOT be merged when required CI checks fail.
- Functional changes MUST receive review from someone other than the author before merge.
- Security-sensitive, data-destructive, authentication, authorization, secret-handling, and migration changes MUST receive explicit focused review.
- Releases MUST be reproducible from version-controlled source and lockfiles.
- Release notes MUST describe user-visible changes, breaking changes, migrations, and known limitations.
- Rollback instructions MUST exist for changes that can affect persisted data or deployment availability.

## 15. Definition of Done

A feature or fix is complete only when all of the following are true:

1. The behavior and acceptance criteria were confirmed before implementation.
2. The implementation matches the confirmed scope and architecture.
3. Error, edge, security, privacy, and compatibility cases were addressed.
4. Unit, integration, and end-to-end tests were added or updated as required.
5. All applicable validation passes.
6. Documentation and configuration examples are current and written in English.
7. No secrets, debug artifacts, disabled tests, or unrelated changes are included.
8. Any migration, deployment, observability, and rollback requirements are complete.
9. The user has reviewed the result before any commit, push, pull request, merge, or release operation.

If any item is missing, the work MUST be reported as incomplete.
