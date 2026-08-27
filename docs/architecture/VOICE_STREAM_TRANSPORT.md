# Authenticated Voice-Stream Transport

[Documentation Index](../README.md)

`/api/voice-stream` is the separate authenticated WebSocket transport for
full-chain Composed voice sessions. It maps the versioned voice protocol to
the provider-independent Streaming Voice Coordinator.

The browser capture, protocol-client, playback, and user-experience boundary is
documented in [Browser Streaming Voice](./BROWSER_STREAMING_VOICE.md).

## Security Boundary

The transport shares the administrator session-cookie and same-origin
validation used by `/api/events`.

An upgrade is accepted only when:

- the path is exactly `/api/voice-stream`
- `Origin` is HTTP(S) and its authority exactly matches `Host`
- the opaque administrator session cookie is valid and unexpired
- global and per-administrator connection limits have capacity

Invalid upgrades are rejected before WebSocket acceptance. Established
connections are closed when their session is revoked. Credentials and
provider configuration are never sent over the transport.

The transport and `/api/events` use independent WebSocket servers and client
state. Client voice controls cannot affect observability replay or event
delivery.

## Handshake and Input

The first client control must be `voice.start` with protocol version 1,
sequence 0, a UUID session/run identity, session-local tool mode, and the fixed
16 kHz mono PCM16LE input format.

After atomic route/provider preparation succeeds, the server returns
`voice.ready` with the route's independent STT/Chat/TTS transport profile.
Preparation failure returns `voice.rejected` and no Coordinator run starts.

Binary input uses the 16-byte connection-scoped frame header. The transport
validates:

- protocol version, direction, encoding, sample rate, channels, and samples
- strictly increasing control and audio sequences
- frame and control-message sizes
- controls and frames against the client protocol state machine
- input frame and control rates
- bounded input queue bytes and duration

`voice.input_finished` closes the input queue and drains accepted frames.
`voice.cancel` aborts the Coordinator and returns `voice.cancelled`.

## Coordinator Event Mapping

The transport maps transient Coordinator events to:

- partial and final transcript controls
- LLM text/tool deltas and completion metadata
- tool start and finish controls
- output segment start and finish controls
- ordered binary PCM output frames
- aggregate output totals
- final conversation/run completion

Every outgoing control and frame is validated through
`VoiceStreamServerProtocolState` before it is sent. This keeps PR 7 transport
ordering identical to the shared protocol contract.

## Limits and Backpressure

Defaults come from `VOICE_STREAM_LIMITS`:

- 1 active voice session per administrator
- 4 active voice sessions globally
- 16 KiB control messages and 64 KiB binary messages
- 75 input frames and 20 controls per second
- 128 KiB / 2 seconds of queued input
- 512 KiB maximum WebSocket buffered output
- 10-second setup and idle deadlines
- 60-second capture and 120-second total-session limits

Input queue pressure produces `voice.pressure` controls with current queued
bytes and duration. A client whose WebSocket output buffer exceeds its limit is
closed with retryable code 1013 and its run is cancelled.

## Cancellation and Cleanup

Client cancel, disconnect, authentication revocation, rate/sequence failure,
backpressure, session timeout, and server shutdown abort the Coordinator and
fail/close the input queue.

Server shutdown:

1. removes the upgrade listener
2. aborts and terminates every voice client
3. awaits Coordinator tasks
4. closes the voice WebSocket server

Voice sessions are explicitly non-resumable. A disconnect is terminal and a
new connection must start a new run ID.

## Testing

Raw `ws` integration coverage verifies:

- all eight Mock buffered/streaming role combinations
- both shared protocol state machines against actual traffic
- authentication and same-origin rejection
- invalid start/order/session/version/frame sequence
- frame-rate and concurrent-session limits
- `/api/events` isolation
- explicit cancel, disconnect, session revocation, setup timeout, and shutdown
- durable final runs/messages and terminal cancellation
