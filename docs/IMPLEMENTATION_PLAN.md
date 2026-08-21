# VoxMesh MVP Implementation Plan

## Related Documents

- [MVP Development Specification](./MVP.md)
- [Mandatory Development Rules](./DEVELOPMENT_RULES.md)

This document is the project-visible implementation roadmap. It does not authorize implementation by itself. Each functional phase MUST be discussed and explicitly confirmed before behavior-changing code is written.

## Implementation Progress

Last updated: 2026-08-21

Current implementation branch: `feat/realtime-observability`, based on
`1a668a7` (`docs: reorganize project documentation (#8)`).

### Completed foundation and vertical slices

- [x] pnpm strict-TypeScript monorepo with format, lint, type-check, unit,
      integration, production-build, and Playwright commands
- [x] Linux, macOS, and Windows CI plus Playwright and CodeQL
- [x] Fastify server, React Web Console, TypeBox contracts, SQLite migrations,
      structured errors, and same-origin defaults
- [x] first-run administrator setup, salted scrypt password hashing, opaque
      server-side sessions, logout, rotation, expiry, and rate limiting
- [x] provider-independent Agent Core with bounded Mock MCP tool execution
- [x] deterministic Mock Chat, Mock Native Multimodal, and complete buffered
      browser voice pipelines
- [x] Dashboard, Chat, Conversations, live replayable Logs, Settings,
      authentication, stable Browser History routes, localization, themes, and
      representative accessibility automation; manual WCAG 2.2 AA review
      remains required
- [x] Azure OpenAI non-streaming Chat, Audio STT, and Audio TTS adapters
- [x] generic OpenAI-compatible Chat, STT, and TTS adapters
- [x] buffered Alibaba Cloud Model Studio Chat plus dedicated Fun-ASR and
      Qwen-Audio-TTS/CosyVoice application adapters that use provider-internal
      WebSocket protocols
- [x] buffered browser recording normalization to mono 16 kHz PCM16 WAV and a
      live local microphone loudness meter
- [x] authenticated versioned WebSocket delivery for persisted logs and
      pipeline events with bounded replay, gap indication, heartbeat,
      backpressure, session revocation, redaction, reconnect, and URL-backed
      Logs filters

### Completed Runtime Routing

- [x] Runtime Routing is the only provider configuration source; the legacy
      Provider Catalog and separate LLM/Speech/Voice Pipeline settings were
      removed
- [x] editable Provider Connections, Model Deployments, Runtime Routes, and
      write-only credential replacement/clearing
- [x] declared and verified capabilities with configuration-bound,
      role-specific verification and real MCP tool-call execution
- [x] protected active-route dependency graphs, dependency-aware deletion, and
      persisted deletion of seeded records
- [x] explicit Native-to-Composed fallback with no silent provider or pipeline
      downgrade
- [x] buffered route testing, Test & activate, actionable result states, and
      provider configuration error reporting
- [x] independent STT/TTS streaming intent switches with explicit activation
      rejection while runtime transport remains buffered
- [x] route-aware Dashboard status, inline Settings editors, accessible
      capability selection, responsive layouts, and bilingual copy

### Current implementation boundaries

- Browser voice requests are buffered: recording completes and is normalized
  before `/api/voice` executes the route.
- Alibaba speech adapters use WebSockets internally, but VoxMesh does not yet
  expose an application-level streaming voice session.
- Native Multimodal is implemented with a deterministic Mock provider only.
- The Logs page loads a durable `GET /api/logs` snapshot and merges
  authenticated real-time log events. Application-level bidirectional voice
  streaming remains planned separately.
- Conversation list/detail and persisted pipeline events are implemented, but
  complete duration, correlation, in-progress, failed, and cancelled metadata
  remain.
- Mock MCP tool execution through Agent Core is implemented; generic MCP
  server configuration, discovery, approval, and manual execution UI are not.
- Automated accessibility checks cover representative routes and states. They
  do not replace the remaining manual screen-reader, forced-colors, complete
  zoom, device, and hardware review.

### Remaining Phase 3 acceptance work

- [ ] Chat cancellation, retry, and conversation continuity
- [ ] Conversation Inspector duration, safe metadata, correlation identifiers,
      and complete in-progress/failed/cancelled states
- [ ] Dashboard device and physical-audio status with explicit unavailable,
      stale, degraded, and failed states
- [ ] generic Mock MCP inspection and manual execution UI without
      service-specific logic
- [ ] remaining Phase 3 failure/recovery, locale, theme, keyboard, zoom, and
      accessibility evidence

### Remaining buffered Phase 4 acceptance work

- [ ] opt-in live Azure and Alibaba/OpenAI-compatible Chat/STT/TTS smoke tests
      and one opt-in live composed-voice test
- [ ] safe provider readiness and last-error status
- [ ] documented live-test cost, quota, region, retention, and credential
      safeguards
- [ ] real Native Multimodal provider adapter; this is an extension and is not
      required before the original non-streaming Azure/Alibaba acceptance gate

### Planned streaming voice work

- [ ] authenticated, versioned bidirectional browser voice WebSocket transport
- [ ] browser PCM capture without waiting for `MediaRecorder.stop()`
- [ ] capability-gated streaming STT sessions with partial and final
      transcription events
- [ ] provider-independent Streaming Chat LLM and Agent Core event flow with
      text deltas, tool-call deltas, MCP execution, and follow-up streaming
- [ ] independent capability-gated streaming TTS with chunked browser playback
- [ ] ordered semantic text segmentation so TTS begins before the final LLM
      response without speaking incomplete tool calls or unstable text
- [ ] bounded queues, backpressure, cancellation, timeouts, interruption
      cleanup, and explicit non-resumable reconnect behavior
- [ ] Alibaba Fun-ASR and Qwen-Audio-TTS/CosyVoice streaming adapters using
      their existing incremental WebSocket protocols
- [ ] deterministic Mock streaming adapters and complete unit, integration,
      Playwright, accessibility, and live-provider qualification

### Later confirmed phases

- [ ] generic MCP configuration, Streamable HTTP and stdio transports,
      lifecycle, permissions, and full MCP Console
- [ ] Debian/Ubuntu ALSA USB capture/playback and local offline wake-word
      detection through platform adapters
- [ ] Linux amd64/arm64 archives, containers, Debian packages, Compose,
      systemd, backup/restore, rollback, and NanoPi R2S qualification
- [ ] final cross-platform and hardware MVP acceptance

### Deferred and not active backlog

- VAD
- full-duplex barge-in and user interruption of active TTS playback
- WebRTC and Bluetooth audio
- long-term memory and vector databases
- multi-agent, multi-device, and complex approval workflows
- local/offline AI and mobile applications

Streaming intent is already represented independently for STT and TTS in
Runtime Routing. Until the transport and assigned adapters are implemented and
verified, activation must continue to reject routes that request streaming.

### Next execution order

1. Close the remaining Phase 3 Web Console and end-to-end acceptance gaps.
2. Complete the Phase 4 opt-in live-provider acceptance gate.
3. Implement capability-gated full-chain Streaming STT/Chat LLM/TTS.
4. Implement Phase 5 generic MCP.
5. Implement Phase 6 ALSA physical audio and offline wake-word detection.
6. Implement Phase 7 packaging, deployment, backup, rollback, and NanoPi
   qualification.

## 1. Current State and Approach

The repository contains validated Mock and real-provider buffered voice
vertical slices, protected Runtime Routing, and a bilingual Web Console with
representative accessibility automation. The implementation is intentionally
incomplete: application-level voice streaming, complete MCP integration,
physical audio, manual accessibility evidence, deployment, and final hardware
qualification remain.

The implementation follows the seven phases defined in the MVP specification
while preserving a platform-independent Agent Core. Some provider work was
delivered before all Phase 3 acceptance items; the next work returns to Phase 3
closure before continuing to generic MCP, physical audio, and deployment.
Every behavior-changing work package remains gated by explicit user
confirmation.

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
- The first real AI integration is non-streaming Azure OpenAI for LLM, STT, and TTS.
- Alibaba Cloud Model Studio is the first supported OpenAI-compatible third-party LLM provider.
- Bailian migration must require only API key, base URL, and model name changes for compatible Chat Completions behavior.
- Voice supports explicit Native Multimodal and Composed pipeline modes.
- Buffered request/response remains the compatibility baseline.
- Composed routes may independently enable Streaming STT, Streaming Chat LLM,
  and Streaming TTS only when the runtime transport, assigned adapter, and
  model capability are all verified.
- A full-chain streaming route enables all three roles and begins ordered TTS
  synthesis from stable LLM text segments before the final LLM completion.
- Full-chain streaming does not imply VAD, full-duplex conversation, barge-in,
  or interruption of active TTS playback.
- Native Multimodal uses one audio-capable model for audio input, reasoning/tools, and audio output.
- Composed uses independent STT, Chat LLM, and TTS model assignments.
- Provider endpoints and credentials belong to reusable Connections; pipeline roles reference Model Deployments.
- LLM, STT, and TTS endpoints, credentials, deployments, API versions, regions, languages, voices, audio settings, and limits are independently configurable.
- Azure and MCP secrets are write-only in the API and Web Console and are stored in SQLite as plaintext protected by restrictive host filesystem permissions.
- The MVP provides generic third-party MCP integration rather than a required Home Assistant integration.
- MCP supports Streamable HTTP and stdio. OAuth is deferred.
- MCP servers and tools are disabled by default and require explicit administrator enablement.
- Administrators may configure arbitrary stdio commands after a prominent command-execution warning and explicit confirmation.
- Linux audio targets Debian or Ubuntu ARM64, ALSA, and standard USB Audio Class devices.
- Server-side physical audio input and output devices are selected independently
  in Settings through explicit dropdowns populated by the platform adapter.
- No physical audio device is selected implicitly. VoxMesh must not select the
  first discovered device or silently fall back to another physical or Mock
  device.
- Audio device IDs, sample rate, and channels are configurable; capture
  defaults to 16 kHz mono.
- Browser voice testing remains a separate browser-owned audio boundary and
  does not reuse or overwrite the server-side physical device selection.
- Wake-word detection uses the Apache-2.0 sherpa-onnx open-vocabulary keyword
  spotter through its Node.js addon in the Linux platform adapter.
- Wake-word detection is local and offline, requires no cloud service or
  access key, and consumes the selected physical input device as mono 16 kHz
  PCM.
- Wake-word detection is disabled by default and must be enabled explicitly
  after an input device and packaged keyword profile are selected.
- VAD remains deferred. The first wake-word flow uses a bounded configurable
  utterance window after detection rather than indefinite recording.
- Releases provide Linux amd64 and arm64 images, archives, and Debian packages.
- NanoPi supports Docker Compose, systemd, scripts, and manual deployment with backup and one-command compatible rollback.
- TanStack Router is the required Web Console router.
- Navigation must use Browser History and stable URLs rather than component-local page state.
- TanStack Query is the preferred Web Console server-state and request-cache layer.
- TanStack Form is preferred for complex validated forms.
- Every Web Console surface must support localization.
- The initial supported locales are English (`en`) and Simplified Chinese (`zh-CN`).
- The localization architecture must allow additional locale resource packages without changing component logic.
- Language selection must be available in Settings and must persist across reloads.
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
- focused behavioral unit tests for every new or changed Web Console component
- integration tests for storage, HTTP, WebSocket, package, and adapter boundaries
- Playwright end-to-end tests for every user-visible success flow and critical failure or recovery flow
- documentation updates for behavior, configuration, setup, operation, and recovery
- format, lint, strict type-check, unit, integration, e2e, and production-build validation

Tests must use mock providers and isolated temporary SQLite databases. Default tests must not require real AI credentials, third-party MCP servers, physical audio hardware, NanoPi hardware, or internet access.

Web Console implementation rules:

- Pages compose focused feature and shared components instead of accumulating unrelated UI and state in one file.
- Independent forms, panels, lists, status cards, selectors, and workflows are extracted into single-purpose components.
- Stateful orchestration and browser side effects are isolated in typed hooks or providers.
- Component files approaching 150 lines or containing multiple independent responsibilities trigger decomposition review.
- Every component has behavioral unit coverage for rendering, interactions, states, accessibility, localization, and theme behavior where applicable.
- Component tests use accessible queries and deterministic API or browser-boundary test doubles.

TanStack frontend architecture:

- Use TanStack Router with browser history for all Web Console navigation.
- Every user-addressable page and selected resource must have a stable, directly loadable URL.
- Initial routes must include `/setup`, `/login`, `/dashboard`, `/chat`, `/conversations`, `/conversations/$conversationId`, `/logs`, `/settings`, and not-found behavior.
- Protected routes must share an authenticated parent route or route guard rather than repeating authorization checks in page components.
- Setup and login redirects must preserve a safe intended destination.
- Browser refresh, direct links, forward navigation, and back navigation must preserve the expected page state.
- Validated search parameters must represent shareable or restorable state such as filters, pagination, selected tabs, and log categories.
- Ephemeral or sensitive state such as passwords and unsaved secret values must never be written to the URL.
- The Fastify static fallback must serve the Web Console entry point for valid client-side routes while preserving `/api/*` 404 behavior.
- Use route-level lazy loading when it provides measurable value without weakening type safety.
- Use TanStack Query for remote server state, including session, Dashboard, Conversations, Logs, and Settings.
- Query keys must be centralized, typed, and stable. Mutations must explicitly invalidate or update affected queries.
- Duplicate `useEffect` request orchestration must be removed when a query owns the remote state.
- Use TanStack Form for complex forms such as provider, MCP, and future audio configuration. Simple isolated controls MAY remain controlled components when that is clearer.
- TanStack Table and TanStack Virtual SHOULD be used only when real table or large-list requirements justify them.
- TanStack Devtools MAY be enabled in development but MUST NOT be exposed in production.
- Router, query, form, localization, and theme providers must remain independently testable.

OpenAI-compatible provider rules:

- Implement one generic OpenAI-compatible LLM adapter rather than one adapter per compatible vendor.
- Configure API key, base URL, model name, timeout, and output limits.
- Keep Azure OpenAI in its existing adapter because Azure deployment URLs and API versions have different semantics.
- Treat model tool support as a capability that must be verified, not assumed.
- Preserve generic Agent Core messages, tool calls, tool results, finish reasons, and normalized errors.
- Keep provider credentials write-only and redacted.
- Add offline contract fixtures and opt-in credentialed smoke tests.

Voice pipeline rules:

- Support `native-multimodal` and `composed` runtime modes.
- Never silently change voice pipeline mode or activate a fallback.
- Native Multimodal requires verified audio-input and audio-output capabilities.
- Native Multimodal routes using MCP also require verified tool-calling support.
- Composed routes independently assign STT, Chat LLM, and TTS model deployments.
- Credentials and endpoints belong to Provider Connections rather than pipeline roles.
- Model Deployments declare and verify capabilities separately.
- Persist the selected route and safe model metadata in every conversation.
- Keep raw audio ephemeral by default.

Cross-platform development rules:

- Root commands must use Node.js or package-manager tooling rather than Bash-only syntax.
- Paths, process spawning, temporary directories, environment variables, signals, line endings, and executable resolution must use cross-platform APIs.
- Fixtures and assertions must not depend on platform-specific separators or newline conventions.
- Linux-only tests must be explicitly labeled; equivalent contract tests with fakes remain mandatory everywhere.
- CI must continuously validate Linux, macOS, and Windows.

Localization rules:

- User-facing Web Console text must use stable translation keys rather than hard-coded component strings.
- English is the source locale and mandatory fallback.
- Simplified Chinese must have complete translation coverage for every implemented Web Console feature.
- Initial locale selection uses the saved preference when present, otherwise maps the browser language to a supported locale and falls back to English.
- The language preference is browser-local and must not require authentication. A compact selector must remain available on first-run setup and login screens; the full selector is available in Settings.
- Locale resources must be separated by locale and feature so new languages can be added without editing application components.
- Dates, times, numbers, lists, and future units must use locale-aware platform formatting APIs.
- Server logs, API error codes, persisted technical events, source code, tests, and documentation remain in English. The Web Console maps stable error codes to localized messages and falls back to the safe English server message when no translation exists.
- Missing translation keys must be visible in development and must fail an automated translation-coverage check.
- English and Simplified Chinese must both be covered by component or browser tests for navigation, forms, validation, authentication, Settings, Chat, Conversations, and Logs.

Appearance rules:

- Every Web Console surface must support Light and Dark themes.
- The initial appearance options are Light, Dark, and System.
- System mode is the default and must follow the operating-system `prefers-color-scheme` value.
- System mode must react immediately when the operating-system preference changes.
- The selected mode must be stored in the browser and apply before or during the first render without a persistent incorrect-theme flash.
- Theme selection must be available in Settings and apply immediately without a page reload.
- Components must use semantic design tokens or CSS variables rather than hard-coded theme-specific colors.
- Focus, hover, disabled, error, success, border, background, and text states must remain readable in both themes.
- Browser tests must cover explicit Light and Dark selection, persistence after reload and sign-out, System selection, and the resolved `data-theme` value.

Accessibility rules:

- Every Web Console route and state must meet WCAG 2.2 AA.
- Normal text requires at least 4.5:1 contrast; large text, meaningful UI boundaries, and focus indicators require at least 3:1.
- English and Simplified Chinese must preserve labels, heading hierarchy, focus order, and readable layouts.
- Light and Dark themes must both pass automated color-contrast checks.
- Native semantic HTML is preferred over ARIA.
- Every function must be keyboard operable with a visible focus indicator.
- Route changes must provide an intentional focus target and meaningful page heading.
- Forms must expose programmatically associated labels, instructions, errors, disabled state, and success status.
- Error and success messages that appear asynchronously must use appropriate live-region semantics.
- Color must not be the only indicator of state.
- Content must remain usable at 200% zoom and narrow responsive widths.
- Automated gates include jsx-a11y linting, accessible component queries, Playwright axe scans, and route/form keyboard tests.
- Automated scans must cover representative English/Chinese and Light/Dark combinations.
- Significant UI work also requires manual keyboard and visual contrast review.

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
- Add the localization provider, English and Simplified Chinese resource bundles, browser-language detection, English fallback, and persisted language preference.
- Provide a compact language selector on setup and login screens.
- Add an appearance provider with Light, Dark, and System modes, System default, browser persistence, and live `prefers-color-scheme` synchronization.
- Apply the resolved theme through semantic CSS variables used by every shell and authentication surface.
- Add TanStack Router with browser history, typed routes, authenticated layout guards, setup/login redirects, and a not-found route.
- Add TanStack Query with a shared client, typed query-key factories, consistent retry behavior, and localized error boundaries.
- Add structured logging with redaction and correlation IDs.
- Add graceful startup and shutdown behavior.
- Keep CORS disabled or same-origin by default.

Acceptance gate:

- `pnpm dev` starts the server and Web Console in Mock Mode.
- Playwright completes first-run setup, login, refresh, logout, and denied-access flows.
- Setup, login, and the authenticated shell render correctly in both English and Simplified Chinese.
- Setup, login, and the authenticated shell render correctly in Light and Dark themes.
- Direct navigation, refresh, browser back, and browser forward work for every implemented route.

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
- Load remote state through TanStack Query and preserve the Dashboard URL during refresh.

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
- Represent the selected conversation in `/conversations/$conversationId` rather than component-local selection state.

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
- Store shareable log filters in validated URL search parameters.

### 7.6 Configuration UI

- Expose safe settings for providers, MCP servers, audio devices, and non-secret server behavior.
- Provide a dedicated Audio Settings section with separate **Input device** and
  **Output device** dropdowns for server-side physical capture and playback.
- Populate device dropdowns from safe platform-adapter discovery metadata and
  provide an explicit refresh action.
- Include a **No device selected** option and require an administrator to make
  each selection explicitly.
- Persist stable device IDs rather than transient list positions or display
  labels.
- If a saved device is missing, retain its configured ID, show it as
  unavailable, and block physical voice operations instead of changing the
  selection.
- Provide bounded **Test input** and **Test output** actions. Input testing
  shows a live level meter without retaining audio; output testing plays a
  bundled local sample so hardware can be isolated from provider failures.
- Announce discovery, refresh, test, unavailable, busy, permission, and failure
  states accessibly. Dropdowns and test actions must remain keyboard usable in
  English and Simplified Chinese at narrow widths and 200% zoom.
- Treat secrets as write-only fields.
- Validate changes before persistence and indicate restart requirements.
- Use version checks to prevent silent overwrites.
- Provide a language selector for English and Simplified Chinese.
- Apply language changes immediately without a page reload and persist the preference for future visits.
- Provide Light, Dark, and System appearance options.
- Apply appearance changes immediately and persist the selected mode.
- Use TanStack Form for provider and future MCP or audio configuration when cross-field validation or write-only secret handling is required.
- Use TanStack Query mutations and explicit invalidation for saved server configuration.

### 7.7 Browser History Routing

- Replace runtime-only page selection with TanStack Router navigation.
- Define typed routes for setup, login, Dashboard, Chat, Conversations, conversation detail, Logs, Settings, and not-found behavior.
- Use an authenticated layout route for the sidebar and protected content.
- Redirect unauthenticated users to login while preserving a safe return target.
- Redirect first-run installations to setup before protected routes render.
- Ensure valid nested routes are served by the Fastify SPA fallback.
- Keep navigation labels localized while route paths remain stable and language-neutral.
- Use validated search parameters for restorable filters and view state.
- Store the active Settings section in the validated `section` search parameter.

Acceptance gate:

- Every route can be loaded directly and refreshed without a server 404.
- Browser back and forward restore the expected page and URL state.
- Conversation detail has a stable URL.
- Authentication and first-run redirects do not loop or expose protected content.
- Route tests cover valid, protected, unknown, and malformed URLs.

### 7.8 Localization and Language Extensibility

- Organize locale resources by feature, including common navigation, authentication, Dashboard, Chat, Conversations, MCP, Logs, Settings, validation, and errors.
- Define a typed or statically checked translation-key contract so renamed or missing keys are detected during development.
- Keep locale selection independent from the single-administrator account so the setup and login experience can use the saved language.
- Use `Intl` formatting for dates, times, numbers, lists, and future measurement units.
- Ensure layouts tolerate longer translations without truncating controls or breaking responsive behavior.
- Document the process for adding a locale, validating coverage, and adding locale-specific tests.

Acceptance gate:

- Every Web Console route and state is usable in English and Simplified Chinese.
- Switching languages updates the current screen immediately and survives reload and sign-out.
- Adding a fixture locale requires resource files and tests, but no component logic changes.

### 7.9 Appearance and Theme Extensibility

- Define semantic CSS tokens for page, panel, elevated surface, border, primary and muted text, accent, interactive states, error, success, and shadows.
- Resolve the selected appearance mode to Light or Dark and expose it through the root document element.
- Listen for operating-system theme changes only while System mode is selected.
- Keep theme logic independent from authentication and locale so setup and login use the same persisted appearance.
- Document how to add or adjust semantic tokens without introducing component-level color branches.

Acceptance gate:

- Every current Web Console route and state is usable in Light and Dark themes.
- Light, Dark, and System changes apply immediately and persist correctly.
- System mode follows live operating-system theme changes.
- Theme implementation does not require conditional rendering in feature components.

### 7.10 Phase 3 End-to-End Matrix

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
- English and Simplified Chinese setup, login, navigation, Settings, Chat, Conversations, Logs, validation, and error rendering
- language switching, persistence, browser-language detection, and English fallback
- Light, Dark, and System selection, persistence, and resolved system-theme behavior
- direct route loading, refresh, deep links, back/forward navigation, protected-route redirects, and not-found behavior
- axe scans for representative English/Chinese and Light/Dark routes
- keyboard focus, route focus movement, form errors, live status, zoom, and responsive layout

Acceptance gate:

- All MVP Web Console areas work against Mock Mode on a normal development machine.
- Every browser-visible feature has success and critical failure or recovery coverage.

## 8. Phase 4 - Azure AI Provider Integration

Phase 4 requires explicit confirmation after Phase 3 acceptance.

### 8.1 Configuration and Secrets

- Add write-only Azure OpenAI endpoint, deployment, API version, and API key settings.
- Add write-only Azure OpenAI speech endpoint and API key settings.
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

### 8.3 OpenAI-Compatible LLM Adapter

- Implement configurable Chat Completions support using base URL, API key, and model name.
- Use Alibaba Cloud Model Studio as the first compatibility target.
- Support models such as `qwen-plus` when available in the configured region.
- Map generic messages, tools, tool calls, tool results, finish reasons, usage, and errors.
- Validate base URLs and prevent credentials from appearing in logs or errors.
- Keep the adapter vendor-neutral so other OpenAI-compatible providers can reuse it.
- Add configuration, mapping, tool-calling, error, timeout, and malformed-response tests.
- Add an opt-in Model Studio live smoke test outside default CI.

### 8.4 Azure OpenAI Audio STT

- Implement complete-buffer speech recognition behind the generic STT interface.
- Default to validated 16 kHz mono PCM or WAV while allowing supported configured formats.
- Configure recognition language and enforce duration and payload limits.
- Convert or explicitly reject unsupported input; never silently reinterpret audio.
- Normalize no-speech, rejected recognition, invalid audio, quota, authentication, timeout, cancellation, and service failures.
- Do not retain uploaded audio after the operation unless a future diagnostic feature is separately approved.

### 8.5 Azure OpenAI Audio TTS

- Implement complete-response synthesis behind the generic TTS interface.
- Configure voice, language, format, sample rate, timeout, and text limits.
- Return explicit audio metadata with every generated buffer.
- Normalize invalid voice, unsupported format, quota, authentication, timeout, cancellation, and service failures.
- Never silently switch voice or format.

### 8.6 Selection, Health, Tests, and Documentation

- Allow Mock, Azure, and OpenAI-compatible LLM providers to be selected independently from STT and TTS.
- Validate required Azure and OpenAI-compatible settings before adapter activation.
- Expose safe readiness and last-error status.
- Keep Mock Mode as the offline deterministic default; fallback must be explicit.
- Unit-test configuration, mapping, limits, retries, cancellation, normalization, and redaction.
- Use sanitized fixtures for deterministic contract tests.
- Add opt-in live Azure smoke tests and an opt-in live voice pipeline e2e test outside default CI.
- Document resource setup, deployments, API versions, regions, languages, voices, quotas, cost controls, secret rotation, and diagnostics.

Buffered Phase 4 acceptance:

- The non-streaming Azure OpenAI STT -> Agent Core -> Azure OpenAI TTS flow works.
- Direct and MCP-assisted Azure OpenAI responses work without Agent Core changes.
- Direct and MCP-assisted Alibaba Cloud Model Studio responses work through the generic OpenAI-compatible adapter.
- Azure failures are diagnosable without secret exposure.
- Default CI remains offline and deterministic.

### 8.7 Capability-Gated Full-Chain Streaming

Transport and protocol:

- Add a dedicated authenticated `/api/voice-stream` WebSocket endpoint rather
  than overloading the buffered `/api/voice` request.
- Define a versioned session protocol with explicit start, ready, audio-frame,
  input-finished, partial-transcript, final-transcript, llm-text-delta,
  llm-tool-call-delta, tool-started, tool-finished, llm-finished,
  output-segment-started, output-frame, output-segment-finished,
  output-finished, cancelled, and failed states.
- Use JSON control envelopes and bounded binary audio frames with session ID,
  direction, format, and monotonically increasing sequence information.
- Reject unknown versions, invalid ordering, duplicate terminal messages,
  oversized frames, excessive frame rates, unsupported formats, and route
  changes during a session.
- Authenticate during the WebSocket upgrade with the established administrator
  session. Never place credentials or sensitive configuration in message
  payloads, URLs, logs, or close reasons.
- A dropped connection cancels the provider session and releases browser,
  server, and provider resources. MVP reconnect starts a new voice session; it
  never claims to resume an interrupted provider stream.

Browser input and playback:

- Capture mono PCM frames through Web Audio/AudioWorklet rather than waiting
  for a complete `MediaRecorder` container.
- Negotiate and validate sample rate, channels, sample format, frame duration,
  and maximum buffered duration before accepting audio.
- Reuse the microphone loudness calculation without retaining duplicate audio
  buffers or opening a second browser stream.
- Play Streaming TTS through a bounded Web Audio queue that uses explicit
  audio metadata and reports underrun, unsupported-browser, and decode errors.
- Render Streaming Chat text deltas incrementally and reconcile them with one
  final persisted assistant message.
- Disable streaming controls when required browser APIs are unavailable.
  Never silently send the same route through the buffered endpoint.

Provider contracts, Agent Core, and routing:

- Add optional `StreamingSpeechToTextProvider` and
  `StreamingTextToSpeechProvider` contracts behind the provider-independent
  audio boundary.
- Add a provider-independent `StreamingLlmProvider` that emits typed text,
  tool-call, usage, completion, and failure events. HTTP SSE parsing remains in
  provider adapters.
- Extend Agent Core with a bounded streaming state machine that accumulates and
  validates fragmented tool-call names/arguments, executes MCP only after a
  complete validated call, and supports a streaming follow-up completion.
- Persist one final assistant message. Partial text and tool-call deltas are
  observable events, not separate conversation messages.
- Streaming STT accepts ordered PCM chunks and emits safe partial transcripts
  plus one final transcript. Partial transcripts are observational and are not
  sent to Agent Core.
- Agent Core starts Streaming Chat after the final transcript.
- Implement Azure OpenAI and generic OpenAI-compatible Chat streaming through
  `stream: true` HTTP SSE, including fragmented text, finish reasons, usage, and
  tool-call arguments. Use a maintained SSE parser rather than ad hoc line
  splitting.
- Alibaba Chat uses the generic OpenAI-compatible streaming adapter.
- Buffer LLM deltas into stable speech segments using punctuation, bounded
  character count, and bounded wait time. Preserve exact final text and
  synthesize segments sequentially to guarantee playback order.
- Do not send pre-tool explanatory text to TTS when a turn resolves to a tool
  call. Speech begins from the final post-tool assistant stream.
- Streaming TTS exposes ordered audio chunks as an async iterable with one
  terminal metadata result.
- Implement deterministic Mock streaming adapters first.
- Adapt Alibaba Fun-ASR and Qwen-Audio-TTS/CosyVoice because their current
  provider protocols already exchange incremental binary frames.
- Azure and generic OpenAI-compatible models remain buffered unless a specific
  endpoint and model declare streaming, pass contract tests, and complete
  capability verification.
- Add an independent Chat streaming switch to Runtime Routes alongside the
  existing STT and TTS switches.
- Preserve all independent combinations across the three roles. The
  full-chain profile enables STT, Chat, and TTS streaming together.
- Route activation requires the runtime transport plus declared and verified
  `streaming` capability for every enabled role.

Backpressure, cancellation, and lifecycle:

- Bound browser, server, provider, and playback queues by bytes, frames, and
  duration.
- Bound accumulated LLM text, fragmented tool-call arguments, pending speech
  segments, synthesized audio, and playback duration.
- Define high-water and low-water marks. Pause production where supported or
  fail explicitly when pressure cannot be relieved.
- Bound session setup, silence-independent maximum capture, provider response,
  Agent, first-audio, total synthesis, and idle durations.
- Cancellation must propagate to browser capture, STT, Agent work when
  cancellable, LLM SSE streams, MCP work when cancellable, TTS, playback,
  timers, queues, and provider sockets.
- Do not retry non-idempotent streaming sessions automatically.
- Persist safe stage, latency, byte/frame count, partial/final status, cancel,
  LLM delta/segment count, tool lifecycle, pressure, and failure events without
  storing raw audio, secret payloads, or unbounded token fragments.

Testing and acceptance:

- Unit-test protocol ordering, sequence validation, frame limits, capability
  gates, streaming LLM delta assembly, fragmented tool calls, semantic speech
  segmentation, queue bounds, pressure transitions, cancellation, timeouts,
  cleanup, duplicate terminals, and redaction.
- Integration-test WebSocket authentication, binary framing, Mock streaming
  providers, partial/final STT, direct Streaming Chat, streaming tool calls,
  MCP follow-up Streaming Chat, TTS segment ordering, chunked audio,
  disconnect, provider failure, and resource release.
- Playwright-test permission denial, unsupported browsers, independent
  STT/Chat/TTS switches, partial transcript and LLM text rendering, streamed
  tool-assisted output, first-audio-before-final-text, cancellation,
  reconnect-as-new-session, failure recovery, keyboard access, status
  announcements, localization, themes, responsive zoom, and axe scans.
- Add opt-in credentialed Alibaba live streaming smoke tests with strict
  duration, request, cost, retention, and redaction safeguards.
- Measure microphone-to-partial-transcript latency, final-transcript latency,
  final-transcript-to-first-LLM-token latency, first-token-to-first-speech-
  segment latency, final-transcript-to-first-audio latency, underruns, queue
  depth, CPU, memory, and network use.

Streaming acceptance:

- A supported route can independently stream STT, Chat LLM, TTS, or any
  combination without using a buffered provider call for an enabled streaming
  role.
- A full-chain route displays incremental final-turn assistant text and begins
  ordered TTS playback before the final LLM completion.
- Streaming tool calls are fully assembled and validated before MCP execution,
  and only the final post-tool assistant stream is synthesized.
- Unsupported routes remain impossible to activate and receive actionable
  capability or transport errors.
- Disconnect, cancellation, timeout, pressure, and provider failures release
  every resource and never produce a success-shaped result.
- Agent Core remains independent of WebSocket, browser, and vendor streaming
  APIs.

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
- Run with privileges no broader than the VoxMesh service account.
- Bound startup, initialization, calls, idle time, shutdown, restart count, and crash-loop behavior.
- Redact sensitive environment values from diagnostics.
- Terminate only process trees started and tracked by VoxMesh.
- Display a persistent Web Console warning that arbitrary stdio configuration grants command execution as the VoxMesh service account.
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

## 10. Phase 6 - Debian/Ubuntu ALSA USB Audio and Wake Word

Phase 6 requires explicit confirmation after Phase 5 acceptance and access to representative Linux ARM64 hardware.

### 10.1 Scope and Devices

- Target Debian or Ubuntu ARM64 with ALSA while keeping the adapter testable on Linux amd64.
- Support standard USB Audio Class capture and playback devices without model-specific logic.
- Define platform-independent audio discovery contracts that return stable ID,
  direction, safe display name, availability, supported formats, and a
  platform-neutral status.
- Enumerate capture and playback devices separately and expose only safe
  metadata through authenticated APIs.
- Configure input and output IDs independently through Settings dropdowns.
- Use a visible **No device selected** state as the default.
- Persist selected stable IDs across service and device restarts.
- Provide explicit refresh after hot-plug changes; automatic discovery may
  supplement but must not replace the administrator-controlled refresh path.
- Retain missing saved IDs as unavailable selections so reconnecting the same
  stable device can restore readiness without choosing a different device.
- Never silently select another device or fall back to Mock Audio.
- Expose unavailable, busy, permission-denied, unsupported-format, disconnected, and error states.
- Keep Linux audio optional so macOS and Windows can install, build, test, and run Mock Mode without ALSA dependencies.

### 10.2 Formats and Lifecycle

- Configure sample rate, channels, sample format, and buffering.
- Default capture to 16 kHz mono, 16-bit PCM.
- Validate settings against device capabilities before use.
- Convert supported ALSA, Azure OpenAI Audio, WAV, and PCM formats at adapter boundaries.
- Preserve audio metadata and reject unapproved lossy conversion.
- Implement capture and playback start, stop, cancellation, timeout, duration limits, queue policy, cleanup, and graceful shutdown.
- Apply changed device selections to the next physical audio operation after
  validation; never switch a device during an active capture or playback.
- Implement a bounded input test that exposes live loudness only and discards
  captured samples immediately.
- Implement an output test with a bundled local audio sample and explicit
  completion/failure status, independent of TTS provider availability.
- Release handles after success, failure, cancellation, shutdown, or removal.
- Normalize busy, disconnect, overrun, underrun, permission, format, timeout, and backend errors.

### 10.3 Permissions and Qualification

- Document and validate `/dev/snd`, audio groups, udev behavior, and service-account access.
- Map only required devices in Docker; never require privileged mode.
- Use a dedicated service account for systemd and manual deployment.
- Run platform-independent audio contract tests on macOS, Linux, and Windows.
- Run fake ALSA integration in default CI and native ALSA integration only on Linux.
- Qualify representative USB Audio Class hardware on Debian or Ubuntu ARM64.
- Component- and Playwright-test dropdown loading, explicit selection,
  persistence, missing saved devices, refresh, input level testing, output
  testing, validation errors, keyboard behavior, localization, themes, and
  responsive zoom with deterministic fake devices.
- Test enumeration, selection, capture, Azure STT, Azure TTS playback,
  cancellation, removal, reconnect, busy-device recovery, reboot persistence,
  and stability on Linux.

### 10.4 Offline Wake-Word Detection

Selected implementation:

- Use
  [sherpa-onnx open-vocabulary keyword spotting](https://k2-fsa.github.io/sherpa/onnx/kws/index.html)
  through the official Node.js addon.
- sherpa-onnx is Apache-2.0 licensed, performs inference locally, supports
  JavaScript and Linux ARM64, and accepts keyword files that can change phrases
  without retraining the acoustic model.
- This is preferred over openWakeWord because openWakeWord's supported runtime
  is Python-first and its packaged models are currently English-focused. It is
  preferred over Picovoice Porcupine because Porcupine requires a vendor
  AccessKey and introduces additional service terms.
- Keep sherpa-onnx imports and native binaries inside a Linux wake-word
  platform adapter. Agent Core and generic audio contracts depend only on a
  project-owned `WakeWordDetector` interface.
- Provide a deterministic Mock detector on macOS, Windows, and default CI.
- Package model, token, and keyword-profile artifacts with checksums, source,
  license, version, supported locale, expected sample format, and measured
  resource use.
- Pin the Node addon, model, and token artifact versions. If the target Node ABI
  has no compatible Linux ARM64 prebuilt addon, build it in the release
  pipeline; production devices must not compile native code at runtime.
- Generate curated keyword files during the artifact build using the official
  `text2token` tooling. Store the source phrase and generated profile together;
  do not require Python or keyword compilation on the deployed device.

Runtime behavior:

- Consume mono 16 kHz PCM frames from the explicitly selected physical input
  device without opening a second ALSA handle.
- Keep wake-word processing local; do not send or persist pre-trigger audio.
- Maintain only a bounded in-memory pre-roll buffer so the beginning of the
  post-trigger utterance is not clipped.
- Use an explicit state machine: disabled, starting, listening, triggered,
  capturing, processing, cooldown, and failed.
- On detection, optionally play a bundled local acknowledgement sound, then
  capture one bounded utterance and submit it to the existing buffered voice
  pipeline.
- Because VAD is deferred, stop initial capture using configurable minimum and
  maximum durations with a mandatory upper bound. Never record indefinitely.
- Ignore duplicate detections while capturing, processing, or in cooldown.
- Release model, stream, timers, buffers, and native resources on disable,
  device change, permission loss, disconnect, shutdown, or failure.
- A wake-word failure must not crash Agent Core or silently switch input
  devices. Manual browser voice testing remains available independently.

Settings and operations:

- Add a default-off **Enable wake word** control in Audio Settings.
- Provide a **Wake word profile** dropdown populated from packaged, validated
  profiles. The initial implementation uses curated profiles; arbitrary model
  upload and training remain out of scope.
- Include at least one English `Hey VoxMesh` profile. Add a Chinese profile
  only after model and hardware qualification meet the same false-accept and
  false-reject targets.
- Expose profile description, locale, model version, threshold, cooldown, and
  capture-window settings. Advanced numeric values require bounded validation
  and safe defaults.
- Provide a local **Test wake word** mode that shows listening/detected status
  and confidence without invoking STT, Agent Core, MCP, or TTS.
- Show disabled, model-missing, input-unavailable, permission-denied,
  unsupported-format, listening, triggered, cooldown, and failed states in the
  Dashboard and Settings.

Validation and qualification:

- Unit-test state transitions, threshold boundaries, duplicate suppression,
  cooldown, pre-roll bounds, timeouts, cancellation, cleanup, model validation,
  and redaction.
- Integration-test deterministic PCM fixtures for positive, negative,
  near-threshold, noise, repeated-trigger, disconnect, and corrupted-model
  cases.
- Playwright-test default-off behavior, profile selection, enablement,
  unavailable devices, test mode, status announcements, keyboard behavior,
  localization, themes, responsive zoom, and error recovery with a fake
  detector.
- Measure false accepts per hour, false rejects, detection latency, CPU,
  memory, and temperature on representative Debian/Ubuntu ARM64 hardware.
- Define qualification thresholds before enabling a profile by default. No
  profile may be shipped as enabled by default.

Phase 6 acceptance:

- A configured standard USB Audio Class device completes the non-streaming voice pipeline.
- An administrator can explicitly choose and persist independent input and
  output devices in Settings and verify both before starting the physical voice
  flow.
- Missing, disconnected, or unauthorized saved devices remain selected but
  unavailable; VoxMesh never substitutes another device.
- An administrator can explicitly enable a packaged wake-word profile and
  trigger one bounded physical voice request without cloud wake-word services.
- Pre-trigger audio is not persisted or transmitted, and wake-word detection
  remains local when the network and AI providers are unavailable.
- Wake-word false-accept, false-reject, latency, CPU, memory, and thermal
  measurements satisfy documented qualification thresholds on the target
  Linux ARM64 hardware.
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
docs/README.md
docs/MVP.md
docs/IMPLEMENTATION_PLAN.md
docs/DEVELOPMENT_RULES.md
docs/architecture/TECHNOLOGY_STACK.md
docs/architecture/VOICE_PIPELINES.md
docs/architecture/RUNTIME_ROUTING.md
docs/architecture/WAKE_WORD.md
docs/architecture/ARCHITECTURE.md
docs/architecture/API.md
docs/architecture/WEBSOCKET.md
docs/development/ACCESSIBILITY.md
docs/development/MOCK_MODE.md
docs/development/CONFIGURATION.md
docs/development/TESTING.md
docs/providers/AZURE_OPENAI.md
docs/providers/ALIBABA_CLOUD_MODEL_STUDIO.md
docs/operations/SECURITY_OPERATIONS.md
docs/operations/OPERATIONS.md
docs/adr/
deployments/*/README.md
```

Architecture decisions should cover:

- package boundaries and dependency direction
- runtime schema strategy
- TanStack Router route tree, authentication guards, URL state, query keys, and mutation invalidation
- WCAG 2.2 AA strategy, contrast tokens, keyboard model, route focus, form announcements, and automated audit scope
- localization architecture, translation-key validation, and locale fallback
- semantic theme tokens, appearance persistence, and system-theme resolution
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
5. Azure OpenAI LLM and Audio STT/TTS work without Agent Core changes.
6. Generic MCP works through Streamable HTTP and stdio with explicit server and tool enablement.
7. Linux USB audio works through a platform adapter.
8. NanoPi R2S deployment is reproducible and documented.
9. Required unit, integration, and end-to-end tests pass.
10. macOS, Linux, and Windows development validation passes, including Mock Mode and Playwright.
11. Linux ALSA, packaging, deployment, and hardware qualification passes on applicable targets.
12. Every Web Console feature passes English and Simplified Chinese coverage, and the language preference persists correctly.
13. Every Web Console feature passes Light and Dark coverage, and System mode follows the operating-system preference.
14. Every Web Console page supports direct loading, refresh, and browser history through TanStack Router.
15. Remote Web Console state uses typed TanStack Query keys and explicit mutation invalidation.
16. Every Web Console feature passes WCAG 2.2 AA accessibility validation, including contrast, keyboard, focus, themes, locales, zoom, and representative axe scans.
17. Secrets are redacted, migrations are safe, and backup and rollback procedures are documented.
18. No commit, push, pull request, merge, or release occurs without separate explicit user confirmation.

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
- VAD, full-duplex barge-in, long-term memory, multi-agent behavior, and other
  MVP non-goals remain excluded.
- Capability-gated full-chain Streaming STT/Chat LLM/TTS is included after
  buffered Phase 4 acceptance and remains separately confirmed before
  implementation.
- Offline wake-word detection is included in Phase 6 using sherpa-onnx and
  remains separately gated from ALSA implementation by explicit confirmation
  and hardware qualification.
- Every phase requires fresh user confirmation even when its technical direction is documented.
