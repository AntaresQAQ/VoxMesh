# Runtime Routing

VoxMesh stores provider connections, model deployments, and runtime routes as
the only AI provider configuration source.

## Scope

The routing implementation:

- seeds a complete Mock connection/model/route set for a new database
- resolves runtime providers through system route assignments
- records declared and verified model capabilities
- exposes authenticated routing CRUD and activation APIs
- supports explicit Native-to-Composed fallback
- provides independent STT and TTS streaming switches

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

Native routes may reference one explicit enabled Composed fallback route.
Fallback is disabled when the reference is `null`. VoxMesh never silently
changes pipeline mode or falls back to Mock Mode.

When a Native route is active, text Chat and any Composed provider resolution
use that explicit fallback. Without one, Composed-only operations fail clearly;
they never depend on a hard-coded seeded route.

STT and TTS streaming switches are independent and default to disabled. A
streaming route may be saved only when the assigned model declares
`streaming`. Activation also requires verified capability. Until a true
streaming transport is implemented, VoxMesh rejects activation explicitly
rather than silently running the configured route through the buffered
non-streaming path. The switches do not imply every model from a provider
supports streaming.

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
- independent STT/TTS streaming switches

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
- a streaming route is activated before runtime streaming transport is
  available
- a fallback is not an enabled Composed route

No resolver failure is converted to Mock Mode or another success-shaped
fallback.

## Next Steps

Future routing work should add:

1. true streaming browser and physical-audio transports
2. richer provider-specific option editors instead of JSON
3. route cloning and import/export
4. route and model metadata in conversation observability
