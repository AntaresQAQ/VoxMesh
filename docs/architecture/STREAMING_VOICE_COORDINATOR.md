# Streaming Voice Coordinator

[Documentation Index](../README.md)

The Streaming Voice Coordinator owns one provider-independent Composed voice
run after routing controls are selected and before any WebSocket transport is
introduced.

## Scope

The coordinator:

- captures the active Composed route or an explicit Composed route before
  provider work
- creates a durable `voice-composed` Conversation Run
- persists a safe immutable route snapshot linked to the run
- orchestrates independent buffered or streaming STT, Chat, and TTS roles
- emits transient partial transcript, Agent, and audio events through one
  bounded async iterator
- persists only the final transcript and final assistant response
- records safe stage lifecycle, counts, latency, and queue-pressure events
- reuses the existing terminal compare-and-set and restart reconciliation
- normalizes cancellation and stage failures without storing provider payloads

The coordinator does not register `/api/voice-stream`, authenticate WebSocket
clients, parse protocol controls, select browser audio devices, or enable
non-Mock provider streaming. Those responsibilities belong to later Phase 5
work packages.

## Route Snapshot

`RuntimeRoutingStore.captureVoiceRouteSnapshot` resolves the active Composed
route, the explicit Composed fallback of an active Native route, or a requested
Composed route.

The persisted snapshot contains:

- route ID, safe display name, and Composed mode
- STT, Chat, and TTS model deployment IDs
- safe model and provider display labels
- provider IDs
- independent streaming switches
- each assigned model configuration fingerprint
- one aggregate configuration fingerprint covering the route and assignments

The fingerprints are hashes. Endpoints, provider options, credentials, and raw
configuration values are never persisted in the snapshot.

The snapshot is stored before provider execution. Later route, connection, or
model edits cannot change the run's recorded configuration.

## Run Lifecycle

The coordinator creates a pending conversation and a `voice-composed` run
before starting STT. The initial run has no input message because final user
text does not exist yet.

On success, one terminal transaction:

1. compares the run status against `in_progress`
2. changes it to `completed`
3. inserts the final user transcript
4. inserts the final assistant response
5. links both messages to the run
6. records the final user message as the run input
7. updates the conversation title

The Coordinator persists the TTS completion event immediately before the
terminal transaction.

Partials, LLM deltas, tool-call fragments, speech segments, and raw audio are
never inserted into `messages`.

Cancellation and failure use the same terminal compare-and-set. A late
provider completion after cancellation cannot add messages or replace the
terminal state. An interrupted process is reconciled through the existing
`SERVER_RESTARTED` run transition, while the route snapshot remains available.

## Role Orchestration

All eight STT/Chat/TTS transport combinations are supported.

### STT

- Streaming STT receives ordered PCM16LE chunks and emits partial and final
  transcript events.
- Both STT paths require 16 kHz mono PCM, at least one frame, ordered
  sample-aligned chunks, bounded total bytes and duration, and one non-empty
  bounded final transcript.
- Buffered STT validates and bounds the same chunks, accumulates PCM, encodes
  one PCM16 WAV input, and calls the buffered provider once. Buffered provider
  contracts receive the same abort signal as streaming sessions.

### Chat

- Streaming Chat uses `StreamingAgentRuntime` and emits typed Agent events.
- Buffered Chat uses `AgentRuntime`.
- Tool mode is session-local. Disabled tool mode exposes no MCP tools.

### TTS

- Streaming TTS consumes stable segments sequentially and globally resequences
  audio chunks across segments.
- Segment start/finish events retain the segment index, stable text, PCM
  format, and frame duration required by the voice-stream protocol.
- When Chat and TTS are both streaming, `StreamingTtsSegmenter` connects the
  Agent event stream to synthesis. Tool-enabled turns release only final
  post-tool text; tool-disabled turns may release safe stable text earlier.
- Buffered TTS synthesizes once, accepts only PCM16 WAV output, applies byte
  and duration limits, pads only the final transport frame with silence, and
  emits fixed-duration sample-aligned PCM chunks. The coordinator selects a
  protocol-representable frame duration for the provider sample rate.

Enabled streaming roles never call their buffered provider method.

## Event Stream

`StreamingVoiceCoordinator.run` returns an async generator containing:

- STT/Agent/TTS stage start and completion
- partial and final transcripts
- typed Streaming Agent events
- ordered PCM audio chunks
- final audio byte and duration totals

The output queue uses the shared bounded queue. Producer backpressure is
propagated rather than dropping events and uses the protocol's output-queue
byte and duration limits. High-pressure and recovered-pressure transitions are
persisted as safe conversation-scoped observability logs.

Provider starts, writes, iterator reads, finishes, buffered calls, and Agent
execution are bounded by the provider-stage timeout. Input frame reads use the
input-idle timeout. Provider failure or cancellation races pending input reads,
returns the input iterator, aborts provider work, and closes sessions with
bounded cleanup.

Streaming STT and TTS enforce ordered provider events, exactly one terminal
event, stable formats, exact totals, and no events after terminal state.

PR 7 maps these in-process events to the authenticated voice WebSocket
protocol. The coordinator intentionally has no transport dependency.

## Provider Composition

`captureRuntimeStreamingVoiceConfiguration` uses one SQLite immediate
transaction to capture the route snapshot plus buffered LLM and speech
configuration. `prepareStreamingVoiceRun` creates provider instances from that
single result, so provider configuration cannot drift away from the persisted
snapshot between separate reads.

The preparation factory registers deterministic Mock streaming providers.

Non-Mock streaming placeholders fail explicitly with a role-specific
unavailable-adapter error. Compatible Chat and Alibaba speech adapters are
added by later work packages without changing the coordinator contract.

## Failure Behavior

The persisted failure code identifies the failed stage:

- `STT_FAILED`
- `AGENT_FAILED`
- `TTS_FAILED`
- `RUN_CANCELLED`
- `SERVER_RESTARTED`

Persisted failure messages are generic and safe. The original in-process error
is retained only as an in-process `cause`; the public coordinator error remains
stage-normalized. Provider endpoints,
credentials, response bodies, and raw exception text are not stored.

## Verification

Coverage includes:

- all eight buffered/streaming role combinations
- assertions that streaming roles never call buffered methods
- ordered output audio sequence numbers
- streaming partial transcript behavior
- final-only message persistence
- route snapshot immutability during a run
- cancellation versus late completion
- safe provider failure persistence
- TTS failure classification
- restart reconciliation with snapshot retention
- one complete on-disk Mock full-chain integration session
