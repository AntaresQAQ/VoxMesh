# Documentation

This directory is the authoritative documentation entry point for VoxMesh.

## Required Reading

These documents remain at the root because coding agents and contributors must
discover them before planning or implementation:

1. [MVP Development Specification](./MVP.md)
2. [Implementation Plan](./IMPLEMENTATION_PLAN.md)
3. [Mandatory Development Rules](./DEVELOPMENT_RULES.md)

If these documents conflict, stop and ask the user to confirm the intended
interpretation before changing behavior.

## Document Roles

- `MVP.md` defines product scope, architecture invariants, and final acceptance.
- `IMPLEMENTATION_PLAN.md` records implementation status, phase gates, and
  execution order. It must describe the merged `main` branch, not an
  in-progress feature branch.
- `architecture/` documents implemented architecture and clearly labeled
  future extensions.
- `development/` contains executable engineering, testing, accessibility, and
  active-phase closeout plans.
- `providers/` and `operations/` contain integration-specific and operational
  guidance.

Do not duplicate detailed execution checklists across documents. The
Implementation Plan links to the active detailed plan, and the detailed plan
links back to the governing MVP and development rules.

## Architecture

- [Technology Stack and Development Guide](./architecture/TECHNOLOGY_STACK.md)
- [Voice Pipeline Architecture](./architecture/VOICE_PIPELINES.md)
- [Voice Stream Protocol](./architecture/VOICE_STREAM_PROTOCOL.md)
- [Bounded Streaming Primitives](./architecture/STREAMING_PRIMITIVES.md)
- [Streaming Agent Core](./architecture/STREAMING_AGENT.md)
- [Streaming TTS Segmentation](./architecture/STREAMING_TTS_SEGMENTATION.md)
- [Runtime Routing](./architecture/RUNTIME_ROUTING.md)
- [WebSocket Event Delivery](./architecture/WEBSOCKET.md)
- [Conversation Run Lifecycle](./architecture/CONVERSATION_LIFECYCLE.md)
- [Device and Physical Audio Status](./architecture/DEVICE_STATUS.md)
- [Cross-Platform Audio Device Selection](./architecture/PHYSICAL_AUDIO.md)

Architecture documents describe current boundaries and planned extensions.
Sections explicitly marked as planned are not claims of implemented behavior.

## Development

- [Accessibility Standard and Audit](./development/ACCESSIBILITY.md)
- [Live Provider Testing](./development/LIVE_PROVIDER_TESTING.md)
- [Mock Mode Development Guide](./development/MOCK_MODE.md)
- [Phase 3 Closeout Plan](./development/PHASE_3_CLOSEOUT.md)
- [Phase 4 Closeout Plan](./development/PHASE_4_CLOSEOUT.md)
- [Phase 5 Streaming Voice Plan](./development/PHASE_5_STREAMING_VOICE.md)

Development guides explain local workflows, deterministic testing, and quality
evidence. Mandatory policy remains in
[Development Rules](./DEVELOPMENT_RULES.md).

## Providers

- [Azure OpenAI](./providers/AZURE_OPENAI.md)
- [OpenAI-compatible Providers](./providers/OPENAI_COMPATIBLE.md)
- [Alibaba Cloud Model Studio](./providers/ALIBABA_CLOUD_MODEL_STUDIO.md)

Provider guides cover configuration, adapter boundaries, security, failure
behavior, and validation. Runtime provider selection is managed through
Runtime Routing.

## Qualification Evidence

- [Phase 4 Acceptance Report](./qualification/PHASE_4_ACCEPTANCE.md)
- [Azure OpenAI Chat — 2026-08-22](./qualification/AZURE_OPENAI_CHAT_2026-08-22.md)
- [OpenAI-compatible Chat — 2026-08-23](./qualification/OPENAI_COMPATIBLE_CHAT_2026-08-23.md)
- [Alibaba Model Studio — 2026-08-23](./qualification/ALIBABA_MODEL_STUDIO_2026-08-23.md)

Qualification records contain only sanitized provider family, capability,
date, outcome, and limitations. They never contain credentials, account
identifiers, raw payloads, prompts, transcripts, or audio.

## Operations

- [Security Operations](./operations/SECURITY_OPERATIONS.md)

Future deployment, backup, recovery, MCP, physical-audio, wake-word, and
full-chain voice-streaming runbooks should be added to the relevant section
when those features enter implementation.

## Documentation Conventions

- Repository content is written in English.
- Update affected documentation in the same change as behavior.
- Distinguish implemented, Mock-only, live-validated, planned, and deferred
  behavior explicitly.
- Use merged pull requests as the implementation-status baseline. Do not name a
  temporary working branch as the project-wide current state.
- Keep immediate work packages in one active closeout plan with explicit scope,
  dependencies, acceptance criteria, tests, and out-of-scope items.
- Keep secrets, credentials, personal data, and machine-specific configuration
  out of documentation and examples.
- Add new documents to this index and link them from the nearest relevant
  architecture or operations guide.
