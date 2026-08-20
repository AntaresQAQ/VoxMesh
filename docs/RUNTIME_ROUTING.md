# Runtime Routing Foundation

VoxMesh stores system-managed provider connections, model deployments, and
runtime routes as the compatibility foundation for future editable routing.

## Scope

The initial foundation:

- migrates existing LLM, STT, TTS, and Native Voice settings into stable
  routing records
- keeps existing configuration APIs and Settings forms compatible
- resolves runtime providers through system route assignments
- records declared and verified model capabilities
- exposes a read-only authenticated routing summary

It does not yet provide arbitrary connection, model, or route CRUD. Deletion,
credential sharing, route cloning, and fallback editing remain future work.

## Storage Model

### Provider connections

`provider_connections` stores:

- stable connection ID
- provider ID
- display name
- endpoint or base URL
- write-only API key
- creation and update timestamps

The initial migration intentionally creates separate Chat, STT, and TTS
connections. STT and TTS are not merged merely because their current endpoint
or API key happens to match.

### Model deployments

`model_deployments` stores:

- stable model deployment ID
- connection ID
- model or deployment name
- API version
- declared capabilities
- verified capabilities
- provider options
- a configuration fingerprint

The fingerprint includes sensitive configuration only through SHA-256 input.
It is used to preserve verification when configuration is unchanged and reset
verification when an endpoint, credential, model, API version, or relevant
option changes.

### Runtime routes

The migration creates:

- `system-route-composed`
- `system-route-native`

The Composed route assigns STT, Chat, and TTS model deployments. The Native
route assigns one Native Multimodal model deployment. `active_runtime_route`
selects the route used by voice requests.

Fallback is always `null` in this foundation. VoxMesh never silently changes
pipeline mode or falls back to Mock Mode.

## Compatibility Migration

Migration runs after SQLite schema initialization and after each legacy
configuration update. It uses deterministic IDs and upserts, so repeated
startup and configuration saves do not create duplicate records.

The existing endpoints remain supported:

- `/api/config/llm`
- `/api/config/speech`
- `/api/config/voice-pipeline`

They act as compatibility facades and synchronize system routing records. The
runtime resolves the corresponding model assignments before creating provider
adapters.

## Capabilities

Model capabilities include:

- text input and output
- audio input and output
- transcription
- speech synthesis
- tool calling
- native multimodal

Mock model capabilities are verified immediately. Real-provider capabilities
are declared at migration time and become verified only after the relevant
connection test succeeds.

Changing relevant provider configuration resets verified capabilities. This
prevents a successful test for one endpoint, credential, or model from being
treated as verification for a different deployment.

## API

Authenticated clients can read:

```text
GET /api/runtime-routing
```

The response contains:

- public connection metadata and `apiKeyConfigured`
- model names and declared/verified capabilities
- route assignments
- active route ID

API keys and configuration fingerprints are never returned.

## Settings

The AI Providers section displays a read-only Runtime Routing summary with:

- active route and mode
- provider connections
- credential configuration status
- model deployments
- declared and verified capabilities

The existing forms remain the editing surface until full CRUD is implemented.

## Failure Behavior

Runtime resolution fails explicitly if:

- the active route does not exist
- a required Composed assignment is missing
- a referenced model deployment does not exist
- a Native route lacks a Native model deployment
- stored capability JSON is invalid

No resolver failure is converted to Mock Mode or another success-shaped
fallback.

## Next Steps

Future routing work should add:

1. editable Provider Connections
2. editable Model Deployments
3. capability-specific connection tests
4. editable Runtime Routes
5. explicit Native-to-Composed fallback
6. route and model metadata in conversation observability
