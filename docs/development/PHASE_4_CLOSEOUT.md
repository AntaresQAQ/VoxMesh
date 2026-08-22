# Phase 4 Closeout Plan

[Documentation Index](../README.md) |
[Implementation Plan](../IMPLEMENTATION_PLAN.md) |
[Runtime Routing](../architecture/RUNTIME_ROUTING.md) |
[Voice Pipelines](../architecture/VOICE_PIPELINES.md) |
[MVP Specification](../MVP.md) |
[Development Rules](../DEVELOPMENT_RULES.md)

## 1. Purpose

This document is the executable plan for closing the buffered real-provider
acceptance gate after Phase 3. It decomposes the remaining work into focused
pull requests that can be reviewed, tested, and merged independently.

The plan does not authorize behavior-changing implementation by itself. Each
functional pull request still requires explicit user confirmation of its
behavior, scope, risks, acceptance criteria, and test strategy before code is
written.

Phase 4 proves that the existing buffered provider adapters work safely against
real Azure OpenAI and Alibaba Cloud Model Studio resources. It also adds the
minimum operational status needed to diagnose configured providers without
exposing credentials or turning a failed provider into a successful fallback.

## 2. Current Baseline

Implemented on `main`:

- Azure OpenAI buffered Chat, tool calling, Audio STT, and Audio TTS adapters
- generic OpenAI-compatible buffered Chat, STT, and TTS adapters
- Alibaba Cloud Model Studio buffered Chat plus dedicated Fun-ASR and
  Qwen-Audio-TTS/CosyVoice speech adapters
- Runtime Routing connections, models, routes, capability verification, route
  testing, activation, and explicit Native-to-Composed fallback
- write-only provider credentials stored in SQLite under the documented
  host-filesystem trust model
- deterministic offline unit, integration, component, Playwright, and axe
  coverage
- Mock Mode as the default route for a new database

Remaining acceptance gaps:

- no opt-in live-provider test suites
- no recorded live qualification for Azure Chat/STT/TTS or composed voice
- no recorded live qualification for Alibaba/OpenAI-compatible Chat and
  Alibaba speech
- no safe provider readiness and last-error status
- incomplete live-test safeguards for cost, quota, region, retention, and
  credential handling

## 3. Governing Boundaries

### 3.1 Offline CI remains authoritative

Default local validation and required CI must remain deterministic, offline,
and credential-free. Live tests must:

- require an explicit opt-in flag
- skip cleanly when opt-in is absent
- fail clearly when opt-in is present but required configuration is missing
- run outside `pnpm validate`
- never be required for pull requests from forks or untrusted branches
- never use production credentials, production data, or unrestricted quotas

### 3.2 Secrets and retained data

Live test credentials must come from process environment or an approved CI
secret store. They must never be:

- committed to source, fixtures, snapshots, traces, screenshots, or reports
- printed in commands, logs, errors, test names, or assertion messages
- returned through APIs, WebSockets, browser state, or support artifacts
- copied into test output or uploaded artifacts

Generated test audio must be synthetic and contain no personal or conversation
data. Raw input and provider output audio are ephemeral by default and must not
be retained after the test. Any future retained diagnostic artifact requires a
separate approved design with redaction, access, retention, and deletion rules.

### 3.3 Provider failure behavior

Readiness and last-error state is diagnostic metadata, not an automatic
failover mechanism. A failed provider or route must not:

- activate itself
- silently switch to Mock Mode
- silently select another connection, model, route, voice, region, or format
- expose response bodies, credentials, authorization headers, or provider
  request identifiers that may contain sensitive data

### 3.4 Phase exclusions

The following work is not part of the Phase 4 acceptance gate:

- application-level streaming voice transport
- partial transcription, text deltas, or chunked browser playback
- physical audio-device discovery, capture, or playback
- offline Wake Word
- generic third-party MCP configuration or MCP Console
- deployment automation and NanoPi qualification
- a real Native Multimodal adapter

A real Native Multimodal adapter remains an optional Phase 4 extension. It does
not block buffered Azure and Alibaba acceptance and must use a separately
confirmed provider and API.

## 4. Pull Request Plan

Each work package below is one pull request. Pull requests use the listed order
unless a dependency-free documentation correction must land first.

### PR 1 - `test: add opt-in live provider test harness`

Purpose:

- establish one safe, reusable execution contract for every credentialed live
  provider test before adding provider-specific scenarios

Scope:

- add a dedicated live-test command that is excluded from `pnpm validate`
- require an explicit live-test opt-in flag
- validate required environment variables only after opt-in
- define sanitized configuration loaders for Azure OpenAI,
  OpenAI-compatible Chat/STT/TTS, and Alibaba Cloud Model Studio speech
- add bounded per-request and per-suite timeouts
- add provider and capability selectors so contributors can run only the
  resources they intend to bill
- add synthetic text and generated PCM WAV fixtures with no personal data
- add log and error redaction assertions for known credential values
- document local and trusted-CI invocation without publishing secret values
- document expected request counts and cancellation behavior

Acceptance criteria:

- default `pnpm validate` does not read live credentials or make provider calls
- the live command skips with a clear message when not opted in
- opted-in execution fails before network access when required configuration is
  incomplete or invalid
- secrets cannot appear in success, failure, timeout, or configuration output
- selectors and timeouts bound accidental cost and execution duration
- synthetic audio is generated in memory and deleted if a temporary file is
  unavoidable

Required evidence:

- unit tests for opt-in, configuration validation, selectors, redaction, and
  timeout behavior
- an offline harness self-test using local deterministic provider doubles
- documentation examples that contain placeholders only

Dependencies:

- none

Out of scope:

- production readiness state
- real provider qualification results
- provider-specific assertions beyond harness configuration contracts

### PR 2 - `feat: expose safe provider readiness status`

Purpose:

- make configured provider health diagnosable without exposing secrets or
  changing route-selection behavior

Scope:

- define a shared readiness contract for provider connections and runtime
  routes
- represent at least `unknown`, `testing`, `ready`, and `failed`
- record the last completed test time and a bounded, sanitized last error
- update status only from explicit route tests and activation tests
- persist status so restart does not fabricate readiness or lose the most
  recent safe diagnostic result
- invalidate readiness when a connection, credential, model, API version,
  provider option, route assignment, or relevant capability changes
- expose status through authenticated Runtime Routing and Dashboard responses
- display status in Settings and the Dashboard with English and Simplified
  Chinese copy
- keep status distinguishable without relying on color alone
- announce test progress and completion accessibly
- document status semantics, invalidation, redaction, and restart behavior

Acceptance criteria:

- a successful explicit test records `ready` with a completion time
- authentication, quota, timeout, malformed-response, and provider failures
  record `failed` with a stable safe category and bounded message
- cancelled or superseded tests cannot overwrite a newer result
- configuration changes reset affected status to `unknown`
- API keys, authorization values, provider response bodies, stack traces, and
  configuration fingerprints are never returned
- restart preserves completed status but never preserves an in-progress
  `testing` state as healthy
- readiness never triggers fallback, activation, retries, or network calls by
  itself
- Settings and Dashboard remain keyboard-accessible, responsive at 200% zoom,
  and valid in English/Chinese and Light/Dark/System themes

Required evidence:

- storage migration tests for empty and representative existing databases
- unit tests for state transitions, stale completions, invalidation, error
  sanitization, and serialization
- API integration tests for authentication, success, failure, cancellation,
  restart, and secret exclusion
- focused component tests for every changed Web Console component
- Playwright success and failure flows with keyboard, focus, locale, theme,
  responsive, and representative axe checks
- full `pnpm validate`

Dependencies:

- none

Out of scope:

- background polling of providers
- automatic scheduled health checks
- automatic fallback or route switching
- raw provider diagnostics or response payload storage

### PR 3 - `test: qualify Azure buffered providers`

Purpose:

- prove the existing Azure OpenAI buffered adapters and composed voice route
  against explicitly configured non-production Azure resources

Scope:

- use the PR 1 harness for opt-in Azure scenarios
- verify direct Chat completion
- verify MCP-assisted Chat tool calling and final response
- verify Audio TTS returns declared WAV metadata and non-empty audio
- verify Audio STT transcribes a generated or approved synthetic sample
- verify one full buffered Azure STT -> Agent Core -> MCP -> Azure TTS composed
  voice flow
- verify representative authentication, invalid deployment, quota/rate-limit
  when safely reproducible, timeout, cancellation, and content-filter
  diagnostics without exposing secrets
- document resource preparation, deployment names, API versions, regions,
  quota isolation, budget controls, data-retention review, and cleanup

Acceptance criteria:

- all scenarios require explicit opt-in and Azure-only selectors
- Chat works both directly and through the existing Agent Core tool loop
- STT and TTS can use independent resources, regions, keys, and quotas
- the composed voice result contains a transcript, final assistant response,
  tool evidence, and playable WAV metadata
- failures map to stable safe categories and update readiness through the
  normal explicit-test path
- no input or output audio is retained after execution
- the qualification report records only provider family, region category,
  model/deployment aliases chosen by the operator, capability, timestamp,
  outcome, duration, and sanitized error category

Required evidence:

- offline tests for every live-suite branch and assertion
- successful opt-in execution against approved Azure test resources
- sanitized qualification evidence reviewed before inclusion
- unchanged passing `pnpm validate`

Dependencies:

- PR 1
- PR 2

Out of scope:

- Azure AI Speech Service
- performance or load benchmarking
- production deployment certification
- streaming Azure APIs

### PR 4 - `test: qualify OpenAI-compatible buffered providers`

Purpose:

- prove the generic OpenAI-compatible Chat, STT, and TTS adapters against an
  explicitly configured non-production compatible API

Scope:

- use the PR 1 harness for opt-in OpenAI-compatible scenarios
- verify direct Chat completion
- verify MCP-assisted Chat tool calling and final response
- verify `/audio/transcriptions` STT with synthetic PCM WAV
- verify `/audio/speech` TTS and returned audio metadata
- verify a buffered composed route when one approved provider exposes all
  required compatible endpoints
- verify invalid base URL, authentication, unsupported model, quota, timeout,
  cancellation, and malformed-response diagnostics where safely reproducible
- document endpoint compatibility assumptions, model and voice selection,
  quota isolation, budget controls, data-retention review, and cleanup

Acceptance criteria:

- all scenarios require explicit opt-in and OpenAI-compatible-only selectors
- Chat, STT, and TTS use independent base URLs, keys, models, and options
- the harness never assumes that one compatible provider implements every
  OpenAI endpoint
- unsupported capabilities skip only when the operator did not select them;
  selected but unsupported capabilities fail clearly
- provider errors are sanitized before status or test output
- no input or output audio is retained after execution
- qualification evidence contains no endpoint, credential, request content,
  transcript, or audio

Required evidence:

- offline tests for every live-suite branch and assertion
- successful opt-in execution against approved compatible test resources for
  every capability claimed as qualified
- sanitized qualification evidence reviewed before inclusion
- unchanged passing `pnpm validate`

Dependencies:

- PR 1
- PR 2

Out of scope:

- claiming that all OpenAI-compatible providers implement Audio APIs
- provider-specific protocols that are not OpenAI-compatible
- streaming browser voice
- provider performance comparisons
- production deployment certification

### PR 5 - `test: qualify Alibaba buffered providers`

Purpose:

- prove generic OpenAI-compatible Chat and dedicated Alibaba Cloud Model Studio
  speech adapters against explicitly configured non-production resources

Scope:

- use the PR 1 harness for opt-in Alibaba scenarios
- verify direct OpenAI-compatible Chat completion
- verify MCP-assisted Chat tool calling and final response
- verify dedicated Fun-ASR WebSocket STT with synthetic PCM WAV
- verify dedicated Qwen-Audio-TTS/CosyVoice synthesis and WAV wrapping
- verify a buffered composed route using Alibaba Chat and speech, unless the
  approved account or regional model matrix requires documenting a mixed
  Alibaba/Azure composed route instead
- verify endpoint allow-listing, workspace/region mismatch, invalid model or
  voice, authentication, quota, timeout, cancellation, malformed event, and
  premature WebSocket closure diagnostics where safely reproducible
- document workspace setup, regional endpoints, supported model/voice pairing,
  quota isolation, budget controls, data-retention review, and cleanup

Acceptance criteria:

- all scenarios require explicit opt-in and Alibaba-only selectors
- Chat proves that Agent Core needs no Alibaba-specific changes
- speech uses the dedicated Model Studio WebSocket protocol rather than
  OpenAI-compatible Audio endpoints
- STT and TTS may use independent workspaces, regions, keys, models, and voices
- known model/voice mismatches fail locally without making a billable request
- provider errors and WebSocket events are sanitized before status or test
  output
- no input or output audio is retained after execution
- qualification evidence contains no workspace ID, endpoint, credential,
  request content, transcript, or audio

Required evidence:

- offline tests for every live-suite branch and assertion
- successful opt-in execution against approved Alibaba test resources
- sanitized qualification evidence reviewed before inclusion
- unchanged passing `pnpm validate`

Dependencies:

- PR 1
- PR 2

Out of scope:

- treating Alibaba speech as OpenAI-compatible Audio
- streaming browser voice
- provider performance comparisons
- production deployment certification

### PR 6 - `docs: close Phase 4 provider acceptance`

Purpose:

- consolidate reviewed qualification evidence and close the Phase 4 gate
  without claiming unsupported providers, regions, or production guarantees

Scope:

- record the tested provider families, capabilities, regions, model families,
  dates, outcomes, and safe limitations
- update Azure and Alibaba provider guides with final tested setup and
  troubleshooting notes
- document live-test cost, quota, region, retention, credential rotation,
  revocation, and incident-response safeguards
- update Runtime Routing and Voice Pipeline documentation with readiness and
  qualification semantics
- mark only completed Phase 4 acceptance items in the Implementation Plan
- identify any deferred provider/model combinations and assign them to an
  explicit future gate
- add the Phase 5 entry decision without authorizing Phase 5 implementation

Acceptance criteria:

- evidence is reproducible from the documented opt-in commands
- no credential, endpoint containing a workspace identifier, raw request,
  response body, transcript, audio, personal data, or billable account
  identifier is committed
- default CI remains offline and deterministic
- all Phase 4 blocking criteria are either complete or explicitly reported as
  incomplete
- a real Native Multimodal adapter is not treated as a blocking criterion
- Phase 5 does not begin until the user explicitly accepts the Phase 4 exit
  gate

Required evidence:

- documentation link and formatting checks
- final `pnpm validate`
- reviewed sanitized Azure and Alibaba qualification summaries

Dependencies:

- PR 2
- PR 3
- PR 4
- PR 5

Out of scope:

- Phase 5 implementation
- release or production-readiness claims

## 5. Pull Request Dependency Graph

```text
PR 1 live-test harness ─────┬──> PR 3 Azure qualification ──────────┐
                            ├──> PR 4 compatible qualification ─────┤
PR 2 readiness status ──────┼──> PR 5 Alibaba qualification ───────┼──> PR 6 closeout
                            │                                       │
                            └───────────────────────────────────────┘
```

PR 1 and PR 2 are independent and may be developed in parallel after separate
functional confirmation. PR 3, PR 4, and PR 5 may also proceed in parallel once
both foundational pull requests are merged.

## 6. Live-Test Environment Contract

The implementation in PR 1 must define exact variable names. The contract must
keep these configuration groups independent:

- Azure Chat endpoint, key, deployment, API version, timeout, and output limit
- Azure STT endpoint, key, deployment, API version, language, and timeout
- Azure TTS endpoint, key, deployment, API version, voice, instructions, and
  timeout
- OpenAI-compatible Chat base URL, key, model, timeout, and output limit
- OpenAI-compatible STT base URL, key, model, language, and timeout
- OpenAI-compatible TTS base URL, key, model, voice, response format, and
  timeout
- Alibaba STT WebSocket endpoint, key, model, language, and timeout
- Alibaba TTS WebSocket endpoint, key, model, voice, instructions, and timeout

The test runner must not infer or copy one credential, endpoint, region, model,
or option into another role. Shared values are allowed only when the operator
sets them explicitly for each role.

## 7. Qualification Evidence

Live qualification output must use a sanitized record such as:

```json
{
  "providerFamily": "azure-openai",
  "capability": "composed-voice",
  "regionCategory": "operator-declared",
  "modelFamily": "operator-declared",
  "testedAt": "ISO-8601 timestamp",
  "outcome": "passed",
  "durationMs": 1234,
  "errorCategory": null
}
```

The committed evidence must not include:

- resource, subscription, tenant, account, or workspace identifiers
- full endpoints or deployment names tied to an account
- request or response bodies
- prompts, transcripts, tool arguments/results, or generated audio
- tokens, headers, cookies, keys, or secret hashes
- provider request IDs unless separately reviewed as non-sensitive

Qualification evidence proves only the tested combination at the recorded
time. It is not a provider-wide compatibility or uptime guarantee.

## 8. Phase 4 Exit Gate

Before declaring Phase 4 complete:

1. PR 1 through PR 6 are reviewed and merged with required CI.
2. Azure direct and MCP-assisted Chat, STT, TTS, and one composed voice flow
   pass against approved non-production resources.
3. OpenAI-compatible direct and MCP-assisted Chat, STT, and TTS pass for every
   capability claimed as qualified.
4. Alibaba/OpenAI-compatible direct and MCP-assisted Chat plus dedicated
   Alibaba STT and TTS pass against approved non-production resources.
5. Safe readiness and last-error state is implemented, persisted, invalidated,
   localized, accessible, and covered end to end.
6. Live tests remain opt-in, bounded, credential-safe, and outside default CI.
7. Cost, quota, region, retention, credential rotation, revocation, and cleanup
   safeguards are documented.
8. Sanitized qualification evidence contains no secrets, personal data, raw
   provider payloads, transcripts, audio, or account identifiers.
9. `pnpm validate` passes and default CI remains offline and deterministic.
10. Any incomplete provider combination is explicit and does not receive a
    success-shaped acceptance claim.
11. The user explicitly accepts the Phase 4 result before Phase 5 starts.
