# Streaming Text-to-Speech Segmentation

[Documentation Index](../README.md) |
[Streaming Agent Core](./STREAMING_AGENT.md) |
[Voice Stream Protocol](./VOICE_STREAM_PROTOCOL.md) |
[Phase 5 Plan](../development/PHASE_5_STREAMING_VOICE.md)

## 1. Implemented Scope

This document defines the Phase 5 PR 4 incremental text segmenter:

- consumes Streaming Agent events
- accepts only text explicitly marked speakable
- handles tool-disabled early text and tool-enabled final safe text
- segments at English and Chinese punctuation
- enforces minimum, maximum, and wait thresholds
- preserves exact final assistant text
- emits ordered segment indices and reasons
- supports cancellation and deterministic clocks

No TTS provider is called by the segmenter. The voice coordinator and browser
playback are implemented in later PRs.

## 2. Speakable Input

The segmenter consumes `StreamingAgentEvent`.

- `text_delta` is accepted only when `speakable` is `true`
- provisional tool-enabled text is ignored
- `completion_finished.speakableText` is accepted when non-null
- tool lifecycle, usage, and non-speakable completion events are ignored

This preserves the Phase 5 rule:

- tool-disabled direct turns may release speech before LLM completion
- tool-enabled turns release only the final safe no-tool text
- pre-tool text and tool arguments are never spoken

## 3. Boundaries

Default limits come from `VOICE_STREAM_LIMITS`:

- minimum preferred segment: 24 Unicode code points
- maximum segment: 240 Unicode code points
- maximum wait: 400 ms
- maximum total assistant text: 32,000 Unicode code points

The implementation counts Unicode code points rather than UTF-16 code units,
so emoji and supplementary characters are never split. A trailing high
surrogate is retained across provider deltas until its low surrogate arrives;
an incomplete or invalid pair fails explicitly.

Strong punctuation includes:

```text
. ! ? ; : newline
。 ！ ？ ； ： ， 、
```

When the minimum is reached, the last strong punctuation within the maximum
window is used. If no punctuation is available at the maximum length, the
segmenter prefers a whitespace boundary and otherwise cuts at exactly the
maximum Unicode code-point boundary.

## 4. Maximum Wait

When stable text remains pending without a usable boundary, one timer starts.
Additional deltas do not extend the oldest pending text's deadline. The timer
tracks the exact pending UTF-16 range it covers. If punctuation or a maximum
boundary consumes all timed text but leaves newer suffix text, that suffix
receives a new complete wait window.

At timeout, all currently pending stable text is emitted with reason
`timeout`. Punctuation or maximum-length emission may flush earlier.

The scheduler is injectable so tests do not depend on wall-clock timing.

## 5. Exact Final Text

`finish(finalAssistantText)` verifies:

```text
all accepted speakable input === finalAssistantText
```

Mismatch fails with `FINAL_TEXT_MISMATCH`; it is never silently repaired,
trimmed, normalized, or truncated.

Any remaining pending text is emitted with reason `final`, then the segment
stream closes gracefully.

The emitted segment texts concatenate to the exact final assistant text.

## 6. Segment Events

Each segment contains:

- monotonic zero-based `index`
- exact `text`
- `reason`:
  - `punctuation`
  - `max_length`
  - `timeout`
  - `final`

The segment queue is bounded by the shared assistant-text limit and uses the
Phase 5 bounded async queue.

## 7. Cancellation and Failure

Cancellation:

- clears the timer
- discards pending unsynthesized text
- detaches the AbortSignal listener
- fails consumers with stable `CANCELLED`

Invalid options, total text overflow, final-text mismatch, or internal queue
failure are explicit. Operations after finish, cancel, or failure receive
`CLOSED`.

## 8. Validation

Automated tests cover:

- English and Chinese punctuation
- exact concatenation
- emoji/surrogate safety
- surrogate pairs split across provider deltas
- maximum-length fallback
- maximum-wait timeout
- deadline restart for a newly remaining suffix
- provisional tool text exclusion
- final tool-enabled speakable text
- concurrent accept serialization
- final-text mismatch
- cancellation and post-cancel operations
- option and total text limits
