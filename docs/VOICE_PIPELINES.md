# Voice Pipeline Architecture

## 1. Supported Modes

VoxMesh supports two non-streaming voice pipeline modes.

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

## 5. Agent and Tool Behavior

Composed mode continues to use the existing text-based Agent Core flow.

Native Multimodal mode requires a provider-independent interface that can:

1. accept audio input and tool definitions
2. return text, audio, or tool calls
3. accept tool results
4. continue until a final text and audio response is produced
5. preserve iteration limits, timeout, cancellation, and audit events

If a native model cannot call tools, it must not be selected for a route where MCP tools are enabled unless the user explicitly chooses a no-tools behavior.

Agent Core must not contain provider-specific multimodal branches.

## 6. Settings Experience

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

## 7. Conversation Observability

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

## 8. Testing

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

## 9. Initial Delivery Order

Current implementation status:

- [x] Keep the existing Composed runtime behavior.
- [x] Add a provider-independent Native Voice interface and bounded tool loop.
- [x] Add a Mock Native Multimodal provider.
- [x] Add a persisted Settings mode selector and capability-filtered provider selection.
- [x] Persist mode-specific conversation events.
- [x] Introduce system-managed provider connections and model deployments.
- [x] Seed default LLM/STT/TTS model assignments in a Composed route.
- [x] Resolve current providers through stable system runtime routes.
- [x] Add editable provider connection, model deployment, and route CRUD.
- [x] Add explicit Composed fallback configuration.
- [x] Add independent capability-gated STT and TTS streaming switches.
- [ ] Add the first real Native Multimodal adapter after confirming a model and API.
