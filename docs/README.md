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

## Architecture

- [Technology Stack and Development Guide](./architecture/TECHNOLOGY_STACK.md)
- [Voice Pipeline Architecture](./architecture/VOICE_PIPELINES.md)
- [Runtime Routing](./architecture/RUNTIME_ROUTING.md)
- [WebSocket Event Delivery](./architecture/WEBSOCKET.md)
- [Conversation Run Lifecycle](./architecture/CONVERSATION_LIFECYCLE.md)

Architecture documents describe current boundaries and planned extensions.
Sections explicitly marked as planned are not claims of implemented behavior.

## Development

- [Accessibility Standard and Audit](./development/ACCESSIBILITY.md)
- [Mock Mode Development Guide](./development/MOCK_MODE.md)

Development guides explain local workflows, deterministic testing, and quality
evidence. Mandatory policy remains in
[Development Rules](./DEVELOPMENT_RULES.md).

## Providers

- [Azure OpenAI](./providers/AZURE_OPENAI.md)
- [Alibaba Cloud Model Studio](./providers/ALIBABA_CLOUD_MODEL_STUDIO.md)

Provider guides cover configuration, adapter boundaries, security, failure
behavior, and validation. Runtime provider selection is managed through
Runtime Routing.

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
- Keep secrets, credentials, personal data, and machine-specific configuration
  out of documentation and examples.
- Add new documents to this index and link them from the nearest relevant
  architecture or operations guide.
