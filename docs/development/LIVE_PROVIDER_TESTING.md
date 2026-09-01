# Live Provider Testing

[Documentation Index](../README.md) |
[Azure OpenAI](../providers/AZURE_OPENAI.md) |
[Alibaba Cloud Model Studio](../providers/ALIBABA_CLOUD_MODEL_STUDIO.md) |
[Development Rules](../DEVELOPMENT_RULES.md)

## 1. Purpose

Live provider tests qualify explicitly selected, non-production AI resources.
They are separate from deterministic offline validation because they require
credentials, can incur cost, depend on regional availability, and may send test
content to an external provider.

The initial harness validates opt-in, selectors, configuration, request limits,
timeouts, synthetic audio, and redaction. Provider-specific live scenarios are
added in separate qualification changes.

## 2. Safety Model

Live tests:

- run only when `VOXMESH_LIVE_TESTS=true`
- require explicit provider and capability selectors
- are not part of `pnpm validate` or default CI
- fail before network access when selected configuration is missing or invalid
- use HTTPS or WSS endpoints without embedded credentials
- enforce per-request timeouts and a suite request budget
- use synthetic text and generated non-speech PCM WAV data
- must not retain provider input or output audio
- sanitize errors before printing or recording qualification evidence

Use isolated test resources, provider budgets, quota limits, and credentials
that can be revoked without affecting production. Review the provider's region,
retention, and abuse-monitoring terms before opting in.

## 3. Running the Harness

The disabled default is safe and makes no provider request:

```bash
pnpm test:live
```

Enable only the intended provider families and capabilities:

```bash
VOXMESH_LIVE_TESTS=true \
VOXMESH_LIVE_PROVIDERS=azure-openai \
VOXMESH_LIVE_CAPABILITIES=chat \
pnpm test:live
```

Allowed provider selectors:

- `azure-openai`
- `openai-compatible`
- `alibaba-model-studio`

Allowed capability selectors:

- `chat`
- `stt`
- `tts`
- `composed-voice`
- `streaming-chat`
- `streaming-stt`
- `streaming-tts`
- `streaming-composed-voice`

Selectors are comma-separated. `alibaba-model-studio` owns dedicated STT and
TTS scenarios, including streaming speech. Its composed voice scenarios use
the independently configured OpenAI-compatible Chat role. Alibaba Chat by
itself therefore uses the `openai-compatible` provider selector. Azure and
OpenAI-compatible provider families support `streaming-chat`; streaming speech
selectors are intentionally limited to Alibaba Model Studio.

Select exactly one provider family per command. This keeps
`VOXMESH_LIVE_MAX_REQUESTS` a hard bound for the complete process. Run separate
commands when qualifying multiple provider families.

`VOXMESH_LIVE_MAX_REQUESTS` defaults to `12` and accepts `1` through `50`.
Provider-specific qualification suites consume this shared budget before each
billable request. Do not raise it merely to hide an unexpected retry loop.
The live runner disables retries and stops after the first failed scenario.

Streaming request counts are exact:

| Provider family         | Selector                   | Requests or sessions |
| ----------------------- | -------------------------- | -------------------- |
| Azure/OpenAI-compatible | `streaming-chat`           | 3                    |
| Alibaba Model Studio    | `streaming-stt`            | 1                    |
| Alibaba Model Studio    | `streaming-tts`            | 1                    |
| Alibaba Model Studio    | `streaming-composed-voice` | 4                    |

`streaming-chat` executes one direct completion and a two-completion Mock MCP
flow. `streaming-composed-voice` executes one STT session, two Chat
completions, and one TTS session.

## 4. Configuration Groups

Set only variables required by the selected capabilities. Every role has an
independent endpoint, key, model, and timeout. The harness never copies values
between roles.

### Azure OpenAI Chat

```text
VOXMESH_LIVE_AZURE_CHAT_ENDPOINT=https://<resource>.openai.azure.com
VOXMESH_LIVE_AZURE_CHAT_API_KEY=<secret>
VOXMESH_LIVE_AZURE_CHAT_MODEL=<deployment>
VOXMESH_LIVE_AZURE_CHAT_API_VERSION=<api-version>
VOXMESH_LIVE_AZURE_CHAT_TIMEOUT_MS=30000
VOXMESH_LIVE_AZURE_CHAT_MAX_OUTPUT_TOKENS=128
```

### Azure OpenAI STT

```text
VOXMESH_LIVE_AZURE_STT_ENDPOINT=https://<resource>.openai.azure.com
VOXMESH_LIVE_AZURE_STT_API_KEY=<secret>
VOXMESH_LIVE_AZURE_STT_MODEL=<deployment>
VOXMESH_LIVE_AZURE_STT_API_VERSION=<api-version>
VOXMESH_LIVE_AZURE_STT_LANGUAGE=en
VOXMESH_LIVE_AZURE_STT_FIXTURE_PATH=/absolute/path/to/synthetic-check-light.wav
VOXMESH_LIVE_AZURE_STT_TIMEOUT_MS=30000
```

The Azure STT and composed-voice scenarios require a local mono 16 kHz PCM16
WAV fixture no larger than 5 MB. Use synthetic speech with no personal or
production content. For composed voice, the recording must ask the agent to
check the light status so the deterministic Mock MCP tool path is exercised.

The same fixture constraints apply to Alibaba `streaming-stt` and
`streaming-composed-voice`. The streaming runner decodes the WAV locally and
sends ordered mono 16 kHz PCM16LE frames; it never uploads the WAV container as
a buffered fallback.

### Azure OpenAI TTS

```text
VOXMESH_LIVE_AZURE_TTS_ENDPOINT=https://<resource>.openai.azure.com
VOXMESH_LIVE_AZURE_TTS_API_KEY=<secret>
VOXMESH_LIVE_AZURE_TTS_MODEL=<deployment>
VOXMESH_LIVE_AZURE_TTS_API_VERSION=<api-version>
VOXMESH_LIVE_AZURE_TTS_VOICE=<supported-voice>
VOXMESH_LIVE_AZURE_TTS_INSTRUCTIONS=<synthetic-test-instructions>
VOXMESH_LIVE_AZURE_TTS_RESPONSE_FORMAT=wav
VOXMESH_LIVE_AZURE_TTS_TIMEOUT_MS=30000
```

### OpenAI-compatible Chat

```text
VOXMESH_LIVE_OPENAI_CHAT_ENDPOINT=https://<compatible-host>/v1
VOXMESH_LIVE_OPENAI_CHAT_API_KEY=<secret>
VOXMESH_LIVE_OPENAI_CHAT_MODEL=<model>
VOXMESH_LIVE_OPENAI_CHAT_TIMEOUT_MS=30000
VOXMESH_LIVE_OPENAI_CHAT_MAX_OUTPUT_TOKENS=128
```

### OpenAI-compatible STT

```text
VOXMESH_LIVE_OPENAI_STT_ENDPOINT=https://<compatible-host>/v1
VOXMESH_LIVE_OPENAI_STT_API_KEY=<secret>
VOXMESH_LIVE_OPENAI_STT_MODEL=<model>
VOXMESH_LIVE_OPENAI_STT_LANGUAGE=en
VOXMESH_LIVE_OPENAI_STT_FIXTURE_PATH=/absolute/path/to/synthetic-check-light.wav
VOXMESH_LIVE_OPENAI_STT_TIMEOUT_MS=30000
```

### OpenAI-compatible TTS

```text
VOXMESH_LIVE_OPENAI_TTS_ENDPOINT=https://<compatible-host>/v1
VOXMESH_LIVE_OPENAI_TTS_API_KEY=<secret>
VOXMESH_LIVE_OPENAI_TTS_MODEL=<model>
VOXMESH_LIVE_OPENAI_TTS_VOICE=<supported-voice>
VOXMESH_LIVE_OPENAI_TTS_INSTRUCTIONS=<synthetic-test-instructions>
VOXMESH_LIVE_OPENAI_TTS_RESPONSE_FORMAT=wav
VOXMESH_LIVE_OPENAI_TTS_TIMEOUT_MS=30000
```

### Alibaba Cloud Model Studio STT

```text
VOXMESH_LIVE_ALIBABA_STT_ENDPOINT=wss://<workspace-host>/api-ws/v1/inference
VOXMESH_LIVE_ALIBABA_STT_API_KEY=<secret>
VOXMESH_LIVE_ALIBABA_STT_MODEL=<supported-asr-model>
VOXMESH_LIVE_ALIBABA_STT_LANGUAGE=en
VOXMESH_LIVE_ALIBABA_STT_FIXTURE_PATH=/absolute/path/to/synthetic-check-light.wav
VOXMESH_LIVE_ALIBABA_STT_TIMEOUT_MS=30000
```

### Alibaba Cloud Model Studio TTS

```text
VOXMESH_LIVE_ALIBABA_TTS_ENDPOINT=wss://<workspace-host>/api-ws/v1/inference
VOXMESH_LIVE_ALIBABA_TTS_API_KEY=<secret>
VOXMESH_LIVE_ALIBABA_TTS_MODEL=<supported-tts-model>
VOXMESH_LIVE_ALIBABA_TTS_VOICE=<supported-voice>
VOXMESH_LIVE_ALIBABA_TTS_INSTRUCTIONS=<synthetic-test-instructions>
VOXMESH_LIVE_ALIBABA_TTS_RESPONSE_FORMAT=wav
VOXMESH_LIVE_ALIBABA_TTS_TIMEOUT_MS=30000
```

Do not place real values in `.env.example`, shell history, issue descriptions,
pull requests, test snapshots, traces, screenshots, or copied terminal output.
Prefer a temporary shell session or an approved secret injection mechanism.

## 5. Request and Cost Bounds

Provider qualification changes must document their exact request count before
execution. The harness request budget is a hard upper bound, not an expected
cost estimate.

Each provider operation must use `executeLiveProviderRequest` and forward its
`AbortSignal` to the adapter. This boundary consumes the shared request budget,
applies `runWithLiveTestTimeout`, and sanitizes any failure before it leaves the
harness. A timeout aborts the operation and fails the test; it must not start a
replacement request automatically. Provider-specific retry behavior remains
bounded by the adapter contract and must be included in the documented
worst-case request count.

Before each run:

1. Confirm the selected provider, region, models, and capabilities.
2. Confirm quota and a provider-side budget or alert.
3. Confirm the resources contain no production data.
4. Confirm credentials are scoped and can be revoked.
5. Confirm provider retention and abuse-monitoring settings.
6. Record the expected and maximum billable request counts.

After each run:

1. Remove temporary environment values from the shell.
2. Revoke test credentials if they are no longer needed.
3. Delete provider-side test resources when qualification is complete.
4. Review output before sharing it.

## 6. Failure Output

Qualification output may contain only bounded, sanitized error categories such
as:

- `authentication`
- `cancelled`
- `configuration`
- `invalid-response`
- `provider`
- `quota`
- `timeout`

Do not print raw provider response bodies. If a provider returns a useful
diagnostic, map it to an existing safe category or add a reviewed mapping with
tests that prove credential and payload redaction.

## 7. Trusted CI

Live tests must not run for pull requests from forks or other untrusted code.
If trusted CI execution is introduced, use:

- an explicitly dispatched workflow
- an environment with required reviewers
- short-lived or dedicated test credentials
- provider-side budgets and quota limits
- no artifact upload until output has been sanitized

Default branch and pull-request validation must continue to use `pnpm validate`
without live credentials.
