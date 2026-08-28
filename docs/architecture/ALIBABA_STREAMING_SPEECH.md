# Alibaba Streaming Speech Adapters

[Documentation Index](../README.md) |
[Alibaba Cloud Model Studio](../providers/ALIBABA_CLOUD_MODEL_STUDIO.md) |
[Streaming Voice Protocol](./VOICE_STREAM_PROTOCOL.md) |
[Phase 5 Plan](../development/PHASE_5_STREAMING_VOICE.md)

VoxMesh implements provider adapters for Alibaba Cloud Model Studio Fun-ASR
Streaming STT and Qwen-Audio-TTS/CosyVoice Streaming TTS. Both adapters
implement provider-independent contracts from `@voxmesh/audio`; no Alibaba
type or WebSocket event enters Agent Core.

This work package does not register the adapters in the server composition
root. Runtime use remains unavailable until role-specific capability
verification and route activation are implemented. Existing buffered Alibaba
speech adapters remain available and behaviorally unchanged.

## Shared WebSocket Boundary

Buffered and streaming adapters share one internal Model Studio WebSocket
boundary for:

- the pre-validated `wss://` endpoint
- write-only authorization and the VoxMesh user agent
- task headers and UUID correlation
- strict JSON event parsing
- safe conversion of Node.js WebSocket text and binary data
- abort checks and bounded error normalization

Provider payloads and WebSocket close reasons never enter streaming session
errors. Task failures expose only the provider family, role, and stable failure
category. API keys remain confined to the WebSocket handshake headers.

## Fun-ASR Streaming STT

The provider accepts exactly mono 16 kHz PCM16LE, matching the version 1 voice
transport. Session startup:

1. opens the configured Model Studio socket
2. sends `run-task` for `audio/asr/recognition`
3. includes the configured real-time model and optional language hint
4. completes only after one valid `task-started`

`write()` serializes concurrent calls, validates sequence and format, enforces
the 60-second / 2 MiB input bounds, and sends raw PCM bytes. `finishInput()`
drains accepted writes before sending `finish-task`; writes requested after
finish are rejected.

Non-final `result-generated` sentence text maps to ordered `partial` events.
Sentence-end text is accumulated safely and maps to exactly one `final` event
after `task-finished`. Empty final text, malformed sentence state, duplicate or
out-of-order task events, provider binary data, and transcript overflow fail
the session.

## Qwen-Audio-TTS/CosyVoice Streaming TTS

The provider validates a non-empty text segment within the shared segment
limit. Session startup:

1. sends `run-task` for `audio/tts/SpeechSynthesizer`
2. waits for `task-started`
3. sends the stable text with `continue-task`
4. sends `finish-task`

Output is mono 24 kHz PCM16LE. Every binary provider message is copied into an
owned `Uint8Array`, validated for sample alignment and transport frame size,
and emitted as an ordered `audio` event. Aggregate bytes and duration are
bounded by the shared TTS limits and checked before retention.

After all pending audio events are accepted, `task-finished` emits exactly one
`completed` event with the format, next sequence, total bytes, and duration.
Empty output, malformed PCM, output overflow, metadata events in invalid
states, and duplicate terminal events fail explicitly.

## Backpressure, Ordering, and Cleanup

STT and TTS events use `BoundedAsyncQueue` with separate queued and pending
producer bounds. Provider callbacks copy or parse incoming data before
retention. Queue overflow or wait timeout fails the provider session instead
of dropping or reordering an event.

The shared connection state machine enforces:

- one socket open and one `run-task`
- one `task-started`
- no data before startup
- no writes after finish
- `task-finished` only after `finish-task`
- one terminal completion

Caller abort, provider timeout, socket error, premature close, malformed
message, queue failure, explicit session close, and successful completion all
remove abort listeners, clear timers, and close the WebSocket. `close()` is
idempotent. Cancellation maps to `CANCELLED`; all other event-stream failures
map to `QUEUE_FAILED`.

## Registration and Verification

The package exports:

- `AlibabaModelStudioStreamingSpeechToTextProvider`
- `AlibabaModelStudioStreamingTextToSpeechProvider`

`apps/server/src/streaming-voice-providers.ts` intentionally continues to
return unavailable real-provider streaming adapters. Phase 5 route
verification must open and complete provider setup for the exact model and
configuration fingerprint before registering either adapter. There is no
silent fallback to buffered speech.

## Deterministic Testing

Offline WebSocket fixtures cover:

- Fun-ASR partial and final transcript ordering
- STT format, sequence, duration, and byte validation
- Qwen/CosyVoice ordered PCM frames and exact aggregate metadata
- request task/model/voice/language mapping
- authorization header isolation
- provider task failure without payload leakage
- malformed task ordering and malformed binary audio
- caller cancellation, setup timeout, and socket closure
- existing buffered Alibaba STT/TTS behavior

Live Model Studio streaming qualification remains opt-in and is not part of
default CI or this adapter work package.
