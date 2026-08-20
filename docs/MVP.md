# VoxBridge — MVP Development Specification

VoxBridge is a platform-independent, voice-first AI agent gateway.

All contributions to this project MUST follow the mandatory rules in [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) and the phased roadmap in [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md). If these documents appear to conflict, work MUST pause until the user confirms the intended interpretation.

The initial deployment target is NanoPi R2S with a USB conference speakerphone, but NanoPi R2S must NOT be part of the core architecture.

The long-term goal is to support multiple hardware and software platforms while keeping the Agent Core completely platform-independent.

The system should connect:

Voice Input
    ↓
Speech-to-Text
    ↓
AI Agent
    ↓
MCP / Tools
    ↓
Text-to-Speech
    ↓
Voice Output

A Web Console is provided for configuration, monitoring, debugging, and manual testing.

---

## 1. Primary Goals

Build a minimal but extensible AI voice agent gateway with:

- Voice input
- Speech-to-Text abstraction
- LLM abstraction
- Text-to-Speech abstraction
- MCP client support
- Generic third-party MCP integrations
- Web-based management console
- Conversation history
- Real-time logs
- Device status monitoring
- Mock implementations for local development

The first version must be able to run without:

- NanoPi R2S
- USB audio hardware
- Third-party MCP servers
- Real AI API keys

Mock implementations must allow the complete system to be developed and tested on a normal development machine.

---

## 2. Critical Architecture Principle

NanoPi R2S is only the first deployment target.

Do NOT design the system as a NanoPi-specific project.

The core application must be able to run on:

- ARM64 Linux
- x86_64 Linux
- macOS
- Windows
- Docker
- Cloud VMs

Future hardware adapters must not require changes to the Agent Core.

Avoid code such as:

```ts
if (isNanoPiR2S()) {
  // ...
}
````

or:

```ts
if (process.arch === "arm64") {
  // ...
}
```

inside business logic.

Hardware- and operating-system-specific code belongs in platform adapters.

---

## 3. Architecture

Use a layered architecture:

```text
┌─────────────────────────────────────────────┐
│                Web Console                  │
└──────────────────────┬──────────────────────┘
                       │ REST / WebSocket
                       ▼
┌─────────────────────────────────────────────┐
│              Application Layer              │
│                                             │
│ Chat / Voice / Conversation / Configuration │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│                 Agent Core                  │
│                                             │
│ Agent Runtime / MCP / Memory / Permissions │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│              Infrastructure                │
│                                             │
│ STT / LLM / TTS / Audio / Storage          │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────┐
│             Platform Adapters               │
│                                             │
│ Linux / macOS / Windows / R2S / etc.       │
└─────────────────────────────────────────────┘
```

Dependency direction must be one-way:

```text
Application
    ↓
Agent Core
    ↓
Infrastructure Interfaces
    ↓
Platform Implementations
```

The Agent Core must never directly depend on a specific operating system, hardware device, audio backend, or vendor API.

---

## 4. Technology Stack

Use:

- Node.js
- TypeScript
- pnpm
- Fastify
- WebSocket
- React
- Vite
- Tailwind CSS
- SQLite
- Docker / Docker Compose

Prefer simple dependencies and avoid unnecessary frameworks.

The project should use a pnpm monorepo.

Development workflows must support:

- macOS
- Linux
- Windows

macOS and Linux are the primary development platforms, but Windows must also support dependency installation, build, format check, lint, strict type-check, unit tests, integration tests, Mock Mode, and browser end-to-end tests.

Linux-only audio, packaging, deployment, and hardware tests must remain optional on macOS and Windows.

---

## 5. Repository Structure

Use the following structure as a starting point:

```text
voxbridge/
├── apps/
│   ├── server/
│   └── web/
│
├── packages/
│   ├── agent-core/
│   │   ├── agent/
│   │   ├── runtime/
│   │   ├── memory/
│   │   └── permissions/
│   │
│   ├── mcp-client/
│   │
│   ├── ai/
│   │   ├── stt/
│   │   ├── llm/
│   │   └── tts/
│   │
│   ├── audio/
│   │   └── interfaces/
│   │
│   ├── platform/
│   │   ├── interfaces/
│   │   ├── linux/
│   │   ├── macos/
│   │   └── windows/
│   │
│   ├── storage/
│   └── shared/
│
├── deployments/
│   ├── docker/
│   ├── nanopi-r2s/
│   └── linux/
│
├── docs/
│
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

Do not over-engineer the implementation if a simpler structure achieves the same architectural separation.

---

## 6. Agent Core

The Agent Core is the most important platform-independent component.

It should receive user input and decide whether to:

1. Return a normal response.
2. Call one or more MCP tools.
3. Use the tool results to generate the final response.

Basic flow:

```text
User Input
    ↓
LLM
    ↓
Tool Call?
   / \
 No   Yes
 |     |
 ↓     ↓
Reply  MCP Tool
        ↓
    Tool Result
        ↓
       LLM
        ↓
      Reply
```

The Agent Core must not contain integration-specific logic.

It should only know about generic MCP tools.

---

## 7. AI Provider Abstraction

STT, LLM, and TTS must be provider-independent.

Define interfaces similar to:

```ts
interface STTProvider {
  transcribe(audio: Buffer): Promise<string>;
}

interface LLMProvider {
  chat(
    messages: Message[],
    tools?: Tool[]
  ): Promise<LLMResponse>;
}

interface TTSProvider {
  synthesize(text: string): Promise<Buffer>;
}
```

The exact interfaces can be adjusted if required by the implementation.

Streaming-capable providers must use separate optional contracts rather than
changing the buffered contract into an ambiguous union:

```ts
interface StreamingSTTSession {
  pushAudio(chunk: AudioChunk): Promise<void>;
  finish(): Promise<TranscriptionResult>;
  cancel(reason?: string): Promise<void>;
}

interface StreamingTTSProvider {
  synthesizeStream(text: string): AsyncIterable<AudioChunk>;
}

interface StreamingLLMProvider {
  completeStream(input: LLMInput): AsyncIterable<LLMStreamEvent>;
}
```

The application layer owns browser or physical-audio transport. Agent Core
owns a provider-independent streaming state machine for text deltas, tool-call
deltas, validated MCP execution, follow-up completions, cancellation, and one
final assistant message. It must not depend on HTTP SSE, WebSocket, browser, or
vendor streaming APIs.

Potential future providers include:

```text
STT:
- OpenAI
- Whisper
- Local Whisper
- Custom provider

LLM:
- OpenAI
- Anthropic
- Gemini
- Ollama
- OpenAI-compatible APIs

TTS:
- OpenAI
- ElevenLabs
- Edge TTS
- Piper
- Local TTS
```

The Agent Core must not depend on any specific provider.

---

## 8. Audio Abstraction

Audio hardware must also be abstracted.

Define interfaces similar to:

```ts
interface AudioInput {
  listDevices(): Promise<AudioDevice[]>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<AudioBuffer>;
}

interface AudioOutput {
  listDevices(): Promise<AudioDevice[]>;
  play(audio: AudioBuffer): Promise<void>;
}
```

The Agent Core should never directly call:

- ALSA
- PulseAudio
- PipeWire
- CoreAudio
- Windows Audio APIs

Those belong to platform-specific adapters.

The first physical implementation should target Linux and USB audio devices.

NanoPi R2S should use the Linux adapter.

---

## 9. MCP

MCP is the primary boundary for external tools and integrations.

The Agent should interact with external capabilities through MCP rather than hard-coded integrations.

Examples:

```text
Home Assistant
Web Search
Calendar
GitHub
Notion
Smart Home
Custom APIs
```

Define an MCP client abstraction similar to:

```ts
interface MCPServer {
  name: string;

  connect(): Promise<void>;

  listTools(): Promise<MCPTool[]>;

  callTool(
    name: string,
    args: unknown
  ): Promise<unknown>;
}
```

The implementation may use an existing MCP SDK where appropriate.

Do not reinvent the MCP protocol.

---

## 10. Third-Party MCP Integrations

The MVP must provide a generic MCP integration layer rather than a hard-coded integration for one service.

Initial transports:

```text
Streamable HTTP
stdio
```

Remote servers may use no authentication, static HTTP authorization tokens, or custom sensitive headers. OAuth is deferred.

MCP servers and discovered tools must be disabled by default. An administrator must explicitly enable each server and tool before Agent Core can use it.

stdio servers may be configured with an executable, arguments, working directory, and environment variables. Because this grants command-execution capability as the VoxBridge service account, the Web Console must show a prominent security warning and require explicit confirmation before saving or enabling such configuration.

Home Assistant is a possible future MCP integration, along with web search, calendars, GitHub, Notion, and custom services. It is not a required MVP integration and must not require Home Assistant-specific logic in Agent Core or the Web Console.

Secrets must be write-only in the API and Web Console and must never be written to logs.

---

## 11. Web Console

The Web Console is a first-class part of the system.

It must be platform-independent and should work from any browser.

The initial console should contain:

### Dashboard

Display:

- Device status
- CPU usage
- Memory usage
- Temperature when available
- Uptime
- Audio status
- Agent status
- MCP connection status

Do not assume all platforms provide all metrics.

Unavailable metrics should be represented as unavailable rather than causing errors.

---

### Chat

Provide a simple text-based Agent interface:

```text
User Input
    ↓
Agent
    ↓
Response
```

Also provide manual voice testing:

```text
[ Start Recording ]

[ Stop Recording ]

[ Play Response ]
```

The browser should be able to test the complete Agent pipeline even when physical audio hardware is unavailable.

---

### Conversations

Display the complete processing pipeline:

```text
User
 ↓
STT
 ↓
Agent
 ↓
MCP Tool Call
 ↓
MCP Tool Result
 ↓
LLM
 ↓
TTS
 ↓
Assistant
```

Each step should contain enough metadata to debug failures.

---

### MCP

Display:

```text
MCP Servers
Server Status
Available Tools
```

Allow a developer to inspect and manually execute a tool.

Example:

```text
Tool:
home_assistant.light.turn_on

Arguments:

{
  "entity_id": "light.living_room"
}

[ Execute ]
```

Tool execution results should be displayed in the UI.

---

### Logs

Provide real-time logs through WebSocket.

Support filtering by:

```text
ALL
AUDIO
STT
LLM
TTS
AGENT
MCP
ERROR
```

Example:

```text
12:31:01 INFO  server started
12:31:05 INFO  MCP connected
12:31:10 INFO  STT started
12:31:12 INFO  LLM request
12:31:13 INFO  MCP tool call
12:31:14 INFO  TTS started
```

---

## 12. REST API

Implement at least:

```text
GET  /api/health

GET  /api/device

GET  /api/config
PUT  /api/config

GET  /api/conversations
GET  /api/conversations/:id

POST /api/chat

GET  /api/mcp/servers
GET  /api/mcp/tools
POST /api/mcp/tools/:name/test

GET  /api/logs
```

WebSocket:

```text
/ws
```

The WebSocket should be used for real-time:

- Logs
- Agent events
- Audio state
- Device state
- Conversation events

---

## 13. Storage

Use SQLite initially.

Store at least:

```text
conversations
messages
mcp_servers
config
logs
```

Keep the storage layer behind an interface so that SQLite can later be replaced by another database.

Do not expose SQLite-specific APIs to the Agent Core.

---

## 14. Configuration

Configuration should be centralized.

At minimum support:

```text
AI Provider
LLM Model
STT Provider
TTS Provider

MCP Servers

Audio Input Device
Audio Output Device
```

Configuration may come from:

1. Environment variables
2. Configuration files
3. Database / Web Console

Do not hard-code secrets.

Never log API keys, tokens, or credentials.

---

## 15. Mock Mode

Mock mode is mandatory.

The following mock implementations should exist:

```text
MockAudioInput
MockAudioOutput

MockSTTProvider
MockLLMProvider
MockTTSProvider

MockMCPServer
```

Running:

```bash
pnpm install
pnpm dev
```

on a normal development machine should be enough to launch the system.

No NanoPi, third-party MCP server, physical microphone, or external AI API should be required.

The complete flow must work:

```text
Web Console
    ↓
Agent
    ↓
Mock LLM
    ↓
Mock MCP Tool
    ↓
Mock Tool Result
    ↓
Mock LLM
    ↓
Response
```

---

## 16. NanoPi R2S Deployment

NanoPi R2S is the first deployment target.

Its configuration should live under:

```text
deployments/nanopi-r2s/
```

This may contain:

```text
Dockerfile
docker-compose.yml
install.sh
configuration files
```

R2S-specific logic must remain inside the deployment/platform layer.

The core application should not require changes when moving from R2S to another platform.

---

## 17. Platform Adapter Example

The intended design is:

```text
                    Agent Core
                        │
                        ▼
                AudioInput Interface
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
      Linux Audio   macOS Audio   Browser Audio
        Adapter       Adapter        Adapter
          │
          ▼
       ALSA / etc.
```

Similarly:

```text
DeviceInfo
    │
    ├── LinuxProvider
    ├── MacOSProvider
    ├── WindowsProvider
    └── R2S-specific metrics if needed
```

The Agent Core must not care which implementation is being used.

---

## 18. Non-Goals for MVP

Do NOT implement these yet:

- VAD
- full-duplex barge-in and interruption
- Long-term Memory
- Vector Database
- Complex permission management
- Human approval workflows
- Multi-Agent architecture
- Multi-device management
- WebRTC
- Bluetooth audio
- Local LLM
- Offline AI
- Mobile application
- Cloud deployment

However, the architecture should not prevent these features from being added later.

---

## 19. Development Priorities

Implement in this order:

### Phase 1 — Project Skeleton

- Monorepo
- Backend
- Frontend
- Shared types
- Configuration
- Logging
- Mock providers

### Phase 2 — Agent Core

Implement:

```text
LLM
 ↓
Tool Detection
 ↓
MCP
 ↓
Tool Result
 ↓
LLM
```

with Mock MCP.

### Phase 3 — Web Console

Implement:

- Dashboard
- Chat
- Conversations
- MCP
- Logs

### Phase 4 — Real AI Providers

Add buffered Azure implementations for:

- STT
- LLM
- TTS

without modifying Agent Core.

After buffered-provider acceptance, add capability-gated full-chain streaming:
Streaming STT, Streaming Chat LLM, and Streaming TTS. Streaming support is
independent per pipeline role, must never silently fall back to buffered
execution, and initially targets OpenAI/Azure-compatible Chat SSE plus Alibaba
Cloud Model Studio speech WebSockets.

### Phase 5 — Real MCP

Add generic Streamable HTTP and stdio MCP integrations with explicit server and tool enablement.

### Phase 6 — Linux Audio and Wake Word

Implement USB audio support and local offline wake-word detection through Linux
platform adapters.

### Phase 7 — NanoPi Deployment

Package the application for NanoPi R2S using Docker Compose.

---

## 20. Acceptance Criteria

The MVP is complete when the following works:

```text
                    Web Console
                         │
                         ▼
                    Agent Core
                         │
                ┌────────┴────────┐
                ▼                 ▼
               LLM              MCP
                │                 │
                │       Third-Party Services
                │                 │
                └────────┬────────┘
                         ▼
                        TTS
                         │
                         ▼
                  USB Speakerphone
```

The system must also work in Mock Mode:

```text
Browser
  ↓
Mock Audio
  ↓
Mock STT
  ↓
Mock LLM
  ↓
Mock MCP
  ↓
Mock TTS
  ↓
Browser
```

The same Agent Core must work in both modes.

For providers and models that explicitly support streaming, the Web Console
must also complete a Composed request through Streaming STT, Streaming Chat
LLM, Streaming TTS, or any supported independent combination. In a full-chain
route, assistant text appears incrementally and TTS playback begins before the
LLM finishes its complete response. Unsupported combinations must remain
impossible to activate, and streaming failures must never be presented as
buffered success.

---

## 21. Coding Guidelines

The rules in [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) are mandatory. This section provides only the MVP-specific coding priorities and does not replace those rules.

Prioritize:

- Clear interfaces
- Strong TypeScript types
- Small modules
- Dependency inversion
- Testability
- Platform independence
- Explicit error handling
- Structured logging

Avoid:

- Premature abstraction
- Over-engineering
- Global mutable state
- Vendor-specific logic in Agent Core
- Hardware-specific assumptions
- Hard-coded credentials
- Unnecessary dependencies

When a design decision is unclear, prefer the solution that keeps the core more platform-independent and easier to test.

The project should be designed so that replacing NanoPi R2S with another platform requires implementing or replacing platform adapters, not rewriting the Agent Core.
:::
