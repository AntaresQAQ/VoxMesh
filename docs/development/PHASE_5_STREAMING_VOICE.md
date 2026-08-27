# Phase 5 Full-Chain Streaming Voice Plan

[Documentation Index](../README.md) |
[Implementation Plan](../IMPLEMENTATION_PLAN.md) |
[Voice Pipeline Architecture](../architecture/VOICE_PIPELINES.md) |
[Runtime Routing](../architecture/RUNTIME_ROUTING.md) |
[WebSocket Event Delivery](../architecture/WEBSOCKET.md) |
[Phase 4 Acceptance](../qualification/PHASE_4_ACCEPTANCE.md) |
[Development Rules](../DEVELOPMENT_RULES.md)

## 1. Purpose and Authorization State

The user accepted the Phase 4 buffered-provider report and authorized Phase 5
planning on 2026-08-24. The user then accepted this 12-PR plan, proposed
protocol limits, provider scope, tool-mode behavior, compatibility requirement,
and exclusions on 2026-08-24.

PR 1 is ready for separate implementation authorization. Acceptance of this
plan does not authorize commits, pushes, pull requests, merges, live tests, or
later implementation PRs.

Phase 5 adds capability-gated application-level Streaming STT, Streaming Chat
LLM, and Streaming TTS. Each role remains independently selectable. A
full-chain route enables all three.

## 2. Accepted Baseline

Phase 5 builds on:

- buffered `/api/voice`
- authenticated administrator sessions and same-origin WebSocket policy
- Runtime Routing with independent STT/Chat/TTS streaming intent and a
  full-chain profile
- provider/model declared and verified capabilities
- provider and route readiness diagnostics
- Conversation Run identity, cancellation, terminal CAS, continuity, and
  observability
- replayable server-to-client `/api/events`
- browser microphone loudness and buffered recording normalization
- bounded Agent Core tool-call loop
- Azure and OpenAI-compatible buffered Chat adapters
- Alibaba dedicated speech WebSocket adapters
- deterministic Mock Mode and offline required CI

The buffered path remains supported and unchanged.

## 3. Phase Boundaries

### Included

- authenticated bidirectional `/api/voice-stream`
- versioned control and binary audio protocol
- AudioWorklet PCM capture
- partial and final STT
- Streaming Chat text and tool-call deltas
- bounded Agent streaming tool loop
- stable text segmentation for Streaming TTS
- ordered audio-chunk playback
- independent STT/Chat/TTS streaming routing controls
- deterministic Mock streaming providers
- Azure/OpenAI-compatible Chat SSE
- Alibaba Fun-ASR and Qwen-Audio-TTS/CosyVoice streaming speech
- cancellation, timeout, disconnect, backpressure, cleanup, redaction, and
  latency metrics
- opt-in bounded live qualification

### Excluded

- VAD
- open-microphone or indefinite capture
- full-duplex conversation
- barge-in or interruption of active TTS playback
- resuming an interrupted provider stream
- automatic retry of a streaming session
- WebRTC
- physical host-audio devices
- Wake Word
- real Native Multimodal streaming
- Azure streaming speech qualification unless separately approved resources
  become available

MVP reconnect always creates a new streaming session.

## 4. Architecture Invariants

1. Agent Core remains independent of WebSocket, browser, Fastify, storage, and
   provider protocols.
2. Provider-specific SSE/WebSocket parsing remains inside provider adapters.
3. The browser and server exchange project-owned protocol messages only.
4. Partial transcripts and LLM deltas are observational; storage receives one
   final user transcript and one final assistant message.
5. Tool calls are assembled and validated completely before MCP execution.
6. Early TTS before LLM completion is permitted only when the Agent request
   exposes zero enabled tools. A tool-enabled turn cannot prove that a later
   delta will not introduce a tool call, so it does not release speech until
   the current completion terminates with no tool call.
7. Text from a turn that resolves to a tool call is never sent to TTS.
8. TTS receives only stable final-turn post-tool text segments. Tool-assisted
   turns may use Streaming TTS after the final post-tool LLM completion, but
   do not claim first-audio-before-final-text.
9. Enabled streaming roles never call their buffered provider method when
   invoked through `/api/voice-stream`.
10. `/api/voice` explicitly selects the buffered transport profile;
    `/api/voice-stream` explicitly selects the route's configured streaming
    switches. This endpoint choice is not fallback.
11. Phase 5 routes must retain verified buffered capabilities for all assigned
    roles so `/api/voice` remains available. Streaming-only models and
    per-session route selection are deferred.
12. Unsupported or unverified routes cannot activate.
13. Raw audio and unbounded text fragments are never persisted or logged.
14. Disconnect and cancellation release every provider, queue, timer, audio
    resource, and active-run registry entry.
15. Every terminal path uses the existing exactly-one terminal transition
    invariant.

## 5. Proposed Initial Protocol and Limits

These values are proposed defaults for review before implementation.

| Area                      | Proposed initial value                                |
| ------------------------- | ----------------------------------------------------- |
| Protocol version          | `1`                                                   |
| Active sessions           | 1 per administrator browser; 4 global                 |
| Tool mode                 | `enabled` or `disabled`; browser default is `enabled` |
| Input format              | mono 16 kHz PCM16LE                                   |
| Input frame duration      | 20 ms                                                 |
| JSON control message      | 16 KiB maximum                                        |
| Binary message            | 64 KiB maximum                                        |
| WebSocket buffered amount | 512 KiB maximum                                       |
| Input queue               | 2 seconds or 128 KiB, whichever is reached first      |
| Output playback queue     | 5 seconds or 2 MiB, whichever is reached first        |
| Buffered STT accumulator  | 60 seconds and 2 MiB maximum                          |
| Buffered TTS result       | 10 MiB and 120 seconds playback maximum               |
| Input binary rate         | 75 frames per rolling second maximum                  |
| Client control rate       | 20 messages per rolling second maximum                |
| Session setup timeout     | 10 seconds                                            |
| Input idle timeout        | 10 seconds                                            |
| Maximum capture           | 60 seconds                                            |
| Maximum total session     | 120 seconds                                           |
| Provider stage timeout    | 45 seconds                                            |
| Final transcript          | 8,000 characters                                      |
| Final assistant text      | 32,000 characters                                     |
| Fragmented tool arguments | 32 KiB per call                                       |
| Tool calls                | existing maximum of 3                                 |
| TTS stable segment        | 24-240 characters; punctuation preferred              |
| Maximum segmentation wait | 400 ms after stable text is available                 |

The binary envelope is connection-scoped. It contains protocol version,
direction, monotonically increasing sequence, format identifier, sample rate,
channels, frame sample count, and payload. The session ID is established by the
JSON start/ready handshake and is not repeated as a string in every binary
frame.

Pressure that cannot be relieved fails explicitly. It never drops, reorders, or
silently truncates semantic content.

The live input queue is not the buffered-STT accumulator. The coordinator
continuously drains incoming frames. A Streaming STT consumer receives them
incrementally; a buffered STT consumer writes them into the separate bounded
capture accumulator and invokes buffered STT only after `input-finished`.
Buffered TTS similarly validates the complete result before dividing it into
bounded playback chunks.

The start message includes a required `toolMode`. `enabled` exposes the
currently available Agent tools and applies the tool-safe delayed-speech rule.
`disabled` exposes an empty tool list and permits early stable-segment TTS. The
browser defaults to `enabled` and presents a clearly labeled **Allow tools for
this session** control. This coarse per-session choice is not MCP server/tool
management and does not persist permissions.

## 6. Pull Request Plan

### PR 1 - Streaming Protocol and Provider Contracts

Suggested title: `feat: define streaming voice contracts`

Suggested branch: `feat/streaming-voice-contracts`

Scope:

- add versioned TypeBox control-message schemas
- define start, ready, input-finished, partial/final transcript, LLM delta,
  tool lifecycle, output segment, cancelled, failed, and terminal messages
- include required `toolMode: enabled | disabled` in the start contract
- implement the binary PCM envelope codec and parser
- add provider-independent Streaming STT, LLM, and TTS contracts
- define safe error codes, sequence rules, and session states
- add bounded constants in one shared contract module
- expose browser-safe parser subpaths
- document protocol ordering and privacy boundaries

Acceptance:

- malformed versions, ordering, sequence, sizes, formats, and duplicate
  terminals fail deterministically
- shared browser imports do not include server-only schemas
- no endpoint, provider socket, or route can be enabled yet
- complete unit/property-style boundary tests pass

Out of scope:

- queues
- Mock providers
- Agent streaming
- WebSocket endpoint

### PR 2 - Bounded Streaming Primitives and Mock Speech

Suggested title: `feat: add bounded streaming primitives`

Suggested branch: `feat/streaming-primitives`

Dependencies:

- PR 1

Scope:

- add bounded async queues with byte/item/duration limits
- add pressure state and deterministic high/low-water transitions
- add cancellation, timeout, terminal, drain, and cleanup semantics
- implement deterministic Mock Streaming STT
- implement deterministic Mock Streaming TTS
- add injectable clocks and delayed/failure fixtures

Acceptance:

- queue overflow fails explicitly without silent dropping
- cancellation wakes blocked producers and consumers
- duplicate close/fail operations are idempotent
- Mock STT emits ordered partials plus exactly one final transcript
- Mock TTS emits ordered PCM chunks plus one terminal metadata result

Out of scope:

- Agent streaming
- network transport
- browser playback

### PR 3 - Streaming Agent Core

Suggested title: `feat: add streaming Agent runtime`

Suggested branch: `feat/streaming-agent-runtime`

Dependencies:

- PR 1
- PR 2

Scope:

- add a provider-independent `StreamingLlmProvider`
- define typed text, tool-call, usage, finish, and failure deltas
- implement deterministic Mock Streaming LLM
- assemble fragmented tool-call IDs, names, and JSON arguments
- validate the complete tool call before MCP execution
- stream the post-tool follow-up completion
- expose an empty tool list when the session tool mode is disabled
- preserve tool-call count and output bounds
- produce one exact final assistant text
- propagate cancellation across LLM and MCP boundaries

Acceptance:

- direct and tool-assisted streams work deterministically
- malformed/incomplete tool arguments never invoke MCP
- pre-tool text is marked non-speakable and excluded from final TTS input
- tool-enabled turns do not release speech until the completion proves that it
  contains no tool call
- one terminal result and one final assistant message are produced
- existing buffered Agent Runtime remains unchanged

### PR 4 - Stable Streaming TTS Segmentation

Suggested title: `feat: segment streaming text for speech`

Suggested branch: `feat/streaming-tts-segmentation`

Dependencies:

- PR 3

Scope:

- add a project-owned incremental text segmenter
- support English and Chinese punctuation
- enforce minimum, maximum, and wait thresholds
- preserve the exact final assistant text independently from spoken segments
- emit only stable final-turn post-tool segments
- expose an eligibility input so early release is impossible for tool-enabled
  turns
- flush the final bounded segment at LLM completion

Acceptance:

- incomplete tool calls and pre-tool text are never spoken
- segment ordering is deterministic
- concatenated segment text matches the speakable final text
- multilingual punctuation and no-punctuation limits are covered
- cancellation discards pending unsynthesized segments

### PR 5 - Runtime Routing Streaming Controls

Suggested title: `feat: add full-chain streaming route controls`

Suggested branch: `feat/streaming-routing-controls`

Dependencies:

- PR 1

Scope:

- add `chatStreamingEnabled` migration, API, storage, and UI
- retain independent STT and TTS switches
- add an explicit full-chain profile action
- define endpoint transport behavior: `/api/voice` is buffered and
  `/api/voice-stream` applies the streaming switches
- require verified non-streaming capabilities for the Phase 5 compatibility
  route as well as streaming capabilities for enabled roles
- distinguish declared, verified, adapter-available, and
  transport-available states
- add per-role activation errors
- protect streaming-affecting active-route dependencies
- reset readiness/verification after relevant changes

Acceptance:

- all eight buffered/streaming role combinations are representable
- a streaming role requires declared and verified capability
- saving is allowed only for declared capabilities
- activation remains rejected until its runtime transport/adapter is registered
- buffered routes remain unchanged

Implementation status:

- implemented as the Phase 5 Runtime Routing controls work package
- `chatStreamingEnabled` is persisted with a safe `false` migration default
- route signatures and readiness invalidation include all three switches
- Runtime Routing exposes explicit server transport, browser client, and
  per-role provider-adapter availability
- Settings provides independent role switches, a full-chain profile, and
  localized readiness explanations
- Dashboard reports Chat transport alongside STT and TTS
- production availability remains unregistered until the dependent transport,
  browser, and provider PRs are complete

### PR 6 - Streaming Voice Run Persistence and Coordinator

Suggested title: `feat: coordinate streaming voice runs`

Suggested branch: `feat/streaming-voice-coordinator`

Dependencies:

- PR 2
- PR 3
- PR 4
- PR 5

Scope:

- create `voice-composed` Conversation Runs before provider work
- snapshot the active route and assigned model fingerprints
- persist a run-linked safe route snapshot containing route ID/mode, assigned
  model deployment IDs, safe provider/model labels, streaming switches, and a
  configuration fingerprint; never persist endpoints, provider options, or
  credentials in the snapshot
- orchestrate independent buffered/streaming STT, Chat, and TTS roles
- persist the final transcript and final assistant message only
- persist safe lifecycle, count, pressure, and latency events
- reuse terminal CAS and restart reconciliation
- normalize cancellation and provider failures
- implement a complete in-process Mock full-chain session without WebSocket

Acceptance:

- every supported role combination completes through the coordinator
- enabled streaming roles never call buffered provider methods
- late completion after cancel cannot add messages
- partials/deltas/raw audio are not persisted
- route changes during a session do not alter its snapshot

Implementation status:

- implemented as the Phase 5 streaming coordinator work package
- `voice-composed` runs and immutable safe route snapshots are persisted before
  provider work
- all eight role combinations execute through one bounded in-process event
  stream
- deterministic Mock buffered and streaming providers complete a full-chain
  on-disk integration session
- final transcript and assistant messages use the existing terminal CAS;
  partials, deltas, segments, and raw audio remain transient
- `/api/voice-stream` remains unregistered until PR 7

### PR 7 - Authenticated Voice-Stream WebSocket

Suggested title: `feat: add authenticated voice streaming transport`

Suggested branch: `feat/voice-stream-websocket`

Dependencies:

- PR 1
- PR 6

Scope:

- add `/api/voice-stream` as a separate WebSocket server
- reuse session-cookie authentication and same-origin checks
- implement start/ready and binary input framing
- enforce sequence, size, rate, session, and state limits
- connect the protocol to the streaming coordinator
- stream partial transcript, LLM/tool, TTS, cancellation, and failure messages
- enforce per-session/global connection limits and backpressure
- cancel on disconnect and server shutdown

Acceptance:

- raw WebSocket integration tests complete every Mock role combination
- invalid origin/session/version/order/frame/sequence is rejected
- client application state cannot affect `/api/events`
- disconnect releases all resources and marks the run terminal
- no reconnect/resume claim is made

Implementation status:

- implemented as the Phase 5 authenticated voice transport work package
- `/api/voice-stream` reuses administrator cookie and same-origin validation
- shared client/server protocol state machines validate every control and frame
- all eight Mock role profiles complete through raw WebSocket integration tests
- input queue, rate, connection, frame, control, setup, session, and output
  backpressure limits fail closed
- cancel, disconnect, revocation, and server shutdown release resources and
  leave terminal runs
- reconnect and resume remain explicitly unsupported

### PR 8 - Browser AudioWorklet and Streaming UX

Suggested title: `feat: add browser streaming voice experience`

Suggested branch: `feat/browser-streaming-voice`

Dependencies:

- PR 7

Scope:

- add AudioWorklet PCM capture and 16 kHz mono resampling
- reuse the same browser stream for loudness
- add a bounded browser input queue
- add bounded ordered Web Audio PCM playback
- render partial transcript and incremental final-turn assistant text
- render tool, cancellation, pressure, unsupported-browser, and failure states
- add explicit Start/Finish/Cancel streaming controls
- add an **Allow tools for this session** control that defaults to enabled
- preserve buffered voice as a separate available mode
- localize all states and meet WCAG 2.2 AA

Acceptance:

- deterministic Mock full-chain streaming works in Playwright
- first audio plays before final LLM completion in a direct zero-tools
  full-chain fixture
- tool-enabled and tool-assisted fixtures do not play audio until the final
  no-tool completion is known
- unsupported APIs disable streaming without buffered fallback
- unmount, navigation, cancellation, disconnect, and playback failure clean up
  tracks, worklets, contexts, queues, timers, and sockets
- English/Chinese, Light/Dark, keyboard, narrow viewport, 200% zoom, and axe
  pass

Implementation status:

- implemented as the Phase 5 browser streaming voice work package
- buffered Voice test and streaming controls remain separate and available
- AudioWorklet capture resamples arbitrary browser input to exact 20 ms,
  16 kHz mono PCM16LE frames
- browser input and Web Audio output use bounded ordered queues and fail closed
- shared protocol state machines enforce tool-gated early-speech behavior
- completion waits for playback and survives immediate post-completion socket
  closure
- Mock Mode Playwright covers the real authenticated transport with
  deterministic AudioWorklet and Web Audio fixtures
- Mock streaming deployment activation remains governed by Runtime Routing
  verification and is not changed by this work package

### PR 9 - Azure/OpenAI-Compatible Streaming Chat

Suggested title: `feat: stream compatible Chat completions`

Suggested branch: `feat/streaming-chat-adapters`

Dependencies:

- PR 1
- PR 3

Scope:

- add Azure OpenAI `stream: true` Chat adapter
- add generic OpenAI-compatible `stream: true` Chat adapter
- use a maintained SSE parser selected and reviewed in this PR
- map text, fragmented tool calls, finish reasons, usage, errors, and
  cancellation
- cover Alibaba compatible Chat through the generic adapter
- keep buffered adapters unchanged

Acceptance:

- sanitized SSE fixtures cover arbitrary chunk boundaries and multi-line data
- fragmented tool calls assemble identically to Mock
- cancellation closes the response body
- credentials/provider payloads are redacted
- adapter registration remains disabled until route verification succeeds

### PR 10 - Alibaba Streaming Speech Adapters

Suggested title: `feat: stream Alibaba speech`

Suggested branch: `feat/alibaba-streaming-speech`

Dependencies:

- PR 1
- PR 2

Scope:

- adapt Fun-ASR to the Streaming STT contract
- adapt Qwen-Audio-TTS/CosyVoice to the Streaming TTS contract
- enforce provider event ordering and one terminal result
- normalize provider audio formats at the adapter boundary
- add cancellation, timeout, socket cleanup, and safe errors
- add streaming capability verification fixtures

Acceptance:

- deterministic WebSocket fixtures cover partial/final STT and ordered TTS
  chunks
- provider errors and malformed ordering fail explicitly
- no provider credential or payload reaches logs/evidence
- buffered Alibaba speech remains unchanged

### PR 11 - Streaming Verification and Route Activation

Suggested title: `feat: verify streaming route capabilities`

Suggested branch: `feat/streaming-route-verification`

Dependencies:

- PR 5
- PR 7
- PR 8
- PR 9
- PR 10

Scope:

- add role-specific Streaming STT, Chat, and TTS verification
- test complete provider session setup rather than infer capability
- update safe readiness and verified capabilities atomically
- register runtime transport/adapter availability
- permit activation only when every enabled streaming role is available,
  declared, verified, and ready
- invalidate verification on relevant configuration or adapter changes

Acceptance:

- each role can verify independently
- stale tests cannot overwrite newer configuration
- failed verification never activates or falls back
- full-chain activation requires all three roles
- safe last-error status remains bounded and localized

### PR 12 - Phase 5 Validation and Acceptance

Suggested title: `test: complete streaming voice acceptance`

Suggested branch: `test/phase5-streaming-acceptance`

Dependencies:

- PRs 1-11

Scope:

- test every independent STT/Chat/TTS combination
- test direct and MCP-assisted Streaming Chat
- test semantic TTS ordering and first-audio-before-final-text for direct
  zero-tools turns
- test that tool-enabled turns never release irreversible speech before their
  final no-tool completion
- test pressure, limits, cancellation, timeout, disconnect, shutdown, and
  reconnect-as-new-session
- test storage, redaction, route snapshots, and no partial-message persistence
- complete Playwright/axe/localization/theme/keyboard/zoom coverage
- add opt-in bounded Alibaba speech and compatible/Azure Chat live suites
- record latency, underrun, queue-depth, CPU, memory, request, and cost evidence
- publish a Phase 5 acceptance report and known-limit issues

Acceptance:

- required offline CI remains deterministic and credential-free
- every enabled role is proven to use streaming transport
- full-chain Mock and qualified live profiles pass
- every failure releases resources and produces no success-shaped result
- the user explicitly accepts the Phase 5 report before Phase 6 begins

## 7. Dependency Graph

```text
PR 1 Contracts
 ├── PR 2 Primitives + Mock Speech
 │    ├── PR 3 Streaming Agent
 │    │    └── PR 4 TTS Segmentation
 │    └── PR 10 Alibaba Speech
 ├── PR 5 Routing Controls
 └── PR 9 Streaming Chat Adapters

PR 2 + PR 3 + PR 4 + PR 5
 └── PR 6 Coordinator
      └── PR 7 Voice WebSocket
           └── PR 8 Browser Streaming UX

PR 5 + PR 7 + PR 8 + PR 9 + PR 10
 └── PR 11 Verification and Activation

PRs 1-11
 └── PR 12 Validation and Acceptance
```

Recommended merge order is numeric. PRs 5, 9, and 10 may be developed in
parallel after their dependencies, but each must be rebased on the latest
merged contracts before review.

## 8. Validation Strategy

### Required offline validation

- format, lint, strict type-check, build
- protocol/parser and queue unit tests
- Mock provider and Agent state-machine tests
- server WebSocket integration with raw clients
- storage and Runtime Routing migration/race tests
- browser AudioWorklet/playback fakes
- Playwright and representative axe
- Windows, macOS, and Linux CI
- CodeQL

### Opt-in live validation

- exactly one provider family per process
- explicit role selectors
- hard request/session/time/cost budgets
- synthetic text and audio only
- no retained raw audio
- fail-fast and no automatic retry
- sanitized evidence only

Initial live target:

- Alibaba Streaming STT
- Azure or OpenAI-compatible Streaming Chat
- Alibaba Streaming TTS

Azure streaming speech is not required for Phase 5 acceptance unless issue #18
is resolved with approved resources and a separately reviewed adapter plan.

## 9. Risk Register

| Risk                                    | Mitigation                                                    |
| --------------------------------------- | ------------------------------------------------------------- |
| Protocol and UI evolve together         | contracts first; browser work after raw WebSocket integration |
| Hidden buffered fallback                | role-specific spies and activation gates                      |
| Unbounded queues or memory              | shared bounded primitives and pressure tests                  |
| Fragmented tool-call corruption         | typed assembler with complete JSON validation                 |
| Speaking unstable/pre-tool text         | early speech only with zero tools; post-tool eligibility gate |
| Browser audio resource leaks            | explicit ownership and unmount/navigation tests               |
| Provider event-order differences        | adapter-local normalization and malformed-order fixtures      |
| Route changes during a session          | immutable route/model fingerprint snapshot                    |
| Partial data pollutes conversation      | one final transcript and assistant persistence                |
| Credentials/audio leak into evidence    | allow-listed metadata, redaction, synthetic audio             |
| Live-test cost or quota overrun         | explicit opt-in, role selector, request and duration budgets  |
| Cross-platform AudioWorklet differences | capability checks and deterministic browser fixtures          |

## 10. Accepted Plan and Remaining Operation Gates

Accepted by the user on 2026-08-24:

1. the 12-PR decomposition
2. the initial protocol and limits in Section 5
3. the initial real-provider target:
   Alibaba speech plus Azure/OpenAI-compatible Chat
4. the exclusion of VAD, barge-in, resume, WebRTC, physical audio, Wake Word,
   and real Native Multimodal streaming
5. the requirement that buffered voice remains supported
6. the requirement that no streaming route activates before role-specific
   runtime availability and verification
7. early TTS before final LLM completion is limited to zero-tools direct turns
8. Phase 5 active routes retain buffered capability for `/api/voice`
9. the per-session Allow tools control defaults to enabled; disabling it is
   required for early TTS and does not change persisted MCP permissions

PR 1 still requires separate implementation authorization. Implementation
authorization does not authorize later PRs, commits, pushes, pull requests,
merges, live tests, or releases. Every behavior-changing PR requires separate
implementation confirmation.
