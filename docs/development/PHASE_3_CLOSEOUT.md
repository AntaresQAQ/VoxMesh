# Phase 3 Closeout Plan

[Documentation Index](../README.md) |
[Implementation Plan](../IMPLEMENTATION_PLAN.md) |
[MVP Specification](../MVP.md) |
[Development Rules](../DEVELOPMENT_RULES.md)

## 1. Purpose

This document is the executable plan for the remaining Phase 3 work after
merged PR #12. It does not authorize implementation by itself. Each functional
pull request still requires explicit user confirmation and all mandatory
quality gates.

Phase 3 closes the core Web Console before live-provider qualification,
streaming, physical audio, Wake Word, or the optional tool-management
experience.

## 2. Current Baseline

Implemented on `main`:

- authenticated Dashboard, Chat, Conversations, Logs, and Settings
- Runtime Routing as the only provider configuration source
- buffered Mock and real-provider Chat/STT/TTS adapters
- Mock Native Multimodal voice
- authenticated replayable real-time observability
- Conversation Run cancellation, inspection, continuity, and retry
- platform-independent device and physical-audio status with explicit
  unavailable defaults
- representative unit, integration, Playwright, and axe coverage
- the minimal in-process Mock MCP tool loop required by Agent Core

Not yet complete in Phase 3:

- the remaining deterministic browser failure and recovery matrix
- full locale/theme/keyboard/focus/responsive/zoom automated evidence
- updated manual accessibility evidence and release-only checklist

## 3. MCP Boundary

Phase 3 does not include an MCP Console, MCP configuration, tool-management UI,
or manual MCP execution.

The existing Mock MCP server remains an internal deterministic Agent Core
dependency. It proves the tool-call loop but is not a user-managed
integration.

Phase 8 owns:

- MCP inspection and manual execution
- the `/mcp` route
- server and tool configuration
- Streamable HTTP and stdio transports
- credentials and sensitive headers/environment variables
- lifecycle, reconnect, permissions, approvals, and schema invalidation
- security warnings and audit events

No MCP management API or UI should be added before Phase 8 unless the roadmap
is explicitly reconfirmed.

## 4. Planned Pull Requests

### PR A - Deterministic Failure and Recovery Fixtures

Suggested branch: `test/phase3-failure-fixtures`

Scope:

- consolidate configurable Mock failure scenarios for:
  - Dashboard summary and device-status requests
  - Chat provider and MCP-in-Agent failures
  - cancellation, retry, and late completion
  - browser microphone denial and unsupported playback
  - Conversation failed/cancelled inspection
  - WebSocket disconnect, restart, replay gap, and snapshot recovery
  - Logs redaction and filtering
- keep fixtures deterministic, bounded, and unavailable in production mode
- document fixture activation and expected safe errors

Acceptance criteria:

- fixtures never require external providers or hardware
- failures remain explicit and never return success-shaped fallbacks
- production configuration cannot enable test-only controls
- focused unit and integration tests cover fixture lifecycle and cleanup

### PR B - Phase 3 Browser and Accessibility Matrix

Suggested branch: `test/phase3-console-closeout`

Dependencies:

- PR A merged

Scope:

- complete Playwright coverage for:
  - Dashboard independent failures and five-state device rendering
  - Chat failure recovery, cancellation, retry, refresh, and late responses
  - Conversation completed, failed, cancelled, and retry inspection
  - WebSocket reconnect, restart, replay gap, and durable snapshot recovery
  - Logs URL filters and redaction
  - Settings validation, secret behavior, conflicts, and routing errors
  - English and Simplified Chinese
  - Light, Dark, and System themes
  - keyboard and route focus behavior
  - narrow viewport and 200% zoom
  - representative axe scans
- update
  [Accessibility Standard and Audit](./ACCESSIBILITY.md) with completed
  automated evidence and remaining release-only manual checks
- update
  [Mock Mode Development Guide](./MOCK_MODE.md) with supported deterministic
  fixtures

Acceptance criteria:

- `pnpm validate` passes on supported CI platforms
- every Phase 3 browser-visible feature has a success path and a critical
  failure or recovery path
- no accessibility suppression is added
- unresolved manual checks are explicitly assigned to Final MVP Acceptance
- MCP management and manual execution do not leak into Phase 3

## 5. Required Evidence

Unit:

- every new or changed fixture and Web component
- locale/theme/focus helpers
- deterministic error and recovery transitions

Integration:

- authentication and session expiry
- durable failure states and snapshot recovery
- WebSocket restart/gap handling
- redaction and safe errors
- cleanup after cancellation and disconnect

End-to-end:

- direct route loading, refresh, back/forward, and protected redirects
- success plus critical failure/recovery for each Phase 3 surface
- English/Chinese and Light/Dark/System
- keyboard-only operation and visible focus
- narrow viewport and 200% zoom
- representative axe scans

Manual release checklist:

- VoiceOver and NVDA/Narrator
- forced colors/high contrast
- complete 200% zoom review
- real browser microphone permission behavior
- real device-status presentation

## 6. Phase 3 Exit Gate

Before declaring Phase 3 complete:

1. PRs A and B are reviewed and merged with required CI.
2. `IMPLEMENTATION_PLAN.md` marks all Phase 3 acceptance items complete.
3. Automated accessibility evidence is current.
4. Remaining manual release checks are explicit.
5. No Phase 8 MCP management scope has leaked into Phase 3.
6. The user explicitly confirms moving to the Phase 4 live-provider acceptance
   gate.
