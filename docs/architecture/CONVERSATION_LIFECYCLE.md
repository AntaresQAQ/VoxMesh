# Conversation Run Lifecycle

[Documentation Index](../README.md)

## 1. Purpose

VoxMesh currently creates one Conversation for each Chat request and waits for
the complete Agent result. It does not have a run identity, end-to-end
cancellation, retry semantics, or multi-turn continuity.

The implementation is split into two reviewable stages:

1. Conversation Run lifecycle, cancellation, and inspection.
2. Chat continuity, history, and retry.

The first stage must land before retry or continuity so every attempt has a
stable identity and exactly one terminal state.

## 2. Core Model

A Conversation is a durable multi-turn container. A Conversation Run is one
attempt to process text or voice input.

```text
Conversation
  ├── Message
  ├── Message
  └── Conversation Run
        ├── Pipeline Event
        ├── Tool activity
        └── terminal status
```

Planned `conversation_runs` fields:

| Field              | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `id`               | Client-generated UUID known before Chat completes    |
| `conversation_id`  | Durable parent Conversation                          |
| `kind`             | `chat`, `voice-composed`, or `voice-native`          |
| `status`           | `in_progress`, `completed`, `failed`, or `cancelled` |
| `correlation_id`   | Server-generated identifier for logs and events      |
| `input_message_id` | User input used by the run                           |
| `retry_of_run_id`  | Previous failed/cancelled run, when applicable       |
| `started_at`       | Start timestamp                                      |
| `completed_at`     | Terminal timestamp                                   |
| `duration_ms`      | Measured terminal duration                           |
| `error_code`       | Stable safe code; no provider secret or raw payload  |

Messages and pipeline events gain an optional `run_id`. Pipeline events also
gain correlation, duration, and these statuses:

- `started`
- `completed`
- `failed`
- `cancelled`

Existing rows migrate with nullable run metadata and preserve their current
ordering and content.

## 3. State Machine and Invariants

```text
in_progress
  ├── completed
  ├── failed
  └── cancelled
```

Terminal states never transition again.

Storage performs conditional terminal updates inside a transaction. Completion,
failure, timeout, HTTP disconnect, and explicit cancellation may race, but only
the first terminal transition succeeds. Losing paths read the persisted state
and must not add duplicate terminal events or assistant messages.

At startup, any run left `in_progress` by a previous process is changed to
`failed` with `SERVER_RESTARTED`. It is never presented as completed.

Only one run may be active in the same Conversation during the initial
continuity implementation. Conflicting submissions fail explicitly.

## 4. API Plan

### Start Chat

```text
POST /api/chat
```

Request:

```json
{
  "runId": "client-generated-uuid",
  "message": "Check the light status",
  "conversationId": "optional-existing-conversation"
}
```

The first lifecycle PR requires `runId` and continues returning the complete
buffered response. `conversationId` remains absent until the continuity PR.

Response adds:

```json
{
  "runId": "...",
  "conversationId": "...",
  "response": "...",
  "usedTools": []
}
```

Duplicate run IDs never start a second provider operation.

### Inspect Run

```text
GET /api/chat/runs/:runId
```

Returns safe run status and timestamps for reconnect and cancellation
reconciliation.

### Cancel Run

```text
POST /api/chat/runs/:runId/cancel
```

Cancellation is authenticated and idempotent:

- an active run requests abort and returns its current state
- an already-terminal run returns that state without mutation
- an unknown run returns `404`

The browser also aborts the original fetch. The explicit endpoint is
authoritative because an HTTP disconnect may not propagate immediately through
every proxy.

## 5. Cancellation Boundary

`AbortSignal` is added to project-owned asynchronous contracts:

- Chat application service
- Agent Core
- LLM provider completion
- MCP discovery and tool execution

Every loop and provider boundary checks cancellation before and after awaited
work. Azure and OpenAI-compatible HTTP calls pass the signal to `fetch`.
Deterministic Mock providers support delayed cancellation fixtures.

Cancellation uses a normalized `RUN_CANCELLED` error. Provider-specific abort
errors and DOM exceptions do not cross the application boundary.

The server keeps an in-memory `runId -> AbortController` registry only for
active work. Entries are removed after every terminal path. The database
remains the durable status source.

The first PR applies cancellation to text Chat. Voice cancellation follows when
physical and streaming voice sessions are implemented.

## 6. Persistence and Observability

Run creation is persisted before provider execution.

The event stream adds safe domain events:

- `run.created`
- `run.updated`
- `message.created`

Logs and pipeline events include `runId`, `conversationId`, and
`correlationId` where available. Raw prompts, tool payloads, provider payloads,
audio, credentials, and stack traces are not added to observability envelopes.

Conversation detail shows:

- run kind and status
- correlation ID
- start and completion time
- duration
- stable error code
- ordered pipeline events grouped by run

## 7. Chat User Experience

During an active text run:

- Send is disabled
- Cancel is available
- progress is announced with `role="status"`
- cancellation is announced without presenting an error-shaped success
- a late completion cannot overwrite an already-cancelled UI state

The client generates `runId` with `crypto.randomUUID()` before sending.
Unsupported browsers fail explicitly rather than using unstable identifiers.

After completion, failure, or cancellation, Conversation and Run queries are
invalidated. The real-time event stream provides prompt UI updates, while HTTP
queries remain the durable recovery path.

## 8. Continuity and Retry Stage

The follow-up PR adds:

- optional `conversationId` in Chat requests
- prior user/assistant message history supplied to Agent Core
- a Chat transcript for the active Conversation
- stable Conversation URL and refresh recovery
- one active run per Conversation
- retry of `failed` or `cancelled` runs

Retry creates a new run with `retry_of_run_id` and reuses the original
`input_message_id`. It does not insert a duplicate user message.

Prior tool messages are not blindly replayed. The initial continuity context
uses durable user and final assistant messages; provider-specific tool-call
transcripts remain scoped to their original run.

## 9. Failure Behavior

- Cancellation, timeout, provider failure, MCP failure, persistence failure, and
  server restart remain distinct terminal outcomes.
- Error codes are stable and safe; detailed provider messages stay in redacted
  operational logs.
- A failed terminal persistence update is surfaced and never converted into a
  successful response.
- Cancellation does not delete partial diagnostic events.
- Retry is unavailable for a completed run or while another run is active.

## 10. Validation

Unit tests:

- valid and invalid state transitions
- completion/cancel/failure races
- Agent and provider AbortSignal propagation
- tool-loop cancellation
- run ID validation and duplicate rejection
- history and retry message selection

Integration tests:

- schema migration and restart reconciliation
- start, inspect, cancel, and terminal APIs
- HTTP disconnect plus explicit cancellation
- provider cancellation and registry cleanup
- run/message/event transaction boundaries
- real-time run and message events

Playwright tests:

- Send, Cancel, cancelling, cancelled, retry, and completion states
- Conversation Inspector run metadata
- refresh/reconnect recovery
- late-response race protection
- keyboard/focus behavior
- English and Simplified Chinese
- Light and Dark themes
- narrow viewport and 200% zoom
- representative axe scans

Default tests remain offline and deterministic.
