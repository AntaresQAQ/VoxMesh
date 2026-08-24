# Runtime Routing

[Documentation Index](../README.md)

VoxMesh stores provider connections, model deployments, and runtime routes as
the only AI provider configuration source.

## Scope

The routing implementation:

- seeds a complete Mock connection/model/route set for a new database
- resolves runtime providers through system route assignments
- records declared and verified model capabilities
- records explicit provider and route readiness tests
- exposes authenticated routing CRUD and activation APIs
- supports explicit Native-to-Composed fallback
- provides independent STT, Chat, and TTS streaming switches plus a
  full-chain profile control

## Storage Model

### Provider connections

`provider_connections` stores:

- stable connection ID
- provider ID
- display name
- endpoint or base URL
- write-only API key
- readiness state and the last completed safe diagnostic
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

Each route also stores readiness state and its last completed safe diagnostic.
Readiness is separate from activation and capability declarations.

Native routes may reference one explicit enabled Composed fallback route.
Fallback is disabled when the reference is `null`. VoxMesh never silently
changes pipeline mode or falls back to Mock Mode.

When a Native route is active, text Chat and any Composed provider resolution
use that explicit fallback. Without one, Composed-only operations fail clearly;
they never depend on a hard-coded seeded route.

STT, Chat, and TTS streaming switches are independent and default to disabled.
The full-chain profile changes all three switches together but does not replace
the independent controls, so all eight transport combinations remain
representable. Native routes normalize all three switches to disabled.

A Composed route always requires declared `non-streaming` capability for every
role because `/api/voice` remains buffered. A streaming role additionally
requires declared `streaming` capability when saved and verified `streaming`
capability when activated.

Activation also checks runtime availability separately from model
capabilities. The server transport, browser client, and provider adapter for
each enabled role must be registered. The current production composition
registers none of those Phase 5 runtime surfaces, so streaming configurations
can be saved but cannot be activated. VoxMesh reports the missing gate instead
of silently downgrading the route to buffered execution.

## Initialization

New databases receive deterministic Mock connections, models, Composed and
Native routes, and an active Composed route. Initialization runs only when the
system routing records do not exist, so restart never overwrites administrator
changes.

Provider configuration is managed only through `/api/runtime-routing`.

The authenticated Dashboard receives the same safe routing summary from
`/api/dashboard`. It resolves the active route, assigned models and
connections, provider IDs, transport mode, fallback, enabled state, and
required capability verification without exposing credentials or maintaining
a second legacy provider-selection model.

## Capabilities

Model capabilities include:

- text input and output
- audio input and output
- transcription
- speech synthesis
- tool calling
- native multimodal
- non-streaming
- streaming

Mock model capabilities are verified immediately. Real-provider capabilities
are declared at migration time and become verified only after the relevant
connection test succeeds.

Changing relevant provider configuration resets verified capabilities. This
prevents a successful test for one endpoint, credential, or model from being
treated as verification for a different deployment.

Route testing snapshots the route assignments, model fingerprints, connection
configuration, and enabled state before external provider calls. Verification
is committed only if that snapshot still matches. Each assignment receives
only the capabilities exercised for its role; Chat tool calling is verified
with an actual MCP tool-call request, MCP execution, and final model response
instead of being inferred from a text completion. Capabilities verified by
multiple unchanged routes are merged rather than replacing earlier results.

## Provider Readiness

Connections and routes expose one of four readiness states:

- `unknown` before an applicable explicit test or after configuration changes
- `testing` while an explicit route test is running
- `ready` after the applicable provider stages complete
- `failed` after a completed test fails

Readiness stores the last completed test time plus an optional safe error
category and bounded generic message. Raw provider response bodies, endpoints,
workspace or account identifiers, credentials, authorization headers, and
stack traces are never stored in readiness fields or returned to the browser.
The Web Console localizes the safe category instead of displaying raw provider
text.

Every explicit route test receives a monotonic storage generation. Route and
connection updates apply only when that generation is still current, so an
older or slower test cannot overwrite a newer result. Relevant connection,
credential, model, provider-option, capability, enabled-state, or route
assignment changes reset affected readiness to `unknown` and invalidate any
in-flight generation. Display-name-only changes preserve readiness.

If the server restarts while a test is running, persisted `testing` states
become `unknown`; they are never treated as healthy. Readiness does not perform
background requests, automatic retries, activation, route switching, or Mock
fallback.

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
- safe streaming runtime availability for the server transport, browser
  client, and provider adapters by role

API keys and configuration fingerprints are never returned.

Authenticated CRUD endpoints are available below `/api/runtime-routing` for:

- `connections`
- `models`
- `routes`
- active route selection
- route connection testing

Seeded records use stable `system-*` IDs and follow the same edit/delete rules
as custom records. Initialization is tracked separately, so deleting seeded
records does not recreate them on restart.

Connections referenced by models, models referenced by routes, active routes,
and fallback targets cannot be deleted. Activate another route before deleting
the active route. Settings derives these dependencies from the current routing
summary, disables the corresponding Delete action, and names the dependent
records that must be reassigned or removed. Storage validation remains the
authoritative protection against concurrent or stale clients.

Runtime-affecting edits to the active route or its assigned models and
connections are rejected. For an active Native route, its Composed fallback and
the fallback's assignments are part of the same protected dependency graph.
Activate a different tested route before changing the live dependency graph;
display-only names may still be updated.

## Settings

The AI Providers section provides routing management for:

- active route and mode
- provider connections
- credential configuration status
- model deployments and provider options
- declared and verified capabilities
- route assignments and activation
- one-step route testing and activation for inactive routes
- inline editing directly beneath the selected connection, model, or route
- explicit fallback
- independent STT/Chat/TTS streaming switches and a full-chain profile
- declared, verified, adapter, server-transport, and browser-client streaming
  readiness
- connection and route readiness, last test time, and localized safe failure
  category

Destructive actions require an explicit second confirmation in the UI.

An inactive route uses **Test & activate**. VoxMesh first verifies every
assigned provider and updates model capabilities, then activates the route
only when the test succeeds. A provider or configuration failure is shown
directly and activation is not attempted. The active route retains a separate
**Test route** action for health revalidation.

## Failure Behavior

Runtime resolution fails explicitly if:

- the active route does not exist
- a required Composed assignment is missing
- a referenced model deployment does not exist
- a Native route lacks a Native model deployment
- stored capability JSON is invalid
- a referenced connection, model, or route is disabled
- activation requires capabilities that have not been verified
- a streaming switch references a model without declared and verified
  streaming capability
- a streaming route is activated before its server transport, browser client,
  or role-specific provider adapter is available
- a fallback is not an enabled Composed route

No resolver failure is converted to Mock Mode or another success-shaped
fallback.

## Next Steps

Future routing work should add:

1. registration from the true streaming server, browser, and provider adapters
2. richer provider-specific option editors instead of JSON
3. route cloning and import/export
4. route and model metadata in conversation observability
