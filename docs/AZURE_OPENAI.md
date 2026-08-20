# Azure OpenAI Configuration Guide

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
2. Create the required Azure OpenAI Connections and Models.
3. Create or edit a Composed Route and assign Chat, STT, and TTS models.
4. Use **Test route** to verify capabilities.
5. Activate the route after verification succeeds.
6. Configure the STT endpoint, key, deployment, API version, and language.
7. Configure the TTS endpoint, key, deployment, API version, voice, and instructions.
8. Select **Save speech settings**.
9. Select **Test speech connection**.

The speech connection test:

- creates a local valid WAV sample
- sends it to the configured STT provider
- synthesizes a short phrase through the configured TTS provider
- reports the transcript and returned audio MIME type

The test makes billable provider requests when Azure OpenAI is selected.

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
