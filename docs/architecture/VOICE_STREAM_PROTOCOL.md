# Voice Stream Protocol and Provider Contracts

[Documentation Index](../README.md) |
[Phase 5 Plan](../development/PHASE_5_STREAMING_VOICE.md) |
[Voice Pipelines](./VOICE_PIPELINES.md) |
[Development Rules](../DEVELOPMENT_RULES.md)

## 1. Implemented Scope

This document defines the implemented Phase 5 PR 1 contract foundation:

- version 1 JSON control-message schemas
- a version 1 fixed binary PCM envelope
- browser-safe JSON and binary parsers
- client/server sequence and basic state validators
- project-owned Streaming STT, Streaming LLM, and Streaming TTS interfaces
- stable limits and safe protocol errors

No `/api/voice-stream` endpoint, provider socket, bounded queue, route
activation, or browser streaming UI is implemented by this contract PR.

## 2. Connection and Session Identity

One WebSocket connection carries one voice session.

The client starts the session with:

- client-generated `sessionId`
- client-generated Conversation Run `runId`
- `toolMode`: `enabled` or `disabled`
- fixed initial input format: mono 16 kHz PCM16LE, 20 ms frames

The server echoes the identifiers in `voice.ready`. JSON control messages carry
the session ID. Binary messages omit the UUID because the WebSocket connection
already scopes the session.

The server-side protocol validator is initialized from the accepted
`voice.start` message. `voice.ready`, output, and terminal messages must match
the accepted session ID, run ID, tool mode, and input format.

Both directions use independent control and binary sequences. Sequence zero is
reserved for `voice.start` and `voice.ready`; subsequent control and binary
sequences start at one.

## 3. Client Control Messages

| Type                   | Purpose                                                  |
| ---------------------- | -------------------------------------------------------- |
| `voice.start`          | Establish IDs, input format, and session-local tool mode |
| `voice.input_finished` | Declare that no more input frames will be sent           |
| `voice.cancel`         | Cancel for user, navigation, or shutdown                 |

The client may send binary input only after start and before input-finished,
cancel, or another terminal outcome.

## 4. Server Control Messages

| Type                            | Purpose                                            |
| ------------------------------- | -------------------------------------------------- |
| `voice.ready`                   | Accept the session and report transport profile    |
| `voice.rejected`                | Reject a structurally valid start before readiness |
| `voice.partial_transcript`      | Observational STT text                             |
| `voice.final_transcript`        | The one transcript that may enter Agent Core       |
| `voice.llm_text_delta`          | Incremental assistant text                         |
| `voice.llm_tool_delta`          | Safe tool assembly progress without raw arguments  |
| `voice.tool_started`            | Safe tool identity and lifecycle                   |
| `voice.tool_finished`           | Safe success/failure lifecycle                     |
| `voice.llm_finished`            | One LLM completion result and optional safe usage  |
| `voice.pressure`                | Input/output queue pressure                        |
| `voice.output_segment_started`  | Text segment and PCM output format                 |
| `voice.output_segment_finished` | Segment synthesis/playback boundary                |
| `voice.output_finished`         | Aggregate output metadata                          |
| `voice.completed`               | Successful terminal session                        |
| `voice.cancelled`               | Cancelled terminal session                         |
| `voice.failed`                  | Failed terminal session with safe code and message |

`voice.llm_tool_delta` reports only the tool index, safe name when known,
argument byte count, and completion state. Raw fragmented arguments remain
inside Agent Core and are not sent to the browser.

`voice.rejected` is a sequence-zero terminal response for setup failures after
a structurally valid start, such as session limits or runtime unavailability.
An invalid JSON envelope, unsupported protocol version, or start message with
no valid session identity cannot receive a control response and is closed as a
protocol error by the future transport.

## 5. Tool-Safe Speech Ordering

The start message requires a session-local tool mode.

- `disabled`: Agent Core receives no tools. Stable output segments may begin
  before the LLM completion.
- `enabled`: tools are exposed. Output segments cannot start until an
  `llm_finished` message proves a final `stop` completion with no tool call.

The server protocol validator enforces this irreversible-audio boundary.
Detailed fragmented tool-call and multi-completion semantics remain owned by
the Streaming Agent Runtime PR.

## 6. Binary PCM Envelope

The fixed header is 16 bytes:

| Offset | Size | Field                                               |
| ------ | ---- | --------------------------------------------------- |
| 0      | 1    | protocol version (`1`)                              |
| 1      | 1    | direction (`0` input, `1` output)                   |
| 2      | 1    | encoding (`1` PCM16LE)                              |
| 3      | 1    | channels                                            |
| 4      | 4    | unsigned sequence, big-endian                       |
| 8      | 4    | sample rate, big-endian                             |
| 12     | 4    | frame samples per channel, big-endian               |
| 16     | N    | interleaved little-endian signed 16-bit PCM payload |

The payload length must equal:

```text
frameSamples * channels * 2
```

The generic codec accepts PCM sample rates from 8 kHz through 96 kHz and one
or two channels. The version 1 browser input contract is intentionally stricter:
mono 16 kHz PCM16LE in 20 ms frames.

Client input frames must match the input format accepted at start. Server output
frames must match the format declared by their active output segment. Output
segment indices are contiguous, and `voice.output_finished` totals must match
the actual streamed segment count, PCM bytes, and calculated duration.

## 7. Stable Limits

The authoritative constants are exported as `VOICE_STREAM_LIMITS` from
`@voxmesh/shared/voice-stream`.

Important initial limits include:

- 16 KiB control messages
- 64 KiB binary messages
- 75 input frames per rolling second
- 20 client controls per rolling second
- 60 second capture
- 120 second total session
- 8,000 character final transcript
- 32,000 character final assistant response
- 32 KiB fragmented tool arguments per call
- three tool calls

Queue, buffer, and timeout limits are defined in the same contract module so
later server, browser, and provider work cannot silently diverge.

## 8. Failure Codes

The allow-listed codes are:

- `UNSUPPORTED_VERSION`
- `INVALID_MESSAGE`
- `INVALID_STATE`
- `INVALID_SEQUENCE`
- `UNSUPPORTED_FORMAT`
- `FRAME_TOO_LARGE`
- `RATE_LIMITED`
- `SESSION_LIMIT`
- `INPUT_LIMIT`
- `OUTPUT_LIMIT`
- `BACKPRESSURE`
- `TIMEOUT`
- `RUN_CANCELLED`
- `PROVIDER_FAILED`
- `INTERNAL_ERROR`

Protocol messages use bounded safe text. Provider response bodies, credentials,
endpoints, raw tool arguments, stack traces, and raw audio never belong in an
error message.

## 9. Provider Contracts

`@voxmesh/audio` defines:

- `StreamingSpeechToTextProvider`
- `StreamingSpeechToTextSession`
- `StreamingTranscriptionEvent`
- `StreamingTextToSpeechProvider`
- `StreamingTextToSpeechSession`
- `StreamingSynthesisEvent`
- ordered PCM chunk and format contracts

Streaming STT sessions accept ordered audio chunks and emit ordered partial
events plus exactly one final event. Streaming TTS sessions emit ordered audio
chunks plus exactly one completed event. Both expose explicit idempotent
resource closure.

`@voxmesh/agent-core` defines:

- `StreamingLlmProvider`
- typed text, tool-call, usage, and completion events
- provider-neutral finish reasons

Provider adapters own SSE or vendor WebSocket parsing. Agent Core never imports
those protocols.

## 10. Validation

Automated tests cover:

- strict JSON parsing and rejection of unknown properties
- UUID, format, size, and message validation
- input/output binary round trips
- unsupported version, direction, encoding, and malformed payload rejection
- client start/input-finished/cancel ordering
- sequence-zero handshake rejection
- ready and terminal run/session correlation
- binary input/output sequence validation
- negotiated input/output format validation
- transcript ordering
- LLM completion/tool-call ordering
- ordered output segments and exact aggregate totals
- exactly-one terminal behavior
- tool-enabled delayed-speech enforcement
- tool-disabled early-segment allowance

Later PRs add rate-window enforcement, bounded queues, detailed Agent
completion ordering, WebSocket authentication, providers, persistence, and
browser behavior.
