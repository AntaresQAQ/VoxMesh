# Technology Stack and Development Guide

## 1. Purpose

This document explains the technology choices used by VoxMesh, the responsibility of each framework and dependency, and the expected extension path for future development.

Read this document together with:

- [MVP Development Specification](./MVP.md)
- [Implementation Plan](./IMPLEMENTATION_PLAN.md)
- [Mandatory Development Rules](./DEVELOPMENT_RULES.md)

The package manifests and `pnpm-lock.yaml` are the authoritative source for installed versions. Version ranges below describe the currently selected dependency families.

## 2. Core Principles

Technology choices must preserve these boundaries:

- Agent Core remains independent from browsers, Fastify, databases, operating systems, hardware, and provider SDKs.
- The server application is the composition root.
- Provider, storage, MCP, audio, and platform behavior stays behind explicit interfaces.
- External inputs use runtime validation in addition to TypeScript types.
- Web Console remote state, navigation, forms, localization, and appearance remain independently testable.
- Mock Mode remains deterministic and requires no hardware or external credentials.

## 3. Runtime and Workspace

| Technology            | Current choice              | Responsibility                                         |
| --------------------- | --------------------------- | ------------------------------------------------------ |
| Runtime               | Node.js 22.12 or later      | Server runtime, tooling, tests, and build scripts      |
| Language              | TypeScript 5.9, strict mode | Type-safe application and test code                    |
| Module format         | ESM                         | Consistent module behavior across packages             |
| Workspace             | pnpm 10.27 monorepo         | Dependency management, workspace linking, and lockfile |
| Development execution | `tsx`                       | Fast TypeScript server development and watch mode      |
| Server bundling       | `tsup`                      | Production ESM server bundle                           |
| Web bundling          | Vite 7                      | React development server and production assets         |

Normal development commands must remain cross-platform and must not require Bash-specific syntax.

## 4. Repository Packages

```text
apps/
  server/                 Fastify composition root and HTTP application
  web/                    React Web Console
packages/
  agent-core/             Provider-independent agent runtime
  ai/                     AI provider adapters
  audio/                  Audio metadata and Mock STT/TTS providers
  shared/                 Runtime schemas and cross-package contracts
  storage/                Storage interfaces and SQLite implementation
tests/
  e2e/                    Playwright browser tests
```

### Dependency direction

```text
apps/server
  -> packages/agent-core
  -> packages/ai
  -> packages/storage
  -> packages/shared

apps/web
  -> packages/shared

packages/agent-core
  -> packages/shared

packages/ai
  -> packages/agent-core
  -> packages/shared

packages/storage
  -> packages/shared
```

Do not add imports that reverse these directions.

## 5. Backend Stack

### Fastify

Installed family: Fastify 5.

Fastify owns:

- HTTP routing
- request and response lifecycle
- schema validation integration
- authentication hooks
- structured request logging
- static Web Console delivery
- SPA fallback for browser-history routes
- graceful startup and shutdown

Related packages:

- `@fastify/cookie` for the administrator session cookie
- `@fastify/static` for production Web Console assets
- `@fastify/type-provider-typebox` for schema-derived route types

Keep business orchestration out of Fastify route handlers. Route handlers should validate, authorize, invoke an application or domain service, and map the result.

### Runtime schemas with TypeBox

Installed family: `@sinclair/typebox` 0.34.

TypeBox schemas in `packages/shared` are the source of truth for current HTTP payloads. They provide:

- runtime validation
- inferred TypeScript types
- shared server and Web Console contracts
- explicit API error shapes

Do not rely on TypeScript interfaces alone at HTTP, WebSocket, MCP, configuration, storage-deserialization, or provider boundaries.

### Authentication

The current single-administrator model uses:

- salted Node.js `scrypt` password hashes
- random opaque session tokens
- SHA-256 session-token hashes in storage
- server-side expiry and revocation
- `HttpOnly` and `SameSite=Strict` cookies
- optional `Secure` cookies for future HTTPS deployments

Do not introduce client-side-only authorization or return password hashes, session tokens, or existing secrets.

### SQLite

Installed family: `better-sqlite3` 12.

SQLite currently stores:

- administrator credentials
- sessions
- conversations
- messages
- logs
- application settings

The server bundle keeps `better-sqlite3` external because it contains a native module. The server package declares it directly so production module resolution remains valid.

New schema changes must use ordered, versioned migrations. Do not expose SQLite-specific types to Agent Core.

## 6. Agent and AI Stack

### Agent Core

`packages/agent-core` defines:

- provider-independent LLM contracts
- generic MCP server contracts
- tool definitions and calls
- bounded tool-call orchestration
- normalized agent events
- deterministic Mock LLM and Mock MCP implementations

Agent Core must never import vendor SDKs, Fastify, React, SQLite, ALSA, or platform APIs.

### Azure OpenAI

`packages/ai` currently contains a non-streaming Azure OpenAI Chat Completions adapter.

Supported configuration:

- Azure OpenAI endpoint
- deployment name
- API version
- API key

The adapter maps generic messages, function definitions, tool calls, tool results, and errors at the provider boundary.

The current API key is write-only through the Web Console but is stored as plaintext in SQLite under the explicitly accepted host-filesystem trust model. Database and backup permissions are therefore security-critical.

### Planned Azure Speech

Azure OpenAI Audio STT and TTS are implemented through the provider-independent `packages/audio` contracts.

Current Azure OpenAI Audio adapters support:

- multipart non-streaming transcription requests
- non-streaming WAV speech synthesis
- independent Mock/Azure selection for STT and TTS
- independent STT/TTS endpoints and write-only API keys
- language, voice, instructions, deployment, and API version configuration

Configuration and troubleshooting are documented in [AZURE_OPENAI.md](./AZURE_OPENAI.md).

Azure AI Speech Service remains planned as an optional future adapter.

Future adapters must:

- remain outside Agent Core
- use complete non-streaming requests for the MVP
- validate audio formats explicitly
- return typed audio metadata
- normalize provider errors
- support deterministic contract tests and opt-in live smoke tests

### Mock speech and audio

`packages/audio` defines provider-independent audio metadata, STT, and TTS contracts.

Current Mock Mode implementations:

- validate browser audio input
- return a deterministic transcript
- generate a valid mono 16 kHz PCM WAV tone

The Mock Voice API and browser controls are documented in [MOCK_MODE.md](./MOCK_MODE.md).

VoxMesh defines two voice pipeline modes: Native Multimodal and Composed. The planned connection, model capability, routing, fallback, and observability architecture is documented in [VOICE_PIPELINES.md](./VOICE_PIPELINES.md).

The runtime currently implements both modes with deterministic Mock providers. Native Multimodal has a provider-independent audio/tool loop and a Mock provider; a real native multimodal model adapter is not yet implemented.

## 7. Web Console Stack

### React

Installed family: React 19.

Components are organized by feature and responsibility:

```text
apps/web/src/
  components/             Shared layout and reusable presentation
  features/               Feature-owned pages, forms, and components
  i18n/                   Locale resources and localization provider
  theme/                  Appearance provider and semantic theme controls
  test/                   Component test utilities
  utils/                  Small shared Web Console utilities
  router.tsx              Typed route tree and authentication guards
  query.ts                Query client, keys, and query options
```

Pages compose focused components. Components approaching 150 lines or owning multiple independent responsibilities must be reviewed for decomposition.

### TanStack Router

Installed family: TanStack Router 1.

TanStack Router provides:

- Browser History
- typed route paths and parameters
- direct links and refresh support
- browser back and forward behavior
- authenticated parent-route guards
- first-run setup and login redirects
- safe return targets
- conversation-detail deep links
- not-found handling

Current routes:

```text
/setup
/login
/dashboard
/chat
/conversations
/conversations/$conversationId
/logs
/settings
```

Settings uses a validated `section` search parameter:

```text
/settings?section=general
/settings?section=providers
/settings?section=security
```

LLM, STT, and TTS configuration is grouped in the AI Providers section.

New user-addressable features require stable routes. Use validated search parameters for filters, pagination, tabs, and other shareable state. Never put secrets or unsaved password values in the URL.

### TanStack Query

Installed family: TanStack Query 5.

TanStack Query owns remote server state:

- setup status
- session status
- Dashboard
- Conversations and conversation details
- Logs
- LLM configuration

Query keys are centralized in `apps/web/src/query.ts`. Mutations must update or invalidate affected keys explicitly.

Do not add duplicate `useEffect` request orchestration when TanStack Query owns the data.

### TanStack Form

Installed family: TanStack Form 1.

TanStack Form is used for complex forms with related state and submission behavior, including:

- administrator password rotation
- LLM provider configuration

Future MCP and audio configuration should follow the same pattern. Simple isolated selectors may remain controlled components when that is clearer.

### Localization

The current localization layer is project-owned and type checked.

Supported locales:

- English (`en`) as the source and fallback locale
- Simplified Chinese (`zh-CN`)

Rules:

- components use stable translation keys
- locale resource key coverage is tested
- browser language is used when no preference exists
- the saved preference uses browser local storage
- `Intl` formats locale-sensitive values

Adding a locale should require a resource file and tests, not component changes.

### Appearance

The Web Console uses semantic CSS variables rather than component-level theme branches.

Supported modes:

- Light
- Dark
- System

System is the default and follows live `prefers-color-scheme` changes. The selected mode is stored in browser local storage and resolved before the React application renders.

### Styling

The current implementation uses plain CSS with semantic design tokens.

Tailwind CSS appears in the original MVP technology list but is not currently installed. Do not add Tailwind, another CSS framework, or a component library without a separately confirmed migration plan and a demonstrated benefit.

## 8. Testing Stack

| Layer           | Technology                                    | Required coverage                                    |
| --------------- | --------------------------------------------- | ---------------------------------------------------- |
| Unit            | Vitest 3                                      | Business logic, schemas, providers, hooks, utilities |
| Component       | React Testing Library                         | Every current and changed Web Console component      |
| DOM environment | jsdom                                         | Component rendering and browser API boundaries       |
| Integration     | Vitest + Fastify injection + temporary SQLite | API, auth, storage, provider boundaries              |
| End-to-end      | Playwright                                    | Browser-visible success and critical failure flows   |
| Accessibility   | jsx-a11y + Playwright axe                     | WCAG 2.2 AA static and browser checks                |

Component tests must use accessible queries and assert behavior rather than implementation details.

Playwright currently validates:

- first-run setup and login
- authenticated route guards
- Browser History and deep links
- Mock LLM and MCP chat
- conversation detail URLs
- Logs overflow layout
- Settings
- password rotation
- English and Simplified Chinese
- Light, Dark, and System appearance
- representative English/Chinese and Light/Dark axe scans
- route focus, skip navigation, and responsive overflow

## 9. Code Quality and CI

Current tools:

- ESLint 9
- `typescript-eslint`
- Prettier 3
- strict TypeScript
- GitHub Actions

The CI matrix targets:

- Ubuntu
- macOS
- Windows

Cross-platform jobs run formatting, linting, type-checking, unit tests, integration tests, and production builds through `pnpm validate:core`.

Browser end-to-end tests run once in the official Playwright container with Chromium and its Linux system dependencies preinstalled. The container version must match the resolved `@playwright/test` version in `pnpm-lock.yaml`. This avoids downloading browsers and repeatedly installing operating-system packages on every matrix runner.

CI uses a workflow-and-PR concurrency group with `cancel-in-progress: true`. When a new commit is pushed to a pull request, any older in-progress CI run for that pull request is cancelled automatically. Runs for other pull requests continue independently.

Linux-only audio, packaging, and hardware checks must remain separate from the cross-platform development workflow.

## 10. Planned Integration Technologies

The following areas are planned but their final implementation dependency must be confirmed immediately before development:

| Area                  | Planned direction                                                           |
| --------------------- | --------------------------------------------------------------------------- |
| MCP                   | Maintained official or compatible SDK; Streamable HTTP and stdio            |
| STT/TTS               | Azure OpenAI and dedicated Alibaba Model Studio adapters                    |
| OpenAI-compatible LLM | Generic adapter; Alibaba Cloud Model Studio is the first supported provider |
| Linux audio           | ALSA adapter for standard USB Audio Class devices                           |
| Deployment            | Multi-architecture Docker Compose, systemd, Debian packages, scripts        |
| Real-time events      | Authenticated WebSocket protocol with versioned envelopes                   |

Do not select an SDK solely because it is popular. Confirm maintenance status, license, platform support, security posture, bundle impact, and compatibility with project boundaries.

Alibaba Cloud Model Studio exposes an OpenAI-compatible Chat interface, but its
Fun-ASR and Qwen-Audio-TTS/CosyVoice services use a dedicated WebSocket task
protocol. VoxMesh therefore uses the generic compatible adapter for Chat and a
dedicated Alibaba provider for STT/TTS. Browser recordings are normalized to
mono PCM16 WAV before entering the provider-independent audio boundary. See
[ALIBABA_CLOUD_MODEL_STUDIO.md](./ALIBABA_CLOUD_MODEL_STUDIO.md).

Provider registrations include a stable ID, display name, capabilities, validation, and factory. The server merges registry metadata into one authenticated Provider Catalog API. Web Console LLM, STT, and TTS selectors filter the same catalog by `llm`, `stt`, or `tts` capability instead of hard-coding separate provider lists. A provider may expose only the capabilities its API actually supports.

System-managed Provider Connections, Model Deployments, and Runtime Routes now
mirror the compatibility configuration and are used for runtime assignment
resolution. Declared capabilities are migrated from provider roles; verified
capabilities are recorded after successful connection tests and reset when the
configuration fingerprint changes. See
[RUNTIME_ROUTING.md](./RUNTIME_ROUTING.md).

## 11. Adding a Feature

Before implementation:

1. Confirm behavior, scope, risks, acceptance criteria, and tests.
2. Create a dedicated branch from the latest `main`.
3. Identify the correct package and dependency direction.
4. Define or update runtime schemas before implementing external contracts.
5. Decide which state belongs in the URL, TanStack Query, TanStack Form, component state, or server storage.

During implementation:

1. Keep route components focused on route-level composition.
2. Keep server route handlers thin.
3. Put provider-specific mapping in adapters.
4. Add focused component and unit tests as components are created.
5. Add integration and end-to-end coverage for boundary and user-visible behavior.
6. Update documentation and implementation progress.

Before review:

```bash
pnpm validate
```

Then review the complete diff for unrelated changes, secrets, generated artifacts, skipped tests, and missing documentation.

## 12. Dependency Policy

- Reuse the standard library or an existing dependency when appropriate.
- Add a dependency only for a confirmed requirement.
- Prefer maintained, focused packages with clear licensing.
- Avoid overlapping libraries that solve the same problem.
- Keep provider and platform dependencies out of Agent Core.
- Keep browser-only dependencies out of server and domain packages.
- Keep native Linux dependencies optional on macOS and Windows.
- Update `pnpm-lock.yaml` with every dependency change.
- Separate unrelated dependency upgrades from feature commits.
- Record architecture-impacting dependency choices in an ADR.
