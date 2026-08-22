# Azure OpenAI Configuration Guide

[Documentation Index](../README.md)

## 1. Supported Integrations

VoxMesh currently supports non-streaming Azure OpenAI deployments for:

- Chat and tool calling
- Speech to text with `gpt-4o-mini-transcribe` or a compatible deployment
- Text to speech with `gpt-4o-mini-tts` or a compatible deployment

Azure model availability varies by region. Deploy the models in Microsoft Foundry before configuring VoxMesh.

## 2. LLM Configuration

Create an Azure OpenAI Connection and Chat Model with these fields:

| Field       | Example                                |
| ----------- | -------------------------------------- |
| Provider    | Azure OpenAI                           |
| Endpoint    | `https://my-resource.openai.azure.com` |
| Deployment  | `gpt-4.1-mini` or your deployment name |
| API version | `2024-10-21`                           |
| API key     | Azure OpenAI resource key              |

The deployment value is the deployment name created in Microsoft Foundry, not necessarily the base model name.

## 3. Speech Configuration

Speech to text and text to speech can be switched independently between Mock and Azure OpenAI.

### Speech to text

| Field             | Recommended test value                     |
| ----------------- | ------------------------------------------ |
| STT provider      | Azure OpenAI                               |
| STT endpoint      | `https://my-stt-resource.openai.azure.com` |
| STT API key       | Key for the STT resource                   |
| STT deployment    | Deployment of `gpt-4o-mini-transcribe`     |
| STT API version   | `2025-04-01-preview`                       |
| STT language code | `zh` for Mandarin or `en` for English      |

Request endpoint:

```text
POST <endpoint>/openai/deployments/<stt-deployment>/audio/transcriptions
     ?api-version=<stt-api-version>
```

The request uses multipart form data with the recorded audio file, deployment model name, and optional language hint.

### Text to speech

| Field              | Recommended test value                     |
| ------------------ | ------------------------------------------ |
| TTS provider       | Azure OpenAI                               |
| TTS endpoint       | `https://my-tts-resource.openai.azure.com` |
| TTS API key        | Key for the TTS resource                   |
| TTS deployment     | Deployment of `gpt-4o-mini-tts`            |
| TTS API version    | `2025-03-01-preview`                       |
| TTS voice          | `coral`                                    |
| Voice instructions | `Speak clearly in natural Mandarin.`       |

Request endpoint:

```text
POST <endpoint>/openai/deployments/<tts-deployment>/audio/speech
     ?api-version=<tts-api-version>
```

VoxMesh requests WAV output for consistent browser playback.

API versions above are current tested defaults for the selected preview model families. Confirm supported versions in the Azure portal before production deployment.

## 4. Saving and Testing

1. Open **Settings → AI Providers**.
2. Create the required Azure OpenAI Connections with their endpoints and
   write-only API keys.
3. Create Chat, STT, and TTS Models with the deployment names, API versions,
   declared capabilities, and provider options described above.
4. Create or edit a Composed Route and assign the Chat, STT, and TTS Models.
5. For an inactive route, select **Test & activate**. The route becomes active
   only after every assigned provider test succeeds.
6. For the active route, select **Test route** to revalidate its current
   configuration.

The route test:

- verifies a direct Chat completion
- verifies Chat tool calling through a real MCP tool execution and final model
  response
- synthesizes a short phrase through the assigned TTS Model
- sends the generated WAV audio to the assigned STT Model
- commits role-specific verified capabilities only if the route, Models, and
  Connections remain unchanged throughout the test

Route testing makes billable provider requests when Azure OpenAI is assigned.

## 5. Voice Request Flow

```text
Browser MediaRecorder
  -> POST /api/voice
  -> selected STT provider
  -> Agent Core
  -> selected LLM provider
  -> optional MCP tools
  -> selected TTS provider
  -> WAV response
  -> browser playback
```

LLM, STT, and TTS providers are selected independently. Supported combinations include:

- all Mock
- Azure LLM with Mock speech
- Mock LLM with Azure speech
- Azure LLM, Azure STT, and Azure TTS
- Azure STT with Mock TTS or the reverse

STT and TTS endpoints and API keys are independent. They may use different Azure resources, regions, subscriptions, quotas, or future service providers.

Configuration changes apply to the next request without restarting the server.

## 6. Secret Handling

API keys are:

- accepted only through write-only fields
- never returned by configuration APIs
- redacted from logs and browser state
- stored as plaintext in SQLite under the approved host-filesystem trust model

Restrict SQLite, configuration, and backup files to the VoxMesh service account. Backups are sensitive.

## 7. Troubleshooting

### HTTP 401 or 403

- verify the API key belongs to the configured resource
- verify the endpoint matches the resource
- verify the deployment exists in that resource

### HTTP 404

- verify the deployment name, not only the base model name
- verify the model is available in the resource region
- verify the configured API version supports the deployment

### HTTP 429

- inspect Azure quota and rate limits
- reduce request frequency
- consider separate resources or deployments for LLM and speech workloads

### Unsupported audio

- confirm the browser generated a supported recording format
- test with WAV when diagnosing provider compatibility
- keep recordings below the current 5 MB API limit

### Empty or poor transcription

- set the correct language hint
- improve microphone quality and input level
- use `gpt-4o-transcribe` when the mini deployment is insufficient and the additional cost is acceptable

### TTS style problems

- use a supported voice
- simplify the voice instructions
- verify that the selected model deployment supports instructions

## 8. Deferred Azure AI Speech Adapter

Azure AI Speech Service remains a possible future adapter for:

- predictable duration or character-based billing
- mature streaming APIs
- SSML and a broad fixed voice catalog
- long-form or high-volume workloads

It must implement the existing provider-independent speech interfaces without modifying Agent Core.

## 9. Opt-in Live Qualification

The live suite uses the production Azure OpenAI adapters but remains outside
default CI. Configure only dedicated, non-production resources and follow the
[Live Provider Testing](../development/LIVE_PROVIDER_TESTING.md) safety model.

Each capability selector has a fixed maximum provider request count:

| Selector         | Scenarios                         | Requests |
| ---------------- | --------------------------------- | -------- |
| `chat`           | direct Chat and MCP-assisted Chat | 3        |
| `stt`            | one buffered transcription        | 1        |
| `tts`            | one buffered synthesis            | 1        |
| `composed-voice` | STT, MCP-assisted Chat, and TTS   | 4        |
| all selectors    | all scenarios above               | 9        |

The tool-assisted scenarios permit one tool call followed by one final Chat
completion. The harness does not retry a timed-out scenario. Set
`VOXMESH_LIVE_MAX_REQUESTS` to at least the selected total and no higher than
the approved cost ceiling.

Example Chat-only execution:

```bash
VOXMESH_LIVE_TESTS=true \
VOXMESH_LIVE_PROVIDERS=azure-openai \
VOXMESH_LIVE_CAPABILITIES=chat \
VOXMESH_LIVE_MAX_REQUESTS=3 \
pnpm test:live
```

Example full Azure execution:

```bash
VOXMESH_LIVE_TESTS=true \
VOXMESH_LIVE_PROVIDERS=azure-openai \
VOXMESH_LIVE_CAPABILITIES=chat,stt,tts,composed-voice \
VOXMESH_LIVE_MAX_REQUESTS=9 \
pnpm test:live
```

Supply the role-specific environment variables documented in the live testing
guide. The STT fixture must be synthetic mono 16 kHz PCM16 WAV, no larger than
5 MB. The composed fixture must say a short phrase that asks to check the light
status so Agent Core executes `mock.get_device_status`.

Before execution:

1. Confirm Chat, STT, and TTS deployment names and API versions in the selected
   Azure regions.
2. Use separate role credentials when the resources, subscriptions, regions,
   or quotas differ.
3. Set Azure budgets, alerts, and conservative per-deployment quota.
4. Review the selected resource's data-retention and abuse-monitoring terms.
5. Confirm no production data, personal speech, or customer prompt is used.
6. Ensure every credential can be rotated or revoked immediately.

The suite keeps audio in memory except for the operator-provided input fixture.
It does not save provider responses, transcripts, prompts, tool payloads, or
audio. Console evidence contains only provider family, capability, the literal
`operator-configured` region/model categories, timestamp, outcome, duration,
and a safe error category. Review output before sharing it.

After execution, remove shell environment values, revoke credentials that are
no longer required, and delete temporary resources and the local audio fixture.
Passing evidence qualifies only the exact tested deployments at that time; it
is not a production availability, latency, cost, or regional compatibility
guarantee.

Azure direct and MCP-assisted Chat were qualified on 2026-08-22; see the
[sanitized evidence](../qualification/AZURE_OPENAI_CHAT_2026-08-22.md). Azure
STT, TTS, and Azure-only composed voice remain unqualified because the operator
does not currently have Azure Speech permissions. That explicit deferral is
tracked by [issue #18](https://github.com/AntaresQAQ/VoxMesh/issues/18).
