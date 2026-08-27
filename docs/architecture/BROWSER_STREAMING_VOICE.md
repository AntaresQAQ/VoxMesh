# Browser Streaming Voice

[Documentation Index](../README.md)

The Chat page provides a browser streaming voice experience that is separate
from the existing buffered Voice test. It connects an AudioWorklet microphone
source to the authenticated `/api/voice-stream` transport and renders
transcript, assistant, tool, pressure, failure, and terminal session state.

## Browser Boundary

Streaming is enabled only when the browser provides all required APIs:

- `navigator.mediaDevices.getUserMedia`
- `AudioContext`
- `AudioWorkletNode`
- `WebSocket`

An unsupported browser disables only the streaming controls. VoxMesh does not
silently switch the request to buffered `/api/voice`; the buffered Voice test
remains independently available.

Each session uses the active full-chain Composed Runtime Route selected by the
server. The browser cannot choose providers or weaken route verification.
Administrator session-cookie and same-origin checks are enforced during the
WebSocket upgrade.

## Capture and Resampling

The browser requests one microphone track and connects it to an AudioWorklet.
The worklet transfers Float32 sample blocks to the application without routing
microphone audio to the speakers.

`StreamingPcm16Resampler`:

- accepts the AudioContext's actual source sample rate
- preserves source and output remainders across arbitrary worklet boundaries
- linearly resamples to 16 kHz mono
- emits exact 320-sample, 20 ms PCM16LE frames
- computes the visible loudness meter from the same sample stream

PCM conversion clamps samples to the signed 16-bit range. A final incomplete
20 ms frame is not sent because the protocol requires fixed-size input frames.

The browser input queue uses the shared bounded asynchronous queue limits. A
slow socket can retain at most the configured input bytes and duration plus a
separately bounded producer wait list. Queue overflow, timeout, or send failure
terminates the session instead of dropping or reordering audio.

## Protocol Client

`DefaultBrowserVoiceStreamSession` owns one non-resumable protocol session:

1. open the same-origin WebSocket
2. send `voice.start`
3. validate `voice.ready` or a terminal rejection
4. start microphone capture and ordered input pumping
5. drain accepted input before `voice.input_finished`
6. serialize and validate every incoming control and binary frame
7. wait for playback completion before accepting `voice.completed`
8. close the socket and all browser audio resources

The shared `VoiceStreamClientProtocolState` and
`VoiceStreamServerProtocolState` enforce sequence, format, tool-mode, and
terminal-event invariants in the browser as well as on the server.

With tools disabled, streaming TTS may start after safe LLM text arrives and
before final LLM completion. With tools enabled, output is rejected until the
final no-tool completion is known, preventing speech that could be invalidated
by a tool call.

WebSocket messages are processed through one promise chain. The close event is
queued behind already-delivered messages so a server that sends
`voice.completed` and immediately closes cannot overwrite a valid completion
with a disconnect failure.

## Ordered Playback and Backpressure

Binary output frames are decoded and copied into an owned playback queue.
Playback:

- validates monotonic sequence and one stable output format
- supports mono and stereo PCM16LE
- schedules buffers on one AudioContext timeline
- bounds queued bytes and duration
- waits for every scheduled source to end before session completion

If queued output exceeds its bounds, Web Audio rejects a buffer, or the audio
context cannot start, playback fails the voice session and closes the
transport. Audio is never silently dropped.

## User Experience and Accessibility

Streaming controls expose:

- **Allow tools for this session**, enabled by default
- **Start streaming**
- **Finish input**
- **Cancel streaming**

The state announcement is a polite live region; failures use an alert.
Partial transcript, final transcript, incremental assistant text, tool
activity, server pressure, and microphone level have semantic labels.
Controls remain keyboard operable and responsive in English and Simplified
Chinese, Light and Dark themes, narrow viewports, and browser zoom.

## Cleanup and Failure Behavior

Finish stops capture, drains accepted browser input, and keeps playback alive
until the server terminal event. Cancel, unmount, navigation, rejection,
disconnect, protocol error, input backpressure, or playback failure:

- stop microphone tracks
- disconnect the worklet
- clear its message handler
- close capture and playback AudioContexts
- fail or close input and playback queues
- reset pressure and loudness state
- close the WebSocket

Sessions are not resumed after a disconnect. Starting again creates new
session and run identifiers.

## Deterministic Testing

Focused unit tests cover arbitrary resampling boundaries, fixed PCM framing,
capture cleanup, playback ordering, protocol state, input drain, immediate
server close, tool-gated speech ordering, cancellation, unsupported APIs, and
component state.

The Mock Mode Playwright fixture provides deterministic AudioWorklet and Web
Audio behavior while using the real authenticated server transport. It covers
buffered and streaming controls together, tool-assisted transcript and
assistant output, playback completion, English and Chinese content, Light and
Dark themes, keyboard navigation, narrow viewport and zoom, and axe scans.

Mock route activation continues to follow Runtime Routing verification rules.
This browser work package does not auto-verify or auto-activate streaming
capabilities for newly seeded deployments.
