# VoxBridge MVP Implementation Plan

## Related Documents

- [MVP Development Specification](./MVP.md)
- [Mandatory Development Rules](./DEVELOPMENT_RULES.md)

This document is the project-visible implementation roadmap. It does not authorize implementation by itself. Each functional phase MUST be discussed and explicitly confirmed before behavior-changing code is written.

## 1. Current State and Approach

The repository currently contains product, architecture, engineering-governance, and coding-agent documentation only. There is no application code, package manifest, test infrastructure, CI configuration, deployment configuration, or runtime implementation.

The implementation will follow the seven phases defined in the MVP specification while preserving a platform-independent Agent Core. All seven phases are detailed into executable work packages and remain independently gated by explicit user confirmation.

## 2. Confirmed Product Decisions

- The roadmap covers all seven MVP phases.
- All seven phases are detailed into executable work packages and explicit decision gates.
- Vitest is the baseline unit and integration test framework.
- Playwright is the baseline browser end-to-end test framework.
- Fastify schemas and TypeBox define runtime-validated HTTP and WebSocket contracts and shared TypeScript types.
- macOS, Linux, and Windows are supported development environments; macOS and Linux are the primary contributor platforms.
- All three development platforms must support installation, build, format check, lint, strict type-check, unit tests, integration tests, Mock Mode, and Playwright.
- Real ALSA audio, Linux services, Debian packaging, and NanoPi qualification remain Linux-only.
- The server listen host and port are configurable.
- The default deployment scenario is a trusted local-area network.
- The Web Console requires a single administrator password.
- First startup requires administrator password setup before protected features are available.
- Authentication uses an opaque server-side session with an `HttpOnly` and `SameSite` cookie. The cookie uses the `Secure` attribute whenever HTTPS is enabled.
- Direct public-internet exposure and HTTPS termination are outside the MVP scope. The application must remain compatible with future HTTPS deployment.
- The first real AI integration is non-streaming Azure OpenAI with Azure Speech STT and TTS.
- Azure endpoints, deployment, API version, region, languages, voices, audio settings, and limits are configurable.
- Azure and MCP secrets are write-only in the API and Web Console and are stored in SQLite as plaintext protected by restrictive host filesystem permissions.
- The MVP provides generic third-party MCP integration rather than a required Home Assistant integration.
- MCP supports Streamable HTTP and stdio. OAuth is deferred.
- MCP servers and tools are disabled by default and require explicit administrator enablement.
- Administrators may configure arbitrary stdio commands after a prominent command-execution warning and explicit confirmation.
- Linux audio targets Debian or Ubuntu ARM64, ALSA, and standard USB Audio Class devices.
- Audio device IDs, sample rate, and channels are configurable; capture defaults to 16 kHz mono.
- Releases provide Linux amd64 and arm64 images, archives, and Debian packages.
- NanoPi supports Docker Compose, systemd, scripts, and manual deployment with backup and one-command compatible rollback.
- All repository content is written in English.
- Commit, push, pull-request, merge, and release operations require separate explicit user confirmation.

## 3. Architecture Baseline

### 3.1 Workspace

Use a pnpm monorepo with these initial boundaries:

```text
apps/
  server/                 Fastify composition root, HTTP, WebSocket, auth
  web/                    React and Vite Web Console
packages/
  agent-core/             Provider-independent orchestration and events
  mcp-client/             Generic MCP contracts and client implementation
  ai/                     STT, LLM, and TTS contracts and adapters
  audio/                  Audio input/output contracts and adapters
  platform/               Device-information and platform contracts/adapters
  storage/                Storage contracts, SQLite implementation, migrations
  shared/                 Shared schemas, DTOs, errors, IDs, and event contracts
deployments/
  docker/
  linux/
  nanopi-r2s/
tests/
  e2e/                    Playwright system tests
```

Directories should be created only when their phase begins. Package exports must be explicit, and cross-package imports must follow the documented dependency direction.

### 3.2 Dependency Direction

```text
Web / Server Application
        -> Agent Core
        -> Infrastructure Contracts
        -> Adapter Implementations
```

- Agent Core must not import Fastify, React, SQLite, vendor SDKs, operating-system APIs, or hardware APIs.
- The server application is the composition root that selects concrete adapters from validated configuration.
- Shared runtime schemas are the source of truth for external contracts.
- Adapter failures are normalized into typed domain or application errors at boundaries.

### 3.3 Core Runtime Model

Define stable identifiers and event contracts for:

- request
- session
- conversation
- message
- agent run
- provider call
- MCP server
- MCP tool call
- audio operation

The conversation timeline records each observable pipeline step without storing secrets. Structured logs and WebSocket events use correlation identifiers derived from this model.

## 4. Cross-Cutting Quality Gates

Every functional work package must include:

- unit tests for business rules, validation, branches, edge cases, and failures
- integration tests for storage, HTTP, WebSocket, package, and adapter boundaries
- Playwright end-to-end tests for every user-visible success flow and critical failure or recovery flow
- documentation updates for behavior, configuration, setup, operation, and recovery
- format, lint, strict type-check, unit, integration, e2e, and production-build validation

Tests must use mock providers and isolated temporary SQLite databases. Default tests must not require real AI credentials, third-party MCP servers, physical audio hardware, NanoPi hardware, or internet access.

Cross-platform development rules:

- Root commands must use Node.js or package-manager tooling rather than Bash-only syntax.
- Paths, process spawning, temporary directories, environment variables, signals, line endings, and executable resolution must use cross-platform APIs.
- Fixtures and assertions must not depend on platform-specific separators or newline conventions.
- Linux-only tests must be explicitly labeled; equivalent contract tests with fakes remain mandatory everywhere.
- CI must continuously validate Linux, macOS, and Windows.

## 5. Phase 1 - Project Skeleton and Secure Application Foundation

Phase 1 implementation requires a new explicit user confirmation.

### 5.1 Workspace and Tooling

- Create the root pnpm workspace, package scripts, TypeScript project references, shared compiler settings, formatting, linting, and `.gitignore`.
- Define Node.js and pnpm version requirements.
- Configure Vitest workspaces and Playwright.
- Define root commands for development, build, format check, lint, type-check, unit tests, integration tests, e2e tests, and complete validation.
- Implement cross-platform root scripts without Bash, GNU-only flags, or Unix-only paths.
- Add Linux, macOS, and Windows CI jobs for build, checks, tests, Mock Mode startup, and Playwright.
- Keep ALSA, Debian packaging, deployment, and hardware jobs explicitly Linux-only.
- Add a root `README.md` linking product, architecture, setup, configuration, testing, deployment, and governance documentation.
- Document platform-specific setup and troubleshooting where required.

Acceptance gate:

- Clean macOS, Linux, and Windows environments can install dependencies and run the workspace validation commands.
- Mock Mode and Playwright pass on all three development operating systems.
- CI and local development use the same scripts.

### 5.2 Shared Contracts and Error Model

- Create TypeBox schemas for health, authentication, configuration, device status, conversations, chat, MCP, logs, and WebSocket event envelopes.
- Export inferred TypeScript types from the schemas.
- Define stable error codes and a non-sensitive API error envelope.
- Define validated identifiers where they prevent cross-entity mistakes.
- Add schema compatibility and serialization tests.

Acceptance gate:

- Invalid external payloads are rejected at runtime.
- Server and Web Console consume the same contract package.

### 5.3 Configuration System

- Define configuration precedence for environment variables, persisted non-secret settings, and runtime defaults.
- Include configurable listen host and port.
- Separate secret values from general configuration.
- Validate configuration before accepting traffic and report actionable English errors.
- Document every option, default, required state, source, and security consideration.
- Redact administrator and future provider credentials from logs and errors.

Acceptance gate:

- Valid configurations load deterministically.
- Invalid host, port, secret, provider, and storage settings fail before startup completes.
- Unit and integration tests cover precedence, validation, and redaction.

### 5.4 Storage Foundation

- Define storage interfaces before implementing SQLite.
- Add versioned migrations for application metadata, administrator credentials, sessions, configuration, conversations, messages, MCP servers, and logs.
- Store administrator passwords only as modern salted password hashes.
- Store only opaque session identifiers or their hashes, expiration, and revocation metadata.
- Use transactions for multi-row state changes.
- Test migrations against empty and representative existing databases.

Acceptance gate:

- Migrations are repeatable, ordered, and failure-safe.
- SQLite-specific types do not leak into Agent Core.
- Authentication secrets cannot be recovered from stored records.

### 5.5 Authentication and First-Run Setup

- Expose an unauthenticated bootstrap-status endpoint that reveals only whether setup is required.
- Permit administrator password creation only when no administrator credential exists.
- Prevent concurrent duplicate initialization with a transaction and uniqueness constraint.
- Add login, logout, current-session, expiry, rotation, and revocation behavior.
- Use opaque server-side sessions.
- Configure the cookie as `HttpOnly`, `SameSite`, path-limited, and `Secure` when HTTPS is enabled.
- Require authentication for all application APIs and WebSocket connections except health and bootstrap or login endpoints.
- Apply conservative login rate limiting and consistent authentication errors.
- Never log passwords, password hashes, session tokens, or raw cookies.

Acceptance gate:

- A new installation cannot use protected features before password setup.
- Setup cannot overwrite an existing administrator password.
- Login, logout, expiry, invalidation, rate limiting, and protected WebSocket behavior have unit, integration, and e2e coverage.

### 5.6 Server and Web Shell

- Create the Fastify server composition root with health, readiness, authentication, configuration, and WebSocket infrastructure.
- Create the React and Vite application shell with setup, login, authenticated layout, route guards, and an error boundary.
- Add structured logging with redaction and correlation IDs.
- Add graceful startup and shutdown behavior.
- Keep CORS disabled or same-origin by default.

Acceptance gate:

- `pnpm dev` starts the server and Web Console in Mock Mode.
- Playwright completes first-run setup, login, refresh, logout, and denied-access flows.

### 5.7 Mock Infrastructure

- Implement deterministic Mock STT, LLM, TTS, audio input/output, MCP server, storage fixtures, and device information.
- Support configurable success, delay, timeout, malformed response, cancellation, and failure scenarios.
- Emit the same events and use the same interfaces as real adapters.

Acceptance gate:

- Mock Mode requires no hardware, external service, or paid credential.
- Failure scenarios are deterministic and usable by integration and e2e tests.
- Mock Mode completes its primary browser flow on macOS, Linux, and Windows.

## 6. Phase 2 - Agent Core and Mock End-to-End Pipeline

Phase 2 implementation requires a new explicit user confirmation after Phase 1 acceptance.

### 6.1 Agent Core Contracts

- Define messages, tools, provider requests and responses, tool calls and results, agent-run state, cancellation, and final-response contracts.
- Define configurable limits for tool-call iterations, payload sizes, and execution time.
- Keep all contracts provider-independent.

### 6.2 Agent Runtime State Machine

- Implement deterministic states for input validation, initial LLM request, validated MCP tool calls, tool results, follow-up LLM requests, final response, cancellation, timeout, and failure.
- Prevent unbounded tool loops and duplicate terminal events.
- Persist conversation and pipeline events transactionally where consistency is required.
- Emit structured domain events for every state transition.

### 6.3 Generic MCP Client Boundary

- Use an official or maintained MCP SDK rather than reimplementing the protocol.
- Wrap the SDK behind project-owned generic interfaces.
- Validate tool metadata, names, arguments, and results.
- Normalize connection, timeout, protocol, validation, and execution errors.
- Implement deterministic Mock MCP tools for success and failure scenarios.

### 6.4 Chat Application Service

- Own authorization, conversation creation, Agent Core invocation, persistence, cancellation, and response mapping in an application service.
- Implement `POST /api/chat` and conversation query endpoints.
- Define idempotency behavior for state-changing chat requests.
- Preserve a diagnosable conversation timeline when failures occur.

### 6.5 Agent Core Test Matrix

- Unit-test no-tool responses, one tool, sequential tools, invalid arguments, unknown tools, tool failure, provider failure, timeout, cancellation, iteration limit, persistence failure, and redaction.
- Integration-test Agent Core with Mock LLM, Mock MCP, and SQLite.
- Add API integration tests for chat and conversation retrieval.
- Add a Playwright flow for Mock LLM -> Mock MCP -> Mock LLM.

Acceptance gate:

- The same Agent Core completes direct and tool-assisted conversations without importing concrete providers, hardware, platform, storage, or web frameworks.
- Every pipeline step is persisted and observable through API and WebSocket events.

## 7. Phase 3 - Complete Web Console

Phase 3 implementation requires a new explicit user confirmation after Phase 2 acceptance.

### 7.1 Dashboard

- Show authenticated server, agent, audio, MCP, and device status.
- Display CPU, memory, temperature, and uptime only when available.
- Distinguish unavailable, stale, degraded, and failed states.
- Refresh without creating duplicate requests.

### 7.2 Chat and Browser Voice Test

- Provide text chat with loading, cancellation, error, retry, and conversation continuity.
- Add browser recording controls behind an audio interface.
- Route browser audio through STT -> Agent -> TTS and allow response playback.
- Handle permission denial, unsupported browsers, timeouts, and unavailable devices.
- Keep browser audio separate from physical server audio adapters.

### 7.3 Conversation Inspector

- Display the ordered User -> STT -> Agent -> MCP -> LLM -> TTS -> Assistant timeline.
- Show safe metadata, duration, status, error code, and correlation identifiers.
- Never render secrets or unredacted provider or MCP payloads.
- Support empty, in-progress, failed, cancelled, and completed conversations.

### 7.4 MCP Console

- List configured MCP servers, connection status, and discovered tools.
- Render argument forms from validated schemas with a JSON fallback.
- Require authentication for manual execution and distinguish it from Agent Core calls.
- Validate arguments and render structured results and errors safely.
- Do not add Home Assistant-specific UI logic.

### 7.5 Real-Time Logs and Events

- Authenticate WebSocket connections using the established session.
- Stream logs and domain events in versioned envelopes.
- Define reconnection, gap indication, bounded buffering, and backpressure behavior.
- Support MVP log-category and severity filters.
- Prevent secret-bearing fields from reaching the browser.

### 7.6 Configuration UI

- Expose safe settings for providers, MCP servers, audio devices, and non-secret server behavior.
- Treat secrets as write-only fields.
- Validate changes before persistence and indicate restart requirements.
- Use version checks to prevent silent overwrites.

### 7.7 Phase 3 End-to-End Matrix

Playwright must cover:

- first-run setup and login
- authenticated navigation and session expiry
- dashboard available and unavailable metrics
- normal and tool-assisted chat
- chat failure, cancellation, and retry
- browser microphone denial and mock voice flow
- conversation timeline success and failure
- MCP discovery and manual execution
- WebSocket reconnect and event rendering
- log filtering and redaction
- configuration validation, secret handling, conflict, and restart indication

Acceptance gate:

- All MVP Web Console areas work against Mock Mode on a normal development machine.
- Every browser-visible feature has success and critical failure or recovery coverage.

## 8. Phase 4 - Azure AI Provider Integration

Phase 4 requires explicit confirmation after Phase 3 acceptance.

### 8.1 Configuration and Secrets

- Add write-only Azure OpenAI endpoint, deployment, API version, and API key settings.
- Add write-only Azure Speech region or endpoint and API key settings.
- Configure STT language, TTS voice, output format, timeouts, retries, payload limits, and provider enablement.
- Persist secrets in SQLite under the confirmed host-filesystem trust model.
- Restrict permissions for databases, configuration, backups, and exports containing secrets.
- Never return current secrets through APIs, WebSockets, browser state, logs, diagnostics, or errors.
- Support explicit secret replacement and clearing.

### 8.2 Azure OpenAI Adapter

- Implement non-streaming Azure OpenAI behind the generic LLM interface.
- Support tool calling, configurable limits, bounded retries, cancellation, and safe usage metadata.
- Map Azure responses and finish reasons into generic Agent Core contracts.
- Normalize authentication, throttling, timeout, content-filter, invalid-request, unavailable-service, malformed-response, and cancellation errors.
- Never add Azure-specific imports or branches to Agent Core.

### 8.3 Azure Speech STT

- Implement complete-buffer speech recognition behind the generic STT interface.
- Default to validated 16 kHz mono PCM or WAV while allowing supported configured formats.
- Configure recognition language and enforce duration and payload limits.
- Convert or explicitly reject unsupported input; never silently reinterpret audio.
- Normalize no-speech, rejected recognition, invalid audio, quota, authentication, timeout, cancellation, and service failures.
- Do not retain uploaded audio after the operation unless a future diagnostic feature is separately approved.

### 8.4 Azure Speech TTS

- Implement complete-response synthesis behind the generic TTS interface.
- Configure voice, language, format, sample rate, timeout, and text limits.
- Return explicit audio metadata with every generated buffer.
- Normalize invalid voice, unsupported format, quota, authentication, timeout, cancellation, and service failures.
- Never silently switch voice or format.

### 8.5 Selection, Health, Tests, and Documentation

- Allow Mock and Azure providers to be selected independently for STT, LLM, and TTS.
- Validate required Azure settings before adapter activation.
- Expose safe readiness and last-error status.
- Keep Mock Mode as the offline deterministic default; fallback must be explicit.
- Unit-test configuration, mapping, limits, retries, cancellation, normalization, and redaction.
- Use sanitized fixtures for deterministic contract tests.
- Add opt-in live Azure smoke tests and an opt-in live voice pipeline e2e test outside default CI.
- Document resource setup, deployments, API versions, regions, languages, voices, quotas, cost controls, secret rotation, and diagnostics.

Phase 4 acceptance:

- The non-streaming Azure STT -> Agent Core -> Azure TTS flow works.
- Direct and MCP-assisted Azure OpenAI responses work without Agent Core changes.
- Azure failures are diagnosable without secret exposure.
- Default CI remains offline and deterministic.

## 9. Phase 5 - Generic Third-Party MCP Integration

Phase 5 requires explicit confirmation after Phase 4 acceptance. Home Assistant is deferred and must later connect through this generic layer without integration-specific Agent Core code.

### 9.1 Configuration Model

- Define transport-discriminated configuration for Streamable HTTP and stdio.
- Store name, description, enabled state, timeouts, retry policy, and tool policy.
- Streamable HTTP supports no authentication, static HTTP authorization tokens, and custom sensitive headers.
- stdio supports executable, ordered arguments, working directory, and environment variables.
- Treat authorization values, sensitive headers, and sensitive environment values as write-only secrets.
- Version configuration and use optimistic concurrency.

### 9.2 Streamable HTTP

- Use a maintained MCP SDK and the current Streamable HTTP protocol.
- Validate URL schemes and reject unsupported endpoints.
- Bound initialization, discovery, calls, reconnect, and shutdown.
- Use backoff and jitter for connection recovery.
- Do not retry tool calls unless they are explicitly known to be idempotent.
- Normalize protocol, authentication, connection, timeout, schema, and server errors.
- Defer OAuth.

### 9.3 stdio and Process Security

- Spawn executables directly with `shell: false` and explicit argument arrays.
- Use platform-aware executable resolution and process tracking on macOS, Linux, and Windows.
- Run with privileges no broader than the VoxBridge service account.
- Bound startup, initialization, calls, idle time, shutdown, restart count, and crash-loop behavior.
- Redact sensitive environment values from diagnostics.
- Terminate only process trees started and tracked by VoxBridge.
- Display a persistent Web Console warning that arbitrary stdio configuration grants command execution as the VoxBridge service account.
- Require explicit confirmation before saving or enabling changed command, arguments, working directory, or environment.
- Audit create, edit, enable, disable, start, stop, crash, and delete actions.

### 9.4 Lifecycle and Tool Permissions

- Implement initialization, capability negotiation, discovery, health, reconnect, disable, and graceful shutdown.
- Cache tool metadata with refresh and stale-state indicators.
- Isolate server failures and bound concurrency globally and per server.
- Disable new servers and newly discovered tools by default.
- Require explicit administrator enablement for each server and tool.
- Include server identity in tool identity to prevent collisions.
- Invalidate approval when a tool schema or relevant capability changes.
- Validate tool arguments and result envelopes.

### 9.5 Web Console and Tests

- Add create, edit, test, enable, disable, reconnect, refresh, manual call, and delete flows.
- Keep tokens, headers, and environment secrets write-only.
- Clearly distinguish Streamable HTTP and stdio risks.
- Show lifecycle, capabilities, tools, approvals, schema changes, safe errors, and audit history.
- Unit-test validation, masking, permissions, schema invalidation, lifecycle, retries, and process construction.
- Integration-test deterministic Streamable HTTP and stdio fixture servers on supported platforms.
- Playwright-test warnings, confirmations, discovery, approvals, manual and Agent calls, reconnect, failure isolation, and deletion.

Phase 5 acceptance:

- Generic compatible servers connect through Streamable HTTP or stdio.
- Agent Core can see and call only explicitly enabled tools.
- stdio never uses an implicit shell and never reveals sensitive environment values.
- No Home Assistant-specific code, schemas, labels, or branches exist in Agent Core.

## 10. Phase 6 - Debian/Ubuntu ALSA USB Audio

Phase 6 requires explicit confirmation after Phase 5 acceptance and access to representative Linux ARM64 hardware.

### 10.1 Scope and Devices

- Target Debian or Ubuntu ARM64 with ALSA while keeping the adapter testable on Linux amd64.
- Support standard USB Audio Class capture and playback devices without model-specific logic.
- Enumerate devices with stable IDs and safe display metadata.
- Configure input and output IDs independently.
- Never silently select another device or fall back to Mock Audio.
- Expose unavailable, busy, permission-denied, unsupported-format, disconnected, and error states.
- Keep Linux audio optional so macOS and Windows can install, build, test, and run Mock Mode without ALSA dependencies.

### 10.2 Formats and Lifecycle

- Configure sample rate, channels, sample format, and buffering.
- Default capture to 16 kHz mono, 16-bit PCM.
- Validate settings against device capabilities before use.
- Convert supported ALSA, Azure Speech, WAV, and PCM formats at adapter boundaries.
- Preserve audio metadata and reject unapproved lossy conversion.
- Implement capture and playback start, stop, cancellation, timeout, duration limits, queue policy, cleanup, and graceful shutdown.
- Release handles after success, failure, cancellation, shutdown, or removal.
- Normalize busy, disconnect, overrun, underrun, permission, format, timeout, and backend errors.

### 10.3 Permissions and Qualification

- Document and validate `/dev/snd`, audio groups, udev behavior, and service-account access.
- Map only required devices in Docker; never require privileged mode.
- Use a dedicated service account for systemd and manual deployment.
- Run platform-independent audio contract tests on macOS, Linux, and Windows.
- Run fake ALSA integration in default CI and native ALSA integration only on Linux.
- Qualify representative USB Audio Class hardware on Debian or Ubuntu ARM64.
- Test enumeration, selection, capture, Azure STT, Azure TTS playback, cancellation, removal, reconnect, busy-device recovery, reboot persistence, and stability.

Phase 6 acceptance:

- A configured standard USB Audio Class device completes the non-streaming voice pipeline.
- Device failures remain recoverable and do not crash Agent Core.
- R2S-specific code remains outside Agent Core and generic audio contracts.

## 11. Phase 7 - Multi-Architecture and NanoPi R2S Deployment

Phase 7 requires explicit confirmation after Phase 6 acceptance and final confirmation of the NanoPi OS image and resource budget.

### 11.1 Release Artifacts

- Produce versioned Linux amd64 and arm64 container images.
- Produce native application archives and Debian packages for both architectures.
- Include checksums, version metadata, release notes, migrations, and rollback compatibility.
- Build from locked dependencies in CI.
- Keep production artifacts Linux-only even though development supports macOS and Windows.

### 11.2 Docker Compose

- Provide non-root multi-architecture Docker and Compose deployments.
- Map only required ports, persistent paths, configuration, and `/dev/snd`.
- Add health checks, restart behavior, log rotation, resource limits, and graceful shutdown.
- Persist SQLite, configuration, logs, backups, and release metadata outside image layers.
- Support configurable listen host and port.

### 11.3 systemd and Debian Packages

- Install a dedicated user, service unit, directories, permissions, and secret-free defaults.
- Apply systemd hardening compatible with network, storage, stdio MCP child processes, and ALSA.
- Preserve configuration and data during upgrades.
- Provide install, status, start, stop, restart, upgrade, backup, restore, rollback, and uninstall operations.

### 11.4 Scripts and Manual Deployment

- Provide validated scripts for install, upgrade, backup, restore, rollback, and uninstall.
- Validate architecture, OS, tools, disk, permissions, and checksums before mutation.
- Never overwrite configuration or perform broad deletion without confirmation and backup.
- Document manual archive deployment, runtime requirements, layout, service account, permissions, systemd, ALSA, and lifecycle.
- Ensure package, scripted, and manual paths produce equivalent runtime layouts.

### 11.5 Secrets, Upgrade, and Rollback

- Define stable paths for binaries, configuration, SQLite, logs, cache, backups, and temporary files.
- Restrict plaintext-secret SQLite, configuration, and backups to the service account.
- Detect dangerously broad permissions.
- Exclude secrets from support bundles and exports by default.
- Back up configuration and SQLite before upgrades or migrations.
- Track application, schema, artifact, and previous-version metadata.
- Support one-command rollback after failed startup or health validation when schemas are compatible.
- Refuse unsafe rollback and document the required restore path.
- Test fresh install, repeated install, upgrade, failed upgrade, interruption, backup, restore, and rollback.

### 11.6 NanoPi Qualification

- Validate Docker Compose and native deployment on the confirmed Debian or Ubuntu ARM64 image.
- Measure CPU, memory, disk, startup, provider latency, and audio stability.
- Verify reboot recovery, persistence, sessions, MCP child processes, USB audio, logs, backup, restore, upgrade, and rollback.
- Set resource ceilings from measurements rather than guesses.
- Document the exact qualified hardware, OS image, limitations, and evidence.

Phase 7 acceptance:

- Docker Compose, Debian package, scripts, and manual deployment are reproducible.
- Linux amd64 and arm64 artifacts pass applicable validation.
- NanoPi runs Mock Mode plus Azure, generic MCP, and USB audio integrations.
- Failed upgrades can be diagnosed and safely rolled back.

## 12. Documentation Deliverables

Add and maintain documentation as the relevant phase begins:

```text
README.md
docs/IMPLEMENTATION_PLAN.md
docs/ARCHITECTURE.md
docs/CONFIGURATION.md
docs/TESTING.md
docs/SECURITY.md
docs/OPERATIONS.md
docs/API.md
docs/WEBSOCKET.md
docs/MOCK_MODE.md
docs/adr/
deployments/*/README.md
```

Architecture decisions should cover:

- package boundaries and dependency direction
- runtime schema strategy
- authentication and session model
- configuration precedence and secret storage
- conversation event model
- MCP SDK boundary
- SQLite migration strategy
- WebSocket delivery and reconnection semantics
- cross-platform commands, CI matrix, and Linux-only adapter boundaries

## 13. Final MVP Acceptance

The MVP is complete only when:

1. A clean development machine can run the complete Mock Mode with documented commands.
2. First-run administrator setup and session authentication protect all non-public features.
3. The Web Console supports dashboard, text chat, browser voice testing, conversation inspection, MCP inspection and manual execution, logs, and configuration.
4. The platform-independent Agent Core supports direct and MCP-assisted responses.
5. Azure OpenAI and Azure Speech STT/TTS work without Agent Core changes.
6. Generic MCP works through Streamable HTTP and stdio with explicit server and tool enablement.
7. Linux USB audio works through a platform adapter.
8. NanoPi R2S deployment is reproducible and documented.
9. Required unit, integration, and end-to-end tests pass.
10. macOS, Linux, and Windows development validation passes, including Mock Mode and Playwright.
11. Linux ALSA, packaging, deployment, and hardware qualification passes on applicable targets.
12. Secrets are redacted, migrations are safe, and backup and rollback procedures are documented.
13. No commit, push, pull request, merge, or release occurs without separate explicit user confirmation.

## 14. Constraints and Deferred Decisions

- Publishing this plan does not authorize Phase 1 implementation.
- HTTPS implementation is not part of the current MVP. Cookie and proxy behavior must remain compatible with future HTTPS.
- Authentication is part of Phase 1 because the default scenario is a LAN rather than localhost-only.
- LAN trust does not justify weak password storage, secret logging, permissive cross-origin defaults, or unauthenticated WebSockets.
- Plaintext secret storage in SQLite is an explicitly accepted host-trust trade-off. Restrictive permissions, write-only APIs, redaction, sensitive-backup handling, and clear documentation are mandatory.
- Arbitrary stdio MCP configuration is an explicitly accepted command-execution capability for administrators. The Web Console must show a prominent warning and require explicit confirmation.
- Home Assistant is deferred and is not an MVP acceptance requirement. Future support must use the generic MCP layer.
- macOS, Linux, and Windows are supported development environments. macOS and Linux are primary; Windows is a required CI and Mock Mode platform, not a production target.
- Linux audio and deployment dependencies must remain optional on unsupported development platforms.
- Multi-user roles, external identity providers, public-internet hardening, and certificate management are outside the MVP unless separately confirmed.
- Streaming STT/TTS, wake word, VAD, long-term memory, multi-agent behavior, and other MVP non-goals remain excluded.
- Every phase requires fresh user confirmation even when its technical direction is documented.
