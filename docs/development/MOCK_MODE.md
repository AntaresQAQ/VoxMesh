# Mock Mode Development Guide

[Documentation Index](../README.md)

## 1. Purpose

Mock Mode provides a deterministic, offline environment for developing and testing the complete VoxMesh application without:

- Azure credentials
- external MCP servers
- physical microphones or speakers
- NanoPi hardware
- network access

Mock Mode is for development and validation. It is not a substitute for real provider or hardware qualification.

## 2. Current Mock Pipeline

### Text

```text
Web Chat
  -> Mock LLM
  -> optional Mock MCP tool
  -> Mock LLM final response
  -> SQLite conversation and pipeline events
```

### Voice

```text
Browser MediaRecorder
  -> POST /api/voice
  -> Mock STT
  -> Agent Core
  -> Mock MCP
  -> Mock LLM
  -> Mock TTS WAV
  -> browser playback
```

The voice flow uses the same Agent Core and conversation persistence as text Chat.

## 3. Mock Speech Behavior

`MockSpeechToTextProvider` validates that the submitted audio:

- is not empty
- is no larger than 5 MB

It then returns the deterministic transcript:

```text
Check the light status
```

This transcript intentionally exercises the Mock MCP tool path.

`MockTextToSpeechProvider` produces a short valid mono, 16 kHz, 16-bit PCM WAV tone. The tone verifies:

- binary response handling
- audio metadata
- browser playback controls
- storage and pipeline sequencing

The WAV does not contain spoken language.

## 4. Voice API

### Request

```http
POST /api/voice
Content-Type: audio/webm
Cookie: voxmesh_session=...

<binary audio body>
```

Accepted content types:

- `audio/*`
- `application/octet-stream`

Maximum request size:

```text
5 MB
```

### Response

```json
{
  "conversationId": "uuid",
  "transcript": "Check the light status",
  "response": "Mock tool reports living-room-light is on.",
  "usedTools": ["mock.get_device_status"],
  "audio": {
    "base64": "UklGR...",
    "mimeType": "audio/wav",
    "sampleRate": 16000,
    "channels": 1
  }
}
```

The API key and other provider secrets are never involved in Mock Voice requests.

## 5. Conversation Pipeline Events

Voice conversations persist ordered pipeline events:

- STT completed or failed
- Agent started and completed
- MCP tool call
- TTS completed or failed

Conversation detail displays these events separately from user, tool, and assistant messages.

## 6. Browser Requirements

The browser voice controls require:

- `navigator.mediaDevices.getUserMedia`
- `MediaRecorder`
- permission to access a microphone
- audio playback support

Unsupported browsers and permission failures are shown as accessible errors.

## 7. Testing

### Unit

- Mock STT validation and deterministic transcript
- Mock TTS WAV structure
- browser voice controls with injected recorder and playback adapters
- pipeline timeline rendering

### Integration

- binary audio parser
- authenticated `POST /api/voice`
- complete STT -> Agent -> MCP -> TTS response
- persisted pipeline events

### End-to-end

Playwright injects deterministic fake `getUserMedia` and `MediaRecorder` implementations. The browser test verifies:

- start recording
- stop recording
- Mock Voice request
- transcript and assistant response
- enabled playback control
- conversation pipeline display
- accessibility axe scans
- authenticated live log delivery without refresh
- URL-backed log category and severity filters
- event-stream replay connection status

## 8. Extending Mock Mode

New failure scenarios should remain deterministic and configurable. Useful future scenarios include:

- microphone permission denied
- empty recording
- audio size limit exceeded
- STT timeout or failure
- LLM failure
- MCP failure
- TTS failure
- playback failure

Real Azure Speech adapters must implement the same speech interfaces without adding Azure-specific logic to Agent Core.
