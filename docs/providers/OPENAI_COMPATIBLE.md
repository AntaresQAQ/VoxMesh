# OpenAI-compatible Provider Guide

[Documentation Index](../README.md) |
[Live Provider Testing](../development/LIVE_PROVIDER_TESTING.md) |
[Runtime Routing](../architecture/RUNTIME_ROUTING.md)

## 1. Scope

VoxMesh supports providers that implement selected OpenAI-compatible HTTP
endpoints:

- `POST <base-url>/chat/completions`
- `POST <base-url>/audio/transcriptions`
- `POST <base-url>/audio/speech`

Compatibility is capability-specific. Supporting Chat does not imply that the
same provider implements either Audio endpoint. Configure and qualify only the
roles explicitly documented by the provider.

Alibaba Cloud Model Studio Chat is OpenAI-compatible. Its Fun-ASR and
Qwen-Audio-TTS/CosyVoice speech services use a dedicated WebSocket protocol and
must not be configured as OpenAI-compatible Audio.

The generic Chat adapter supports both buffered responses and `stream:true`
SSE responses. Streaming text, fragmented tool calls, usage, finish reasons,
cancellation, timeouts, and safe failures map to Agent Core contracts.
Runtime registration is available, but the selected model and Chat role must
pass configuration-bound streaming verification before route activation;
VoxMesh never silently falls back to buffered Chat.

## 2. Independent Role Configuration

Chat, STT, and TTS use independent:

- HTTPS base URLs
- write-only API keys
- model names
- timeouts
- quotas and budgets
- regional and retention settings

STT also accepts an optional language hint. TTS requires a provider-supported
voice and may include instructions. The qualification suite requests WAV
output.

The harness never copies a Chat value into STT or TTS. Operators may explicitly
set the same value for multiple roles when the provider supports that
configuration.

## 3. Live Qualification

Live tests are opt-in and remain outside default CI. Select only capabilities
that the configured provider documents:

```bash
VOXMESH_LIVE_TESTS=true \
VOXMESH_LIVE_PROVIDERS=openai-compatible \
VOXMESH_LIVE_CAPABILITIES=chat \
VOXMESH_LIVE_MAX_REQUESTS=3 \
pnpm test:live
```

Request bounds:

| Selector         | Scenarios                         | Requests |
| ---------------- | --------------------------------- | -------- |
| `chat`           | direct Chat and MCP-assisted Chat | 3        |
| `stt`            | one buffered transcription        | 1        |
| `tts`            | one buffered synthesis            | 1        |
| `composed-voice` | STT, MCP-assisted Chat, and TTS   | 4        |
| all selectors    | all scenarios above               | 9        |

Selecting an unsupported capability is a test failure, not a skip or fallback.
Unselected capabilities do not require configuration and are skipped.

STT and composed voice require an absolute
`VOXMESH_LIVE_OPENAI_STT_FIXTURE_PATH` to a synthetic mono 16 kHz PCM16 WAV
file no larger than 5 MB. For composed voice, the synthetic speech must ask to
check the light status so Agent Core exercises the deterministic Mock MCP tool.

## 4. Safety Checklist

Before execution:

1. Confirm the exact endpoint compatibility in the provider documentation.
2. Use dedicated non-production credentials and resources.
3. Configure provider budgets, quota limits, and alerts.
4. Review region, retention, abuse-monitoring, and training policies.
5. Use no production data, personal speech, or customer prompt.
6. Set `VOXMESH_LIVE_MAX_REQUESTS` to the selected total, not a larger value.

The runner stops after the first failure and never retries a scenario. Evidence
contains only provider family, capability, literal operator-configured
region/model categories, timestamp, outcome, duration, and a safe error
category. It excludes endpoints, credentials, model names, prompts,
transcripts, tool payloads, provider payloads, and audio.

After execution, clear environment values, rotate or revoke temporary
credentials, remove the local fixture, and delete temporary provider resources.

## 5. Qualification Meaning

A passing scenario qualifies only the exact selected provider capability and
configuration at the recorded time. It does not prove:

- other OpenAI-compatible providers
- unselected endpoints or models
- streaming compatibility
- production availability, latency, cost, quota, or retention suitability

Provider-specific WebSocket, asynchronous task, file-transcription, or native
multimodal APIs require dedicated adapters and qualification.

Direct and MCP-assisted Chat passed against Alibaba Model Studio compatible
mode on 2026-08-23 (UTC+08:00); see the
[sanitized evidence](../qualification/OPENAI_COMPATIBLE_CHAT_2026-08-23.md).
Compatible STT, TTS, and composed voice remain unqualified because no approved
configured provider currently exposes the standard compatible Audio endpoints.
That work is tracked by
[issue #20](https://github.com/AntaresQAQ/VoxMesh/issues/20).
