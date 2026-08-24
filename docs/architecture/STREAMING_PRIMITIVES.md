# Bounded Streaming Primitives and Mock Speech

[Documentation Index](../README.md) |
[Voice Stream Protocol](./VOICE_STREAM_PROTOCOL.md) |
[Phase 5 Plan](../development/PHASE_5_STREAMING_VOICE.md) |
[Development Rules](../DEVELOPMENT_RULES.md)

## 1. Implemented Scope

This document defines the Phase 5 PR 2 runtime foundation:

- a browser- and server-compatible bounded async FIFO queue
- separately bounded queued items and waiting producers
- explicit high/low pressure transitions
- AbortSignal and timeout-aware producer/consumer waits
- graceful close/drain and terminal failure
- deterministic Mock Streaming STT
- deterministic Mock Streaming TTS

No Agent streaming, voice WebSocket, Runtime Routing change, provider network
connection, or browser streaming UI is implemented by this work.

## 2. Bounded Async Queue

`@voxmesh/shared/bounded-async-queue` exports `BoundedAsyncQueue<T>`.

Every item has a caller-supplied measurement:

```ts
{
  bytes: number;
  durationMs: number;
}
```

The queue independently limits:

- queued item count
- queued bytes
- queued duration
- pending producer count
- pending producer bytes
- pending producer duration

When queued capacity is unavailable, a producer waits in FIFO order. Pending
producers are also bounded, so backpressure cannot create an unbounded memory
list. Exceeding the pending bound fails explicitly with `QUEUE_FULL`; items are
never silently dropped.

## 3. Pressure

Pressure is `normal` or `high`.

- pressure enters `high` when combined queued and pending load crosses the
  configured high-water mark
- pressure returns to `normal` only after load falls below the low-water mark
- subscribers receive the current state immediately and every transition

The hysteresis prevents rapid state oscillation near one threshold.
Listener failures are isolated and logged; they cannot interrupt queue
mutation, drop items, or strand waiters.

Later voice-session work maps queue pressure to safe protocol events and
transport production control.

## 4. Wait Lifecycle

Blocked enqueue and dequeue operations support:

- `AbortSignal`
- finite timeout
- successful capacity/data availability
- graceful queue close
- terminal queue failure

Cancellation and timeout remove the waiter and its reserved measurement.
Abort listeners and timers are removed after every terminal outcome.
Timeout values are validated before listeners are attached.

`close()`:

- rejects pending producers
- prevents new producers
- lets existing queued items drain
- returns `null` to readers after drain

`fail()`:

- records one terminal failure
- discards queued items
- wakes and rejects every producer and consumer

Both terminal operations are idempotent.

## 5. Stable Queue Errors

`BoundedQueueError` exposes:

- `ITEM_TOO_LARGE`
- `QUEUE_FULL`
- `QUEUE_CLOSED`
- `QUEUE_FAILED`
- `TIMEOUT`
- `CANCELLED`

Later application boundaries map these internal codes to the allow-listed voice
protocol errors. Queue errors contain no provider payload or secret.

## 6. Mock Streaming STT

`MockStreamingSpeechToTextProvider`:

- accepts an explicit PCM format
- validates ordered audio sequence and format
- serializes concurrent writes and finish operations
- emits deterministic ordered partial transcripts
- emits exactly one final transcript
- supports configurable frames-per-partial, delay, write failure, and finish
  failure
- propagates external cancellation
- fails its event stream after invalid input or provider failure
- rejects operations after completion without corrupting the successfully
  completed event stream
- releases listeners and queue waiters on close

Default output:

```text
partial: Check
partial: Check the light
final:   Check the light status
```

## 7. Mock Streaming TTS

`MockStreamingTextToSpeechProvider`:

- accepts one stable text segment
- emits deterministic ordered PCM16LE chunks
- emits exactly one completed event with total bytes and duration
- supports configurable chunk count, chunk duration, delay, and failure point
- rejects any chunk that cannot fit the version 1 binary transport limit
- enforces the shared output byte and duration limits
- propagates external cancellation and explicit close

The generated waveform is deterministic test audio and does not contain
spoken or personal content.

## 8. Validation

Automated tests cover:

- FIFO ordering
- producer backpressure and pending bounds
- pressure hysteresis
- producer and consumer cancellation
- timeout cleanup
- graceful drain
- terminal failure
- async iteration
- invalid limits and measurements
- deterministic STT partial/final ordering
- STT sequence/format/failure/cancellation
- deterministic TTS chunks and aggregate metadata
- TTS failure/cancellation/format/limit validation

Later PRs reuse these primitives for Agent deltas, server input/output queues,
browser playback, and provider adapters.
