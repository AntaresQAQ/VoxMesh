# VoxMesh

VoxMesh is a platform-independent, voice-first AI agent gateway.

The project is designed to connect speech input, speech-to-text, an AI agent, MCP tools, text-to-speech, and voice output while keeping the Agent Core independent of hardware, operating systems, and AI providers.

## Project Status

VoxMesh is currently in the specification and implementation-planning stage. Application code and runtime setup have not started.

The first deployment target is NanoPi R2S with a standard USB Audio Class speakerphone, but the architecture is designed for:

- macOS, Linux, and Windows development
- Linux amd64 and arm64 deployment
- Docker Compose and native systemd deployment
- Mock Mode without hardware or external service credentials

## Documentation

- [MVP Development Specification](docs/MVP.md)
- [Implementation Plan](docs/IMPLEMENTATION_PLAN.md)
- [Mandatory Development Rules](docs/DEVELOPMENT_RULES.md)

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
5. Run all applicable format, lint, type-check, test, and production-build checks.
6. Use Conventional Commit-style commit messages and PR titles, and split unrelated changes into focused commits.
7. Obtain separate explicit approval before committing, pushing, creating a pull request, merging, or releasing.

See [Development Rules](docs/DEVELOPMENT_RULES.md) for the complete mandatory policy.
