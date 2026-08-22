# Azure OpenAI Chat Qualification — 2026-08-22

[Documentation Index](../README.md) |
[Azure OpenAI](../providers/AZURE_OPENAI.md) |
[Phase 4 Closeout Plan](../development/PHASE_4_CLOSEOUT.md)

## Result

| Field           | Value                       |
| --------------- | --------------------------- |
| Provider family | Azure OpenAI                |
| Capability      | Direct Chat                 |
| Outcome         | Passed                      |
| Capability      | MCP-assisted Chat           |
| Outcome         | Passed                      |
| Region category | Operator-configured         |
| Model family    | Operator-configured         |
| Execution path  | Explicit Runtime Route test |
| Evidence date   | 2026-08-22                  |

The explicit route test completed a direct Chat request, requested the
allow-listed Mock MCP tool, executed that tool, and completed the final Chat
response. The route and assigned Azure Chat connection reached `ready`.

## Safety Review

- No API key, authorization header, endpoint, resource identifier, deployment
  name, account identifier, raw provider payload, prompt, transcript, tool
  payload, or audio is recorded here.
- The test used the existing bounded Runtime Route test path.
- The result qualifies only the configured test deployment at the recorded
  time. It is not an availability, latency, regional, cost, or production
  guarantee.

## Explicitly Deferred

Azure OpenAI STT, TTS, and Azure-only composed voice were not run because the
operator does not have permission to provision or use the required speech
deployments. The executable tests remain available, and the missing live
evidence is tracked by
[issue #18](https://github.com/AntaresQAQ/VoxMesh/issues/18).

The successful mixed route also exercised configured Alibaba Cloud Model
Studio speech. Alibaba qualification evidence remains owned by its dedicated
Phase 4 work package.
