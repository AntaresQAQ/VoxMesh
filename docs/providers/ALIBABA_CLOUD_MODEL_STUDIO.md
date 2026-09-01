# Alibaba Cloud Model Studio Integration Guide

[Documentation Index](../README.md)

## 1. Integration Strategy

Alibaba Cloud Model Studio, also known as Bailian, provides an OpenAI-compatible API for Qwen and other supported models.

The official migration guidance states that existing OpenAI client code can be migrated by changing:

- API key
- `base_url`
- model name

VoxMesh supports Bailian Chat through a generic OpenAI-compatible LLM adapter
and supports Bailian speech through a dedicated Alibaba Cloud Model Studio
provider. Agent Core remains vendor-independent in both cases.

The speech provider is registered with `stt` and `tts` capabilities and is
selected through Runtime Routing Connections and Model Deployments.

The generic OpenAI-compatible speech adapters use `/audio/transcriptions` and
`/audio/speech`. Model Studio Fun-ASR and Qwen-Audio-TTS/CosyVoice do not use
those endpoints. They use the Model Studio WebSocket task protocol and must be
configured with the dedicated `Alibaba Cloud Model Studio` speech provider.

## 2. Configuration

Create an OpenAI-compatible Connection and Chat Model for Model Studio LLMs:

| Field           | Description                                                      |
| --------------- | ---------------------------------------------------------------- |
| Provider        | OpenAI-compatible                                                |
| Display name    | User-defined provider name, such as `Alibaba Cloud Model Studio` |
| Base URL        | Region and workspace-specific compatible-mode URL                |
| Model           | Model name such as `qwen-plus`                                   |
| API key         | Write-only Model Studio API key                                  |
| Request timeout | Bounded request timeout                                          |
| Maximum output  | Provider request output limit                                    |

Example Singapore base URL:

```text
https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1
```

Example Chat Completions endpoint:

```text
POST <base_url>/chat/completions
```

Base URLs and API keys are region-specific. VoxMesh must not hard-code a region or workspace ID.

### Speech-to-text

Create a dedicated Alibaba Cloud Model Studio Connection and STT Model:

| Field              | Description                                           |
| ------------------ | ----------------------------------------------------- |
| Provider           | Alibaba Cloud Model Studio                            |
| WebSocket endpoint | Workspace-specific `/api-ws/v1/inference` WSS URL     |
| Model              | `fun-asr-realtime` or a supported streaming ASR model |
| API key            | Write-only Model Studio API key                       |
| Language code      | Optional language hint such as `zh` or `en`           |

Beijing endpoint:

```text
wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference
```

Singapore endpoint:

```text
wss://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/inference
```

File-transcription models such as
`qwen-audio-3.0-asr-flash-filetrans` are not accepted by the real-time
WebSocket adapter.

### Text-to-speech

Create an independent Alibaba Cloud Model Studio Connection and TTS Model:

| Field              | Description                                       |
| ------------------ | ------------------------------------------------- |
| Provider           | Alibaba Cloud Model Studio                        |
| WebSocket endpoint | Workspace-specific `/api-ws/v1/inference` WSS URL |
| Model              | For example `qwen-audio-3.0-tts-plus`             |
| API key            | Write-only Model Studio API key                   |
| Voice              | Model-supported voice such as `longanlingxin`     |
| Instructions       | Optional supported style or role instruction      |

STT and TTS remain independently configurable. They may use different
workspaces, regions, API keys, endpoints, models, and voices.

Qwen Audio system voices are model-family specific. For example,
`qwen-audio-3.0-tts-plus` supports `longanlingxin` and `longanlufeng`, while
voices such as `longpaopao_v3.6` belong to the Flash family. VoxMesh rejects a
known Plus/Flash voice mismatch locally instead of sending a request that
Model Studio would reject with a TTS engine error. Custom cloned voices remain
allowed because their names cannot be enumerated locally.

## 3. Supported Model Families

Model Studio's OpenAI-compatible interface supports model families including:

- Qwen
- Qwen-VL
- Qwen-Coder
- Qwen-Omni
- Qwen-Math
- selected DeepSeek, Kimi, GLM, and MiniMax models

Availability and tool-calling behavior depend on the selected model. The configuration UI must not assume every model supports tools.

## 4. Adapter Boundary

The generic OpenAI-compatible adapter maps:

- system, user, assistant, and tool messages
- Chat Completions requests and responses
- function and tool definitions
- tool calls and tool results
- finish reasons
- token usage metadata
- provider errors, throttling, timeouts, and malformed responses

Agent Core must continue to depend only on the existing `LlmProvider` interface.

Azure OpenAI remains a separate adapter because its deployment URL and API-version behavior differ from the standard OpenAI-compatible base URL.

### Fun-ASR WebSocket lifecycle

The STT adapter:

1. validates mono PCM16 WAV input
2. connects with the API key in the WebSocket authorization header
3. sends `run-task` with `task_group=audio`, `task=asr`, and
   `function=recognition`
4. waits for `task-started`
5. sends raw PCM binary chunks
6. sends `finish-task`
7. collects final `result-generated` sentence events
8. completes only after `task-finished`

The adapter rejects malformed events, `task-failed`, premature connection
closure, empty transcripts, unsupported audio, and timeouts.

### Qwen-Audio-TTS/CosyVoice WebSocket lifecycle

The TTS adapter:

1. sends `run-task` with `task=tts` and `function=SpeechSynthesizer`
2. waits for `task-started`
3. sends text through `continue-task`
4. sends `finish-task`
5. collects binary PCM frames
6. completes after `task-finished`
7. wraps the PCM response in a standard mono WAV file

The current composed voice API remains request/response based. Browser
recording is normalized to mono 16 kHz PCM16 WAV after recording, then the
buffered audio is submitted through the WebSocket adapter. True microphone
streaming uses separate provider-independent Streaming STT/TTS contracts.

### Application-level streaming speech

The Fun-ASR Streaming STT adapter accepts ordered mono 16 kHz PCM16LE frames
while capture is active. It emits bounded partial sentence text and one final
transcript after `task-finished`.

The Qwen-Audio-TTS/CosyVoice Streaming TTS adapter sends one stable text
segment and emits ordered mono 24 kHz PCM16LE frames plus exact aggregate
metadata. Both sessions fail closed on malformed ordering, provider timeout,
caller cancellation, backpressure, or premature socket closure.

The adapters are registered in runtime composition. Role-specific verification
and route activation must still qualify the exact model and configuration
before use. Unsupported routes do not fall back to buffered speech.

## 5. Security

The Model Studio API key must:

- be accepted through a write-only field
- never be returned by configuration APIs
- never be logged
- be excluded from diagnostics and support bundles
- follow the existing SQLite host-filesystem trust model

The dedicated provider only accepts WSS endpoints on the documented Alibaba
Cloud Model Studio hosts and the fixed `/api-ws/v1/inference` path. This
prevents a configured speech API key from being sent to an arbitrary WebSocket
host.

## 6. Validation

The implementation includes:

- request and response mapping unit tests
- tool-calling contract tests
- malformed response and invalid tool-argument tests
- WebSocket task lifecycle, binary frame, provider error, and timeout tests
- PCM WAV validation, encoding, browser downmixing, and resampling tests
- configuration API integration tests
- Settings component tests
- offline request, response, tool-call, error, registry, configuration, and UI tests

A live Model Studio smoke test still requires user-provided credentials and is not part of default CI.

The default CI suite must remain offline and deterministic.

### Opt-in live qualification

The Alibaba suite qualifies dedicated speech protocols separately from
OpenAI-compatible Chat:

| Selector                   | Scenarios                                                       | Requests |
| -------------------------- | --------------------------------------------------------------- | -------- |
| `stt`                      | one dedicated Fun-ASR transcription                             | 1        |
| `tts`                      | one dedicated Qwen/CosyVoice synthesis                          | 1        |
| `composed-voice`           | dedicated STT, compatible Chat/MCP, dedicated TTS               | 4        |
| `streaming-stt`            | one incremental Fun-ASR session                                 | 1        |
| `streaming-tts`            | one ordered Qwen/CosyVoice PCM session                          | 1        |
| `streaming-composed-voice` | Streaming STT, compatible Streaming Chat/MCP, and Streaming TTS | 4        |
| all selectors              | all scenarios above                                             | 12       |

Example full streaming execution:

```bash
VOXMESH_LIVE_TESTS=true \
VOXMESH_LIVE_PROVIDERS=alibaba-model-studio \
VOXMESH_LIVE_CAPABILITIES=streaming-stt,streaming-tts,streaming-composed-voice \
VOXMESH_LIVE_MAX_REQUESTS=6 \
pnpm test:live
```

STT and composed voice require an absolute
`VOXMESH_LIVE_ALIBABA_STT_FIXTURE_PATH` to a synthetic mono 16 kHz PCM16 WAV
file no larger than 5 MB. The composed fixture must ask to check the light
status so Agent Core executes the deterministic Mock MCP tool.

Composed voice also requires the independently configured
`VOXMESH_LIVE_OPENAI_CHAT_*` group for Alibaba compatible-mode Chat. The
harness never rewrites the WebSocket speech endpoint into a Chat endpoint or
copies a speech credential into Chat implicitly.

Before execution:

1. Confirm the workspace and API key belong to the intended region.
2. Confirm the selected Fun-ASR and Qwen/CosyVoice models are enabled.
3. Confirm the selected system or custom voice belongs to the TTS model family.
4. Configure workspace budgets, quota limits, and alerts.
5. Review regional retention and abuse-monitoring settings.
6. Use only non-production credentials and synthetic content.

The runner stops at the first failure and does not retry a scenario. Evidence
contains no workspace ID, endpoint, key, model, voice, prompt, transcript,
provider event, tool payload, or audio. After execution, clear environment
values, revoke temporary credentials, remove the local fixture, and delete
temporary resources.

Dedicated STT, dedicated TTS, and buffered composed voice passed on 2026-08-23
(UTC+08:00); see the
[sanitized evidence](../qualification/ALIBABA_MODEL_STUDIO_2026-08-23.md).
This evidence does not qualify application-level streaming or standard
OpenAI-compatible Audio endpoints. Streaming selectors are available, but
their result remains unqualified until an explicitly authorized run publishes
separate sanitized evidence.

## 7. Migration

Migrating existing OpenAI-compatible code to Alibaba Cloud Model Studio requires only:

```text
API key
base_url
model name
```

No Agent Core changes should be required.

This three-field migration applies to Chat only. Speech must use an Alibaba
Cloud Model Studio Connection with the official workspace WebSocket endpoint
and dedicated STT/TTS Model Deployments. Runtime Routing never rewrites an
arbitrary endpoint or silently replaces a configured model.
