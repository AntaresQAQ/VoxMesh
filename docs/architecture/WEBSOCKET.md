# WebSocket Event Delivery

[Documentation Index](../README.md)

## 1. Implemented Scope

VoxMesh exposes an authenticated server-to-client observability stream:

```text
GET /api/events?after=<sequence>
Upgrade: websocket
Cookie: voxmesh_session
Origin: same origin as Host
```

The stream delivers persisted application logs and conversation pipeline events
without polling. It does not accept application messages from the client and
does not carry raw audio, provider secrets, or the planned full-chain voice
stream.

The buffered `/api/voice` API remains unchanged. The future bidirectional
`/api/voice-stream` protocol is documented as planned behavior in
[Voice Pipelines](./VOICE_PIPELINES.md).

## 2. Authentication and Origin

- The WebSocket upgrade requires the existing administrator session cookie.
- Missing, expired, revoked, or invalid sessions receive an HTTP `401` upgrade
  rejection.
- Browser upgrades require an `Origin` whose host exactly matches the HTTP
  `Host` header.
- Cross-origin upgrades receive `403`.
- Established streams revalidate the session during heartbeat processing and
  close with private code `4401` after revocation or expiry.
- Browsers may expose an HTTP `401` upgrade rejection as abnormal close `1006`.
  The client verifies the HTTP session before reconnecting; an explicit
  authentication failure returns to Login, while network uncertainty continues
  bounded reconnect attempts.
- Unknown upgrade paths, invalid replay cursors, and excessive connection
  counts fail explicitly.

The event protocol never puts session tokens in URLs, messages, logs, or close
reasons.

## 3. Event Contract

Every message has `version: 1` and one of these types:

| Type               | Purpose                                                    |
| ------------------ | ---------------------------------------------------------- |
| `stream.ready`     | Reports the latest and oldest replayable sequence          |
| `stream.event`     | Wraps one ordered persisted domain event                   |
| `stream.gap`       | Reports that the requested cursor predates the ring buffer |
| `stream.heartbeat` | Keeps the connection active and reports latest sequence    |
| `stream.error`     | Reports a fatal protocol-level error                       |

Implemented domain events:

- `log.created`
- `pipeline.created`

Each domain event includes:

- process-unique `streamId`
- monotonically increasing process-local `sequence`
- unique `eventId`
- `emittedAt`
- typed safe payload

Shared TypeBox schemas and TypeScript contracts are defined in
`packages/shared/src/schemas.ts`. Untrusted browser messages are parsed through
the dedicated `@voxmesh/shared/event-stream` subpath so the Web bundle does not
pull in all shared runtime schemas.

## 4. Persistence, Replay, and Gaps

Storage emits an event only after the corresponding log or pipeline event is
successfully persisted.

The application event hub:

- assigns ordered sequences
- retains the latest 500 events in memory
- replays events with `sequence > after`
- reports `stream.gap` when the requested sequence is older than the retained
  window
- isolates storage writes from subscriber failures

The sequence is process-local and resets after restart. A process-unique
`streamId` lets the browser detect a restarted event hub, reset its cursor, and
reconnect from sequence zero. A stream restart also invalidates Logs and
Conversation snapshots and shows a recovery warning because the prior
process's in-memory replay window no longer exists. The HTTP Logs snapshot
remains the durable recovery source. On a gap, the browser invalidates Logs and
Conversation queries and shows an explicit warning; it never presents missing
events as a complete stream.

## 5. Connection Lifecycle and Backpressure

- The server permits at most 10 concurrent observability clients.
- Heartbeats run every 15 seconds.
- Missing heartbeat responses terminate stale sockets.
- A client with more than 512 KiB queued in `bufferedAmount` closes with `1013`.
- Client application messages close the socket with policy code `1008`.
- Fastify `preClose` terminates clients and removes every subscription before
  the HTTP server waits for open connections.

The browser reconnects with exponential backoff from its last applied sequence,
up to 10 seconds. A network reconnect creates a new WebSocket and requests
replay. Authentication close `4401` ends reconnection and returns to Login.
Malformed messages are fatal protocol errors and are not retried silently.

## 6. Logs User Experience

The authenticated application shell owns one event connection. It updates
existing TanStack Query caches and invalidates affected Conversation queries.

The Logs page provides:

- live connection status
- category and severity filters
- validated URL search parameters
- de-duplication by log ID
- newest-first ordering
- replay-gap warning and snapshot refresh
- explicit empty and failure states

Live events received during any HTTP snapshot request wait in a bounded
in-memory merge queue. This applies both to the first load and later gap
recovery or manual refetches. After the request settles, VoxMesh de-duplicates
and merges queued events so an older HTTP response cannot overwrite newer live
data.

## 7. Redaction

Log and pipeline messages are sanitized before persistence and publication.
The current redaction covers:

- authorization values
- complete bearer, basic, digest, AWS SigV4, and other Authorization values
  through the end of their log line
- API key, token, and secret assignments
- valid JSON objects and arrays, recursively redacting API key, access key,
  token, authorization, secret, password, private-key, and credential fields,
  including compound names such as `refresh_token` and `client_secret`
- credential-like assignments embedded in otherwise non-sensitive JSON string
  values
- sensitive URL query parameters, including compound names such as
  `client_secret`
- sensitive query parameters

Provider and application boundaries must continue to avoid constructing
secret-bearing error messages. Redaction is defense in depth, not permission to
log credentials.

## 8. Validation

Automated coverage includes:

- event schema parsing and malformed messages
- sequence, replay, overflow, gap, and unsubscribe behavior
- persistence-before-publication and redaction
- authenticated and cross-origin upgrade handling
- replay and live delivery
- session revocation
- client reconnection cursor and authentication stop
- cache merge, de-duplication, and first-snapshot protection
- URL-backed filters and live Logs rendering
- Playwright live delivery and representative axe scan

Default tests remain offline and deterministic.
