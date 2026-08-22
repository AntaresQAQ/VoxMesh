# Phase 4 Buffered Provider Acceptance Report

[Documentation Index](../README.md) |
[Phase 4 Closeout Plan](../development/PHASE_4_CLOSEOUT.md) |
[Implementation Plan](../IMPLEMENTATION_PLAN.md)

## 1. Status

Phase 4 is ready for user acceptance after this closeout change is reviewed,
passes required CI, and is merged.

The approved Phase 4 scope is complete with two explicitly unqualified,
permission- or provider-limited Audio combinations tracked as follow-up work.
Those gaps do not change the verified adapter implementation and must never be
reported as passed.

## 2. Qualification Matrix

| Provider path                                           | Direct Chat | MCP Chat | STT         | TTS         | Composed voice | Result                                                                                             |
| ------------------------------------------------------- | ----------- | -------- | ----------- | ----------- | -------------- | -------------------------------------------------------------------------------------------------- |
| Azure OpenAI                                            | Passed      | Passed   | Deferred    | Deferred    | Deferred       | Chat qualified; Speech tracked by [#18](https://github.com/AntaresQAQ/VoxMesh/issues/18)           |
| OpenAI-compatible                                       | Passed      | Passed   | Unqualified | Unqualified | Unqualified    | Chat qualified; compatible Audio tracked by [#20](https://github.com/AntaresQAQ/VoxMesh/issues/20) |
| Alibaba Model Studio dedicated speech + compatible Chat | Passed      | Passed   | Passed      | Passed      | Passed         | Qualified for the tested buffered configuration                                                    |
| Mock                                                    | Passed      | Passed   | Passed      | Passed      | Passed         | Deterministic offline baseline                                                                     |

`Deferred` and `Unqualified` are not success states. Azure Speech was deferred
because the operator lacks access to Azure STT/TTS deployments. Standard
OpenAI-compatible Audio remains unqualified because no approved configured
provider exposes both required `/audio/*` endpoints. Alibaba speech uses its
dedicated WebSocket protocol and is not evidence for compatible Audio.

## 3. Delivered Work

| Pull request                                         | Result                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [#16](https://github.com/AntaresQAQ/VoxMesh/pull/16) | Explicit opt-in live-test harness, request budgets, fail-fast behavior, safe evidence, and deterministic fixtures         |
| [#17](https://github.com/AntaresQAQ/VoxMesh/pull/17) | Persisted connection and route readiness with safe errors, invalidation, restart recovery, UI, and accessibility coverage |
| [#19](https://github.com/AntaresQAQ/VoxMesh/pull/19) | Azure qualification suite and Azure Chat evidence                                                                         |
| [#21](https://github.com/AntaresQAQ/VoxMesh/pull/21) | Shared buffered runner, generic compatible suite, and compatible Chat evidence                                            |
| [#22](https://github.com/AntaresQAQ/VoxMesh/pull/22) | Alibaba endpoint/model/voice validation and complete dedicated speech/composed evidence                                   |

The detailed evidence records are:

- [Azure OpenAI Chat — 2026-08-22](./AZURE_OPENAI_CHAT_2026-08-22.md)
- [OpenAI-compatible Chat — 2026-08-23](./OPENAI_COMPATIBLE_CHAT_2026-08-23.md)
- [Alibaba Model Studio — 2026-08-23](./ALIBABA_MODEL_STUDIO_2026-08-23.md)

## 4. Safety and Operational Evidence

- Live tests require explicit opt-in and exactly one provider family.
- Capability selection controls which role configuration is required.
- Every live process has a hard request budget, disables retries, and stops
  after the first failed scenario.
- Provider requests use bounded timeouts and cancellation where supported.
- Alibaba endpoint host/path and known model/voice mismatches fail before key
  disclosure to an adapter, socket creation, or request-budget consumption.
- Provider and route readiness is updated only by explicit tests.
- Configuration changes invalidate related readiness, and stale test
  generations cannot overwrite newer state.
- Persisted readiness errors contain only allow-listed categories and fixed
  messages.
- Default `pnpm validate` remains offline and deterministic.
- Qualification evidence excludes credentials, endpoints, account/workspace
  identifiers, deployment/model/voice identifiers, provider payloads, prompts,
  transcripts, tool payloads, and audio.
- Synthetic input audio contains no personal or production content and remains
  outside the repository.

## 5. Validation Evidence

The provider work packages passed required Linux, macOS, Windows, Playwright,
and CodeQL checks before merge.

The latest Alibaba work package also passed:

- 178 unit tests
- 44 integration tests
- format and lint checks
- strict TypeScript checks
- production builds
- default no-network live-test execution
- a bounded six-request Alibaba live qualification

Manual Playwright verification confirmed authenticated Dashboard and Settings
readiness rendering and an explicit configured Runtime Route test. Automated
Playwright coverage includes readiness success and safe failure presentation,
axe checks, localization, themes, keyboard behavior, and responsive layouts.

## 6. Known Limits and Follow-up

- [#18](https://github.com/AntaresQAQ/VoxMesh/issues/18): Azure OpenAI STT,
  TTS, and Azure-only composed live qualification
- [#20](https://github.com/AntaresQAQ/VoxMesh/issues/20): standard
  OpenAI-compatible Audio live qualification
- real Native Multimodal provider integration remains an optional,
  non-blocking extension
- application-level streaming remains Phase 5
- physical audio, Wake Word, generic external MCP, deployment automation, and
  hardware qualification remain later phases

## 7. Phase 5 Entry Decision

Phase 5 must not start automatically. After this closeout pull request merges,
the user must explicitly accept this report and authorize the Phase 5
full-chain streaming voice scope.
