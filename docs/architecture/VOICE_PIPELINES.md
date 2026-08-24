# Voice Pipeline Architecture

[Documentation Index](../README.md)

## 1. Supported Modes

The current implementation supports buffered Composed and Mock Native
Multimodal voice pipeline modes. A real Native provider remains planned.
Buffered request/response is the compatibility baseline. The planned
full-chain extension allows Composed routes to independently enable Streaming
STT, Streaming Chat LLM, and Streaming TTS when the transport, adapter, and
model capability are verified.

### Native Multimodal

One multimodal model receives audio input and returns assistant text and audio output.

```text
Audio Input
  -> Multimodal Conversation Model
  -> optional Tool Calls
  -> Multimodal Conversation Model
  -> Text + Audio Output
```

Use this mode when one model deployment supports:

- audio input
- text output
- audio output
- the required languages
- tool calling when MCP tools are enabled

Benefits:

- one model configuration
- fewer provider round trips
- better preservation of tone, timing, and conversational context
- potentially lower latency

Trade-offs:

- stronger provider lock-in
- less control over individual STT and TTS stages
- tool-calling and audio-output support vary by model and API
- fallback and debugging can be less granular

### Composed

Independent providers perform speech recognition, agent reasoning, and speech synthesis.

```text
Audio Input
  -> STT Provider
  -> Chat LLM
  -> optional MCP Tool Calls
  -> Chat LLM
  -> TTS Provider
  -> Audio Output
```

Benefits:

- independently replaceable STT, LLM, and TTS providers
- separate endpoints, credentials, regions, quotas, and costs
- detailed stage-level diagnostics and fallback
- provider specialization

Trade-offs:

- more configuration
- additional network requests
- higher end-to-end latency
- possible loss of speech tone or timing between stages

## 2. Runtime Configuration

The active voice route must store:

```text
mode: native-multimodal | composed
```

### Native Multimodal route

```text
connectionId
modelDeploymentId
fallbackMode: none | composed
fallbackRouteId when fallbackMode is composed
```

### Composed route

```text
sttModelDeploymentId
chatModelDeploymentId
ttsModelDeploymentId
```

Fallback must be explicit. VoxMesh must never silently switch from Native Multimodal to Composed or from a real provider to Mock Mode.

### Browser microphone monitoring

The Chat voice test derives a live loudness meter from the same browser
`MediaStream` used by `MediaRecorder`; it never requests a second microphone
stream. An `AnalyserNode` measures time-domain RMS and maps -60 dBFS through
0 dBFS onto a 0–100% meter so administrators can confirm that input is
arriving before submission.

Stopping, cancelling, failing, or unmounting the recorder cancels the animation
frame, disconnects analyser nodes, closes the browser `AudioContext`, stops
media tracks, and resets the meter to zero. Meter initialization failures abort
recording and release the acquired stream rather than silently presenting a
non-functional level indicator.

### Browser and host audio selection

The browser voice test and VoxMesh-host physical audio are separate adapters
and separate device inventories.

Browser selection uses `MediaDevices` for the microphone and speaker connected
to the Web Console computer. Host selection uses CoreAudio on macOS, Windows
Audio endpoints on Windows, and PipeWire/PulseAudio/ALSA adapters on Linux for
devices connected to the server computer.

Both inventories include every endpoint exposed by the platform, including
built-in, USB, Bluetooth, HDMI/display, dock, and virtual devices. Stable IDs
are selected explicitly in Teams-style independent input/output dropdowns.

The platform adapter owns host discovery and exposes only safe metadata.
VoxMesh never selects the first discovered device, substitutes another device,
or falls back to Mock Audio. If a configured device disappears, its ID remains
configured and the physical voice flow reports it as unavailable until the
administrator refreshes discovery or the same stable device returns.

Input testing exposes only a transient loudness level and immediately discards
captured samples. Output testing uses a bundled local sample so device
diagnostics do not depend on TTS provider availability.

### Planned offline wake-word boundary

The selected future wake-word implementation is sherpa-onnx open-vocabulary
keyword spotting through its Node.js addon. It will run locally in the Linux
platform adapter, supports Linux ARM64, requires no cloud account or access
key, and is licensed under Apache-2.0.

Agent Core depends only on a project-owned `WakeWordDetector` contract.
sherpa-onnx native bindings, models, token files, and keyword profiles remain
outside Agent Core and outside browser audio code.

The detector consumes the already-open selected VoxMesh-host input stream as
mono 16 kHz PCM. It does not open a second host-audio handle, retain
pre-trigger audio, or send audio to a provider. A small bounded in-memory
pre-roll buffer prevents clipping immediately after detection.

Wake-word detection is disabled by default. Settings selects a packaged,
validated keyword profile such as `Hey VoxMesh`, threshold, cooldown, and a
bounded post-trigger capture window. Arbitrary model upload and training are
not part of the initial implementation.

Curated keyword files are generated during the model-artifact build using
sherpa-onnx `text2token` tooling. Deployed devices receive pinned Node native
binaries, model/token files, keyword profiles, licenses, versions, and
checksums; they do not require Python or native compilation at runtime.

VAD remains deferred. After a wake word, the initial implementation captures a
bounded utterance with a mandatory maximum duration and then uses the existing
buffered voice route. Duplicate triggers are ignored during capture,
processing, and cooldown.

## 3. Provider Connections and Models

Credentials and endpoints belong to provider connections, not directly to pipeline roles.

```text
provider_connections
  id
  providerType
  displayName
  endpointOrBaseUrl
  authentication

model_deployments
  id
  connectionId
  modelOrDeploymentName
  apiVersion
  declaredCapabilities
  verifiedCapabilities
  providerOptions

runtime_routes
  id
  purpose
  pipelineMode
  assignments
```

A connection may contain multiple model deployments. STT and TTS may use different connections. A single multimodal model may satisfy the entire Native Multimodal route.

## 4. Capability Model

Provider and model capabilities must be explicit.

```text
text-input
text-output
audio-input
audio-output
transcription
speech-synthesis
tool-calling
non-streaming
streaming
```

Capabilities have two states:

- **Declared**: selected by the adapter, model catalog, or administrator.
- **Verified**: confirmed by a successful capability-specific connection test.

Runtime routes may only use capabilities required by the selected mode. Production activation should require verified capabilities.

## 5. Planned Full-Chain Streaming Voice Sessions

This section defines planned behavior; no application-level streaming voice
transport is implemented yet.

Full-chain streaming will use a dedicated authenticated bidirectional
WebSocket session. It
does not overload the buffered `/api/voice` request and never silently converts
a streaming route into buffered execution.

The browser sends ordered mono PCM frames after a versioned start/ready
handshake. Streaming STT may emit safe partial transcripts, followed by exactly
one final transcript. Only the final transcript enters Agent Core. Streaming
Chat then emits typed text or tool-call deltas. Stable final-turn text segments
flow into Streaming TTS before the LLM completes, and ordered audio chunks enter
bounded Web Audio playback.

STT, Chat, and TTS streaming remain independent. Example profiles include:

```text
buffered STT  + buffered Chat + buffered TTS
streaming STT + buffered Chat + buffered TTS
buffered STT  + streaming Chat + buffered TTS
buffered STT  + streaming Chat + streaming TTS
streaming STT + streaming Chat + streaming TTS
```

Each enabled role requires:

1. runtime transport support
2. a streaming provider adapter
3. declared model `streaming` capability
4. successful streaming capability verification

The protocol defines explicit control states, ordered binary frames, format
metadata, bounded queues, pressure thresholds, timeouts, cancellation, and one
terminal result. Disconnect cancels the session. MVP reconnect creates a new
session and does not resume an interrupted provider socket.

Browser capture uses AudioWorklet PCM frames and reuses the existing loudness
analysis. Browser playback uses a bounded queue with explicit sample metadata.
If required browser APIs are unavailable, streaming is disabled with an
actionable error rather than falling back.

The first real adapters target Alibaba Fun-ASR and
Qwen-Audio-TTS/CosyVoice for speech and Azure/OpenAI-compatible Chat SSE for
LLM text and tool-call deltas. Other providers remain buffered until a specific
endpoint and model are declared and verified as streaming-capable.

Agent Core owns a provider-independent streaming state machine. It assembles
fragmented tool calls, validates arguments, executes MCP only after the call is
complete, and starts a follow-up Streaming Chat completion. Partial events are
observable, while storage receives one final assistant message.

A project-owned segmenter converts stable final-turn LLM text into ordered TTS
segments using punctuation, bounded size, and bounded wait time. It never
speaks incomplete tool arguments or text from a turn that resolves to a tool
call.

Raw audio remains ephemeral. Observability stores only safe session, stage,
sequence, frame/byte count, latency, pressure, cancellation, and error
metadata.

Full-chain streaming does not include VAD, full-duplex barge-in, or interruption
of active TTS playback.

## 6. Agent and Tool Behavior

Composed mode continues to use the existing text-based Agent Core flow.

Native Multimodal mode requires a provider-independent interface that can:

1. accept audio input and tool definitions
2. return text, audio, or tool calls
3. accept tool results
4. continue until a final text and audio response is produced
5. preserve iteration limits, timeout, cancellation, and audit events

If a native model cannot call tools, it must not be selected for a route where MCP tools are enabled unless the user explicitly chooses a no-tools behavior.

Agent Core must not contain provider-specific multimodal branches.

## 7. Settings Experience

The **AI Providers** Settings section should contain:

### Connections

Manage provider endpoints and write-only credentials.

### Models

Manage model or deployment names and display declared and verified capability badges.

### Voice Pipeline

Select:

```text
Voice mode:
  Native Multimodal
  Composed
```

When **Native Multimodal** is selected:

- show one compatible multimodal model selector
- show capability status
- optionally configure an explicit Composed fallback

When **Composed** is selected:

- show STT model selector
- show Chat model selector
- show TTS model selector

The UI must not display irrelevant fields for the inactive mode.

## 8. Conversation Observability

Composed conversations expose:

```text
STT -> Agent -> MCP -> TTS
```

Native Multimodal conversations expose:

```text
Multimodal Input -> Agent/Tools -> Multimodal Output
```

Both modes must persist:

- selected route and model deployments
- durations
- safe provider metadata
- tool calls
- failures
- fallback activation
- text transcript when available

Secrets and raw sensitive audio must not be persisted by default.

## 9. Testing

Both modes require:

- provider contract tests
- capability validation tests
- route validation tests
- tool-call loop tests
- timeout and cancellation tests
- explicit fallback tests
- storage and API integration tests
- bilingual and accessible Settings component tests
- browser end-to-end tests

Default CI remains deterministic and uses Mock providers.

Credentialed live tests are opt-in and must never expose keys or retained audio.

## 10. Initial Delivery Order

Current implementation status:

- [x] Keep the existing Composed runtime behavior.
- [x] Add a provider-independent Native Voice interface and bounded tool loop.
- [x] Add a Mock Native Multimodal provider.
- [x] Persist Composed and Native mode through Runtime Routes and
      capability-filtered Model assignments.
- [x] Persist mode-specific conversation events.
- [x] Introduce system-managed provider connections and model deployments.
- [x] Seed default LLM/STT/TTS model assignments in a Composed route.
- [x] Resolve current providers through stable system runtime routes.
- [x] Add editable provider connection, model deployment, and route CRUD.
- [x] Add explicit Composed fallback configuration.
- [x] Add independent capability-gated STT, Chat, and TTS streaming intent
      switches plus a full-chain profile, with activation blocked until the
      required transport, browser client, and adapters exist.
- [ ] Add versioned streaming voice-session contracts and deterministic Mock
      streaming providers.
- [ ] Extend Agent Core and Chat providers with typed Streaming LLM text and
      tool-call events.
- [ ] Add authenticated browser AudioWorklet/WebSocket capture and playback.
- [ ] Add Azure/OpenAI-compatible Chat SSE and adapt Alibaba Fun-ASR and
      Qwen-Audio-TTS/CosyVoice for incremental streaming sessions.
- [ ] Validate independent STT/Chat/TTS combinations, tool-assisted streams,
      semantic TTS segmentation, backpressure, cancellation, cleanup,
      observability, and live-provider latency.
- [ ] Add the first real Native Multimodal adapter after confirming a model and API.
