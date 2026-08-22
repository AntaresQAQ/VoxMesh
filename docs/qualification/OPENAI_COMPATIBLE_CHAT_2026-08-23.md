# OpenAI-compatible Chat Qualification — 2026-08-23

[Documentation Index](../README.md) |
[OpenAI-compatible Providers](../providers/OPENAI_COMPATIBLE.md) |
[Phase 4 Closeout Plan](../development/PHASE_4_CLOSEOUT.md)

## Result

| Field                | Value                                |
| -------------------- | ------------------------------------ |
| Provider family      | OpenAI-compatible                    |
| Capability           | Direct Chat                          |
| Outcome              | Passed                               |
| Capability           | MCP-assisted Chat                    |
| Outcome              | Passed                               |
| Compatibility target | Alibaba Model Studio compatible mode |
| Region category      | Operator-configured                  |
| Model family         | Operator-configured                  |
| Request budget       | 3                                    |
| Requests used        | 3                                    |
| Evidence date        | 2026-08-23                           |

The opt-in suite completed one direct Chat request, requested and executed the
allow-listed Mock MCP tool, and completed the final Chat response.

## Safety Review

- The suite stopped on first failure and disabled retries.
- The credential was read only inside the local process from the existing
  write-only connection and was never printed or committed.
- No API key, authorization header, endpoint, workspace, model name, account
  identifier, prompt, response, transcript, tool payload, or audio is recorded
  here.
- The result qualifies only the configured compatible Chat deployment at the
  recorded time. It is not a provider-wide or production guarantee.

## Explicitly Unqualified

OpenAI-compatible STT, TTS, and composed voice were not selected because no
approved configured provider currently exposes the standard compatible
`/audio/transcriptions` and `/audio/speech` endpoints.

Alibaba Model Studio speech uses a dedicated WebSocket task protocol. Its
successful speech qualification must remain separate and must not be presented
as OpenAI-compatible Audio evidence. Compatible Audio qualification is tracked
by [issue #20](https://github.com/AntaresQAQ/VoxMesh/issues/20).
