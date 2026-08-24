# Streaming Agent Core

[Documentation Index](../README.md) |
[Voice Stream Protocol](./VOICE_STREAM_PROTOCOL.md) |
[Streaming Primitives](./STREAMING_PRIMITIVES.md) |
[Phase 5 Plan](../development/PHASE_5_STREAMING_VOICE.md) |
[Development Rules](../DEVELOPMENT_RULES.md)

## 1. Implemented Scope

This document defines the Phase 5 PR 3 Streaming Agent Core:

- provider-independent Streaming LLM events
- a pull-based `AsyncGenerator` Agent runtime
- deterministic Mock Streaming LLM
- fragmented tool-call assembly and validation
- sequential MCP execution and follow-up Streaming LLM completions
- session-local enabled/disabled tool mode
- cancellation, event, text, tool-argument, and tool-count bounds
- one exact final assistant result

No TTS segmenter, voice coordinator, WebSocket endpoint, Runtime Routing
change, browser streaming UI, or real Streaming LLM adapter is implemented by
this work.

## 2. Runtime Interface

`StreamingAgentRuntime.run()` returns:

```ts
AsyncGenerator<StreamingAgentEvent, AgentRunResult>;
```

Callers repeatedly consume streaming events. The generator return value is the
same provider-independent final result shape used by buffered Agent Core:

- final assistant response
- tools used
- safe operational events
- final transcript messages

This lets later coordinators render incremental state while persisting only the
final result.

## 3. Streaming Events

The runtime emits:

- `text_delta`
- `tool_call_delta`
- `tool_started`
- `tool_finished`
- `usage`
- `completion_finished`

Text events include a `speakable` flag.

- tool mode `disabled`: text deltas are immediately speakable
- tool mode `enabled`: text deltas are provisional and not speakable
- a final `stop` completion in enabled mode exposes the complete
  `speakableText`
- a completion that resolves to a tool call exposes no speakable text

The Phase 5 segmenter consumes these semantics in the next PR.

## 4. Tool Mode

`toolMode` is required for every run.

### Disabled

- Agent Core does not call `listTools`
- the Streaming LLM receives an empty tool list
- any provider tool-call delta is a protocol error
- direct text may be used for early TTS

### Enabled

- Agent Core discovers the current tools
- provider text remains provisional until completion
- fragmented tool calls are assembled and validated
- MCP is invoked only after the complete call is valid
- a follow-up Streaming LLM completion starts after the tool result

Tool mode is session-local. It does not persist or modify future Phase 8 MCP
permissions.

## 5. Fragmented Tool Calls

The initial Streaming Agent supports one sequential tool call per provider
completion and the existing maximum of three tool calls across iterative
completions.

The assembler:

- requires tool-call index zero
- accepts a stable bounded call ID
- appends fragmented name and arguments
- counts argument UTF-8 bytes incrementally
- limits the name to 256 characters
- limits arguments to 32 KiB
- requires complete JSON
- requires the parsed arguments to be an object
- rejects empty deltas and changing call IDs

Multiple parallel tool calls in one provider completion are explicitly rejected
until the shared `AgentMessage` contract supports a multi-call assistant
message without provider-specific behavior.

## 6. Completion Rules

Each provider stream must emit exactly one `completed` event.

- events after completion are invalid
- `stop` requires no tool fragments
- `tool_call` requires one complete valid tool call
- `length`, `content_filter`, and `other` do not produce a success result
- provider `failure` events become bounded `PROVIDER_FAILED` Agent errors
- duplicate usage events are invalid
- event count is bounded to prevent empty-delta or metadata floods

Pre-tool text is visible as provisional text but is not added to the final
assistant message and is never marked speakable.

## 7. Cancellation and Failure

The required `AbortSignal` is propagated through:

- tool discovery
- Streaming LLM iteration
- MCP execution
- follow-up completions

Provider or MCP abort errors are normalized to `AgentRunCancelledError`.
Cancellation is rechecked after tool discovery, provider iteration, every
generator yield boundary, before MCP invocation, after MCP completion, and
before a successful result. Cancelling while the consumer is paused on
`tool_started` therefore cannot invoke the tool.

If MCP fails after `tool_started`, the runtime emits `tool_finished` with
`success: false` before throwing. MCP results are serialized and validated
inside the same lifecycle boundary; circular, `BigInt`, or otherwise
unserializable results also emit the failed lifecycle before a bounded
`MCP_RESULT_INVALID` error. Unknown tools, malformed tool arguments, limit
violations, missing completion events, and unsupported finish reasons fail
explicitly.

Fragmented argument byte counting is incremental and surrogate-aware. A UTF-8
code point split between provider deltas is counted once rather than as two
replacement characters.

## 8. Mock Streaming LLM

`MockStreamingLlmProvider`:

- emits deterministic text chunks and usage
- emits a fragmented `mock.get_device_status` call for matching requests when
  tools are available
- emits a deterministic post-tool response
- supports configurable chunk size and delay
- checks cancellation between events

With tools disabled, the same request produces a direct response rather than a
tool call.

## 9. Validation

Automated tests cover:

- direct tools-disabled speakable deltas
- tools-enabled provisional text and final speakable text
- fragmented tool-call assembly
- MCP invocation only after complete valid JSON
- post-tool follow-up Streaming LLM
- history and tool-mode propagation
- malformed JSON, multiple calls, disabled-tool calls, missing completion,
  post-completion events, provider failure, and unsupported finish reasons
- text and argument limits
- LLM and MCP cancellation
- cancellation during tool discovery, provider shutdown, a paused
  `tool_started`, and an active MCP call
- failed tool lifecycle
- unserializable MCP results
- UTF-8 argument limits across split surrogate pairs
- sequential tool-call limit
- existing buffered Agent Runtime regression coverage
