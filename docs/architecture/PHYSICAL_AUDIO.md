# Cross-Platform Audio Device Selection

[Documentation Index](../README.md) |
[Implementation Plan](../IMPLEMENTATION_PLAN.md) |
[Voice Pipeline Architecture](./VOICE_PIPELINES.md) |
[Device Status](./DEVICE_STATUS.md)

## 1. Purpose

VoxMesh must provide Teams-style microphone and speaker selection without
assuming Linux, USB, or one deployment topology.

There are two distinct device locations:

1. **Browser devices** are connected to the computer running the Web Console.
2. **Host devices** are connected to the computer running the VoxMesh server.

When the Web Console and server run on different computers, these inventories
are different. The UI must label them explicitly and never apply a browser
selection to server-side capture or playback.

## 2. Supported Device Classes

Discovery includes every endpoint exposed by the operating system or browser,
including:

- built-in microphones and speakers
- USB audio interfaces and speakerphones
- Bluetooth headsets and speakers
- HDMI and DisplayPort audio
- dock and monitor audio
- virtual audio devices
- operating-system default and communications endpoints when the platform
  exposes them

VoxMesh does not filter devices by connection technology or hardware model.
Unsupported formats or unavailable endpoints remain visible with an explicit
status.

## 3. Browser Audio Devices

The browser voice-test surface uses `navigator.mediaDevices.enumerateDevices()`
and `devicechange`.

Behavior:

- request permission before relying on human-readable labels
- list `audioinput` and `audiooutput` independently
- persist browser selections only in browser-local storage
- use the selected input in `getUserMedia`
- use `HTMLMediaElement.setSinkId()` for selected output where supported
- show explicit unsupported behavior when output selection is unavailable
- retain a missing selected ID as unavailable rather than selecting another
  endpoint
- provide Teams-style Test microphone and Test speaker actions

Browser selections affect only browser recording and playback. They do not
configure Wake Word or host-side physical voice.

## 4. VoxMesh Host Audio Devices

Host discovery is behind project-owned platform adapters:

- macOS: CoreAudio
- Windows: Windows Audio Session API / MMDevice
- Linux: PipeWire or PulseAudio when available, with ALSA as the low-level
  compatibility boundary

The shared contract returns:

- stable platform-scoped device ID
- input or output direction
- safe display name
- default/communications role when available
- connection and availability state
- supported or preferred formats
- safe capability metadata

Host selections are persisted in server configuration and affect server-side
capture, playback, physical voice, and Wake Word. They never affect browser
recording.

## 5. Selection UX

Audio Settings contains separate sections:

- **This browser**
  - Microphone
  - Speaker
  - Test microphone
  - Test speaker
- **VoxMesh host**
  - Input device
  - Output device
  - Refresh devices
  - Test input
  - Test output

Each selector includes:

- No device selected
- all currently discovered endpoints
- a retained unavailable option for a missing saved device
- default/communications labels when supplied by the platform
- visible ready, unavailable, disconnected, busy, permission-denied,
  unsupported, and failed states

VoxMesh never silently changes a selection, chooses the first device, or falls
back to Mock Audio.

## 6. Lifecycle

- Device changes apply to the next operation, never an active operation.
- Hot-plug events refresh state without replacing persisted selections.
- Capture and playback release handles after success, failure, cancellation,
  timeout, disconnect, shutdown, or device removal.
- Input tests expose transient loudness and discard samples immediately.
- Output tests play a bundled local sample and do not depend on TTS.
- Platform errors are normalized into stable safe codes before reaching the
  browser.

## 7. Testing and Qualification

Default CI uses deterministic browser and host adapter fakes on macOS, Windows,
and Linux.

Platform qualification covers:

- CoreAudio on supported macOS versions
- Windows Audio endpoints on supported Windows versions
- PipeWire/PulseAudio/ALSA on supported Linux distributions
- built-in, USB, Bluetooth, HDMI/display, dock, and virtual endpoints where
  representative hardware is available
- hot-plug, missing saved devices, default-device changes, busy devices,
  permission denial, format negotiation, cancellation, and cleanup

NanoPi qualification remains Linux-specific, but Phase 6 audio-device support
is cross-platform.

## 8. Planned Pull Requests

### PR A - Audio Device Contracts and Fake Adapters

- define browser/host inventory, endpoint, selection, capability, and status
  schemas
- add deterministic multi-device fixtures covering built-in, USB, Bluetooth,
  display, virtual, default, missing, and failed endpoints
- add authenticated host discovery and selection APIs
- add configuration migration with explicit No device selected defaults

### PR B - Browser Device Selection

- add Teams-style Microphone and Speaker selectors
- handle permission-gated labels and `devicechange`
- persist browser-local IDs
- use the selected microphone for browser capture
- use `setSinkId` when supported and expose explicit unsupported output
  selection otherwise
- add Test microphone and Test speaker

### PR C - Cross-Platform Host Discovery and Settings

- implement CoreAudio, Windows Audio, and Linux discovery adapters
- add VoxMesh-host Input device and Output device selectors
- retain unavailable saved IDs
- add explicit refresh, hot-plug state, safe platform errors, and
  platform-specific permission guidance

### PR D - Host Capture and Playback Lifecycle

- implement selected-device capture and playback
- negotiate and convert formats at adapter boundaries
- add bounded Test input and Test output
- add cancellation, timeout, queues, removal handling, cleanup, and shutdown
- route physical voice and Wake Word only through the selected host input

### PR E - Cross-Platform Qualification

- complete macOS, Windows, and Linux native integration coverage
- validate representative endpoint classes and platform permissions
- complete bilingual, theme, keyboard, narrow-width, 200% zoom, and axe
  coverage
- record NanoPi-specific Linux evidence separately in Phase 9
