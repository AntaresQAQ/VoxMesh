# VoxMesh

VoxMesh is a platform-independent, voice-first AI agent gateway.

The project is designed to connect speech input, speech-to-text, an AI agent, MCP tools, text-to-speech, and voice output while keeping the Agent Core independent of hardware, operating systems, and AI providers.

## Project Status

VoxMesh has an initial Mock Mode vertical slice for development and architecture validation. It includes:

- a pnpm and TypeScript monorepo
- a Fastify server and React Web Console
- first-run administrator password setup and session authentication
- SQLite conversation and log persistence
- provider-independent Agent Core contracts
- deterministic Mock LLM and Mock MCP tool execution
- browser Mock Voice recording with Mock STT and generated WAV response
- authenticated browser streaming voice with AudioWorklet capture, partial
  transcript, tool activity, and bounded Web Audio playback
- live browser microphone loudness monitoring
- selectable Composed and Mock Native Multimodal voice pipeline modes
- system-managed provider connections, model deployments, runtime routes, and capability verification
- editable routing CRUD, explicit Native fallback, and independent capability-gated STT/TTS streaming switches
- Dashboard, Chat, Conversations, and live Logs pages
- Settings page for password rotation and Runtime Routing configuration
- write-only provider credentials and route-bound capability verification
- persisted, configuration-bound provider and route readiness diagnostics
- generic OpenAI-compatible LLM configuration, including Alibaba Cloud Model Studio
- Azure OpenAI and OpenAI-compatible Streaming Chat adapters, pending
  capability-verified runtime registration
- English and Simplified Chinese Web Console localization
- browser-language detection and persisted language selection
- Light, Dark, and System appearance modes
- persisted appearance selection with live operating-system synchronization
- feature-oriented, single-purpose React components
- React Testing Library behavioral tests for every current UI component
- TanStack Router with Browser History and deep-linkable pages
- TanStack Query for remote server state and cache invalidation
- TanStack Form for complex Settings workflows
- unit, integration, and Playwright end-to-end tests

Buffered real-provider Phase 4 is ready for explicit acceptance. Azure and
OpenAI-compatible direct/tool-assisted Chat and Alibaba dedicated
STT/TTS/composed voice are live-qualified. Azure Speech and standard compatible
Audio remain explicitly unqualified and tracked as non-blocking follow-up work;
see the [Phase 4 Acceptance Report](docs/qualification/PHASE_4_ACCEPTANCE.md).

Azure AI Speech Service, generic external MCP transports, physical audio, and
deployment packaging remain planned work. Azure OpenAI Audio STT/TTS is already
implemented. The physical-audio phase also plans local offline wake-word
detection through sherpa-onnx after explicit input-device selection.
Capability-gated full-chain Streaming STT/Chat LLM/TTS is also planned after
the buffered live-provider acceptance gate; unsupported routes continue to be
blocked rather than silently using buffered transport.

The Logs page combines a persisted HTTP snapshot with authenticated real-time
log and pipeline-event WebSocket delivery, replay, gap indication, and
URL-backed filters. Full-chain browser streaming is available for verified
Composed Runtime Routes; physical audio and wake-word detection are not
implemented yet.

The architecture is designed for:

- macOS, Linux, and Windows development
- Linux amd64 and arm64 deployment
- Docker Compose and native systemd deployment
- Mock Mode without hardware or external service credentials

## Requirements

- Node.js 22.12 or later
- pnpm 10.27

## Quick Start

```bash
pnpm install
pnpm build
pnpm --filter @voxmesh/server start
```

Open <http://127.0.0.1:3000>, create the first administrator password, sign in, and use Chat. Enter `Check the light status` to exercise the Mock LLM -> Mock MCP -> Mock LLM flow.

The Chat page also provides separate buffered and streaming voice controls. In
Mock Mode, **Start recording**, **Stop recording**, and **Play response**
exercise the buffered pipeline. **Start streaming**, **Finish input**, and
**Cancel streaming** use AudioWorklet capture and the authenticated
`/api/voice-stream` transport when the active Composed Runtime Route has
verified full-chain streaming capability. Streaming never silently falls back
to the buffered endpoint.

Use **Settings → AI Providers** to manage Connections, Models, and Routes.
Connections store write-only credentials and endpoints, Models declare provider
options and capabilities, and Routes assign Chat/STT/TTS or Native Multimodal
models. API keys are stored in the local SQLite database, are never returned to
the browser, and are protected by host filesystem permissions.

Alibaba Cloud Chat uses an OpenAI-compatible connection. Alibaba Cloud speech
uses dedicated Model Studio connections and models, not OpenAI-compatible Audio
endpoints. STT and TTS remain independently configurable.

Use the language selector on setup, login, or Settings to switch between English and Simplified Chinese. The preference is stored in the browser and applies immediately.

Use the appearance selector in Settings to choose Light, Dark, or System. System is the default and follows live operating-system theme changes.

For frontend and backend development with automatic reload:

```bash
pnpm dev
```

The Web Console is available at <http://127.0.0.1:5173> and proxies API requests to the server on port `3000`.

Web Console pages use stable URLs such as `/dashboard`, `/chat`, `/conversations`, `/conversations/<id>`, `/logs`, and `/settings`. Direct loading, refresh, and browser back or forward navigation are supported.

## Configuration

Copy `.env.example` values into your environment or process manager:

| Variable                      | Default                 | Description                          |
| ----------------------------- | ----------------------- | ------------------------------------ |
| `VOXMESH_HOST`                | `127.0.0.1`             | Server listen address                |
| `VOXMESH_PORT`                | `3000`                  | Server listen port                   |
| `VOXMESH_DATABASE_PATH`       | `./data/voxmesh.sqlite` | SQLite database path                 |
| `VOXMESH_SESSION_TTL_SECONDS` | `86400`                 | Administrator session lifetime       |
| `VOXMESH_COOKIE_SECURE`       | `false`                 | Require HTTPS for the session cookie |

The first administrator password must contain at least 10 characters. Passwords are stored as salted scrypt hashes. Session cookies are `HttpOnly` and `SameSite=Strict`.

Changing the administrator password revokes every active session. Runtime
Routing changes apply after a route is successfully tested and activated.
Route testing sends small requests to every assigned provider and may incur
provider usage costs.

## Validation

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
pnpm test:e2e
```

Run every required check with:

```bash
pnpm validate
```

### Playwright MCP

The repository-level [`.mcp.json`](./.mcp.json) configures Playwright MCP for
browser investigation through structured accessibility snapshots. Copilot CLI
and Claude Code discover this file from the repository root after workspace
trust is approved.

The server uses the latest official package release and isolated browser
sessions so cookies and login state are not retained between MCP sessions.
Restart the MCP client after changing the configuration.

Default tests and Mock Mode require no AI credentials, external MCP servers, or audio hardware.

## Workspace

```text
apps/server           Fastify API, authentication, and composition root
apps/web              React and Vite Web Console
apps/web/src/features Feature-oriented pages, forms, and settings components
apps/web/src/components Shared layout components
apps/web/src/router.tsx Typed TanStack Router route tree and guards
apps/web/src/query.ts Typed TanStack Query keys and query options
packages/agent-core   Provider-independent agent runtime and mocks
packages/shared       Runtime schemas and shared contracts
packages/storage      SQLite storage adapter
tests/e2e             Browser end-to-end tests
```

## Documentation

- [Documentation Index](docs/README.md)
- [MVP Development Specification](docs/MVP.md)
- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md)
- [Mandatory Development Rules](docs/DEVELOPMENT_RULES.md)
- [Technology Stack and Development Guide](docs/architecture/TECHNOLOGY_STACK.md)
- [Voice Pipeline Architecture](docs/architecture/VOICE_PIPELINES.md)
- [Runtime Routing](docs/architecture/RUNTIME_ROUTING.md)
- [WebSocket Event Delivery](docs/architecture/WEBSOCKET.md)
- [Accessibility Standard and Audit](docs/development/ACCESSIBILITY.md)
- [Mock Mode Development Guide](docs/development/MOCK_MODE.md)
- [Azure OpenAI Configuration Guide](docs/providers/AZURE_OPENAI.md)
- [Alibaba Cloud Model Studio Guide](docs/providers/ALIBABA_CLOUD_MODEL_STUDIO.md)
- [Security Operations](docs/operations/SECURITY_OPERATIONS.md)

## Coding Agent Instructions

- [Shared and Codex Instructions](AGENTS.md)
- [Claude Code Instructions](CLAUDE.md)
- [GitHub Copilot Instructions](.github/copilot-instructions.md)

## Development Policy

Before implementing a functional change:

1. Discuss and confirm its behavior, scope, risks, acceptance criteria, and testing requirements.
2. Create a dedicated branch from the latest `main`; never edit or push directly to `main`.
3. Keep all repository content and code comments in English.
4. Add complete unit, integration where applicable, and end-to-end tests.
5. Add English developer documentation and useful JSDoc or reasoning comments for public contracts, configuration, architecture, security constraints, and non-obvious behavior.
6. Run all applicable format, lint, type-check, test, and production-build checks.
7. Use Conventional Commit-style commit messages and PR titles, and split unrelated changes into focused commits.
8. Obtain separate explicit approval before committing, pushing, creating a pull request, merging, or releasing.

See [Development Rules](docs/DEVELOPMENT_RULES.md) for the complete mandatory policy.
