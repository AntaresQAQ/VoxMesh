# Phase 5 Full-Chain Streaming Voice Acceptance Report

[Documentation Index](../README.md) |
[Phase 5 Streaming Voice Plan](../development/PHASE_5_STREAMING_VOICE.md) |
[Implementation Plan](../IMPLEMENTATION_PLAN.md)

## 1. Decision Status

The Phase 5 implementation is ready for acceptance review. Deterministic
offline qualification is complete. Credentialed streaming-provider
qualification has not been run for this closeout and is **Unqualified**, not
passed. The new opt-in suites are available for an explicitly authorized
operator run.

Phase 6 remains blocked until the user explicitly accepts this report. No live
provider outcome or resource measurement may be inferred from offline tests.

## 2. Offline Qualification Matrix

| Area                                      | Evidence                                                                                                                                                                     | Result |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Eight STT/Chat/TTS transport combinations | `StreamingVoiceCoordinator` role matrix and raw `/api/voice-stream` profile matrix                                                                                           | Passed |
| No buffered fallback for enabled roles    | Per-role buffered and streaming call-count assertions in `streaming-voice-coordinator.unit.test.ts`                                                                          | Passed |
| Direct early speech                       | `releases stable streaming speech before a tool-disabled completion ends`; browser client early-playback test                                                                | Passed |
| Tool-safe speech                          | Full role matrix verifies tool-enabled audio is released only after the final no-tool completion                                                                             | Passed |
| Fragmented MCP flow                       | `packages/agent-core/src/streaming-runtime.unit.test.ts` direct, fragmented tool-call, and follow-up cases                                                                   | Passed |
| Semantic segmentation                     | `packages/agent-core/src/streaming-tts-segmenter.unit.test.ts` punctuation, timeout, Unicode, provisional-tool-text, limit, and cancellation cases                           | Passed |
| Persistence                               | Every role-matrix case stores only final user and assistant messages; cancellation and failure cases store no partial messages                                               | Passed |
| Pressure and bounds                       | Coordinator pressure/recovery, queue failure, input/output size, duration, sequence, and metadata tests                                                                      | Passed |
| Authentication and lifecycle              | Transport tests cover authentication, origin, ordering, rate limits, disconnect, explicit cancel, setup timeout, revocation, and shutdown                                    | Passed |
| Reconnect semantics                       | Browser client rejects restart of a non-resumable session; a new connection creates a new session                                                                            | Passed |
| Browser audio                             | AudioWorklet resampling, exact 20 ms frames, capture races, resource cleanup, ordered playback, and queue bounds                                                             | Passed |
| Browser protocol                          | Startup rejection, cancellation, early direct speech, tool-call text reset, and complete resource cleanup                                                                    | Passed |
| Runtime readiness                         | Route tests require exact model-role verification and registered adapter, transport, and browser availability                                                                | Passed |
| Web Console acceptance                    | Playwright covers buffered and full-chain Mock streaming flows, route activation, English/Chinese, Light/Dark, keyboard, narrow viewport, zoom, and representative axe scans | Passed |
| Default live command                      | `pnpm test:live` without exact opt-in performs no provider request                                                                                                           | Passed |

## 3. Live Streaming Qualification

| Provider path                                     | Selector                   | Maximum operations | Status      |
| ------------------------------------------------- | -------------------------- | ------------------ | ----------- |
| Azure OpenAI Streaming Chat                       | `streaming-chat`           | 3                  | Unqualified |
| OpenAI-compatible Streaming Chat                  | `streaming-chat`           | 3                  | Unqualified |
| Alibaba Fun-ASR Streaming STT                     | `streaming-stt`            | 1                  | Unqualified |
| Alibaba Qwen/CosyVoice Streaming TTS              | `streaming-tts`            | 1                  | Unqualified |
| Alibaba speech plus compatible Streaming Chat/MCP | `streaming-composed-voice` | 4                  | Unqualified |

The suites require exact opt-in, one provider family per process, explicit
capability selection, a hard request/session budget, per-operation timeouts,
no retries, synthetic content, ordered contract validation, and allow-listed
evidence. Alibaba streaming STT decodes a local mono 16 kHz PCM16 WAV and sends
incremental PCM frames. Streaming TTS requires ordered mono 24 kHz PCM16LE
chunks and matching terminal byte/duration metadata.

Live evidence must exclude endpoints, account/workspace identifiers,
credentials, model and voice identifiers, prompts, transcripts, tool payloads,
raw provider events, and audio. Existing Phase 4 buffered evidence does not
qualify these streaming paths.

## 4. Performance and Cost Evidence

| Measure               | Offline evidence                                                                   | Live evidence                             |
| --------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------- |
| Request/session count | Exact hard budgets: Chat 3; STT 1; TTS 1; composed 4                               | Pending authorized run                    |
| Input framing         | 20 ms, mono 16 kHz PCM16LE; 75 frames/s limit                                      | Pending authorized run                    |
| Output ordering       | Strictly increasing sequence and matching terminal metadata                        | Pending authorized run                    |
| Queue depth           | Explicit bounded item, byte, and duration limits with overflow tests               | Pending authorized run                    |
| Underrun behavior     | Browser scheduling and failure behavior covered with deterministic Web Audio fakes | Pending real-browser/provider observation |
| Stage latency         | Ordering and timeout invariants covered; no fabricated wall-clock provider latency | Pending authorized run                    |
| CPU and memory        | Bounded-allocation behavior covered; no hardware measurement claimed               | Pending target-host measurement           |
| Network use           | Binary/control message and rate limits verified                                    | Pending authorized run                    |
| Provider cost         | Exact maximum operation count; no price estimate inferred                          | Pending operator billing evidence         |

Portable pass/fail thresholds for provider latency, CPU, memory, network use,
and cost have not been accepted. These values therefore remain measurements,
not release claims. A future live record must identify only a coarse operator
environment category and sanitized measurements.

## 5. Failure and Resource Safety

- Browser capture, playback, AudioContext, tracks, AudioWorklet modules,
  WebSockets, provider response bodies, Alibaba sockets, queues, timers, and
  abort listeners have explicit completion, cancellation, and failure cleanup.
- Streaming provider and transport failures surface terminal failure; they do
  not silently downgrade to buffered execution or return success-shaped data.
- Provider errors are normalized before logs, protocol events, readiness
  records, and live qualification evidence.
- Route configuration is snapshotted for a session. A configuration change
  cannot switch providers or transport modes during an active run.
- A disconnected session is non-resumable. Reconnection starts a new run and
  cannot append partial content from the abandoned session.

## 6. Known Limits

- No voice activity detection.
- No barge-in or full-duplex interruption.
- No session resume.
- No WebRTC transport.
- No physical host audio in the streaming acceptance path.
- No Wake Word.
- No real Native Multimodal streaming provider.
- Azure streaming speech is outside the accepted Phase 5 provider scope.
- [Issue #18](https://github.com/AntaresQAQ/VoxMesh/issues/18) tracks Azure
  speech qualification limitations.
- [Issue #20](https://github.com/AntaresQAQ/VoxMesh/issues/20) tracks standard
  OpenAI-compatible Audio qualification limitations.

These are exclusions, not implicit fallbacks. Buffered voice remains supported
through `/api/voice`; application streaming uses `/api/voice-stream`.

## 7. Acceptance Gate

The closeout branch passed `pnpm validate` with 375 unit tests, 78 integration
tests, the production builds, and the complete Playwright Mock Mode scenario.
The default `pnpm test:live` run passed its harness test and skipped all 21
credentialed scenarios without making provider requests.

Phase 5 may be marked accepted only after:

1. required local and GitHub checks pass for the final closeout change;
2. any live profile reported as passed has separately captured sanitized
   evidence from an explicitly authorized run;
3. open review findings are resolved against the final commit; and
4. the user explicitly accepts this report.

Until then, the implementation is **ready for acceptance**, not accepted.
