# Streaming Chat Adapters

[Documentation Index](../README.md) |
[Streaming Agent Core](./STREAMING_AGENT.md) |
[Runtime Routing](./RUNTIME_ROUTING.md) |
[Phase 5 Plan](../development/PHASE_5_STREAMING_VOICE.md)

VoxMesh implements provider adapters for Azure OpenAI and generic
OpenAI-compatible Chat Completions streaming. The adapters translate
provider-specific HTTP and SSE data into the provider-independent
`StreamingLlmProvider` contract.

The server registers both adapters as available Streaming Chat surfaces.
Runtime use still requires explicit model declaration, role-specific successful
verification for the current configuration fingerprint, and route activation.
Buffered Chat adapters are unchanged.

## Request Boundary

Both adapters send `POST` requests with:

- the existing provider-independent message and tool mapping
- `stream: true`
- `stream_options.include_usage: true`
- the configured output-token limit when present
- the required caller `AbortSignal` combined with the provider timeout

Azure OpenAI uses its deployment URL, API version, and `api-key` header.
OpenAI-compatible providers use `<base-url>/chat/completions`, an HTTP
authorization header, and the configured model. Alibaba Cloud Model Studio
compatible mode is covered through the generic adapter; dedicated Alibaba
speech protocols remain separate.

Credentials are used only to construct request headers. They are never
included in normalized events, errors, logs, fixtures, or documentation
evidence.

## SSE Parsing and Bounds

The adapters use `eventsource-parser` 4.x, a maintained MIT-licensed parser
with no runtime dependencies and a Node.js requirement matching VoxMesh.

The response body is decoded incrementally with `TextDecoder`, preserving UTF-8
characters split across network chunks. `eventsource-parser` handles SSE line
framing and multiline `data:` fields. Parser buffering is capped at 128 KiB;
each complete event and the queued event-data total use the same independent
bound. Malformed or oversized streams terminate with a safe
`invalid_response` failure.

The adapter requires:

- HTTP success and a `text/event-stream` content type
- one Chat choice with index zero
- object-shaped deltas
- string text, tool-name, tool-ID, and argument fragments
- non-negative integer usage totals
- one finish reason
- a final `[DONE]` marker

Unknown finish reasons map to the provider-independent `other` value. The
adapter delays its `completed` event until `[DONE]` so a provider usage-only
event received after the finish-reason chunk is emitted first.

## Event Mapping

Provider content maps to `text_delta`.

Each Chat Completions tool-call fragment maps directly to
`tool_call_delta` with:

- provider call index
- optional stable call ID
- name fragment
- JSON argument fragment

The adapter deliberately does not assemble tool calls. `StreamingAgentRuntime`
owns assembly, UTF-8 argument bounds, JSON validation, tool authorization,
execution, and follow-up completion behavior. This keeps compatible providers
and the Mock provider on the same Agent Core path.

Provider usage maps from `prompt_tokens` and `completion_tokens`. Finish
reasons map as follows:

| Provider value                   | VoxMesh value    |
| -------------------------------- | ---------------- |
| `stop`                           | `stop`           |
| `tool_calls` / `function_call`   | `tool_call`      |
| `length`                         | `length`         |
| `content_filter`                 | `content_filter` |
| any other non-empty string value | `other`          |

## Cancellation and Cleanup

The response reader is cancelled and its lock is released after:

- normal `[DONE]` completion
- caller cancellation
- provider timeout
- HTTP or SSE failure
- malformed provider data
- early consumer termination

Caller cancellation is rethrown as cancellation so Agent Core preserves its
run semantics. Provider timeouts become a safe `timeout` failure event. Other
HTTP failures expose only provider family and status code. Raw response bodies,
provider error payloads, request messages, tool arguments, and credentials are
never copied into `safeMessage`.

## Registration and Verification

`AzureOpenAiStreamingProvider` and
`OpenAiCompatibleStreamingProvider` are exported from `@voxmesh/ai`.

`apps/server/src/streaming-voice-providers.ts` registers both real adapters.
Route testing completes a streaming Agent response and records Chat-role
verification only when the route, model, and connection remain unchanged.
Activation and every provider resolution recheck that record. There is no
silent fallback to buffered Chat.

## Testing

Deterministic tests cover:

- UTF-8 data split at arbitrary byte boundaries
- multiline SSE data
- text, usage, finish-reason, and `[DONE]` ordering
- fragmented tool calls through the real Streaming Agent/MCP loop
- Azure and compatible URL, authentication, model, and token-limit mapping
- Alibaba-compatible endpoint behavior
- malformed JSON, incomplete streams, parser memory bounds, and safe HTTP
  failures
- provider timeout and caller cancellation
- response-body cancellation
- preservation of all buffered adapter tests
