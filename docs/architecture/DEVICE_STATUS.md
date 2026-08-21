# Device and Physical Audio Status

[Documentation Index](../README.md)

## 1. Purpose

The Web Console must describe host, system telemetry, and physical audio
availability without assuming Linux, ALSA, a temperature sensor, or attached
USB hardware. Device status is therefore a platform-adapter contract rather
than operating-system logic in the server or Web Console.

This phase establishes the contract and honest unavailable behavior. It does
not enumerate, select, capture from, or play to physical audio devices.

## 2. Status Model

Every resource and metric uses one of these explicit states:

- `ready`: the latest observation is usable
- `unavailable`: no adapter, device, or metric exists
- `stale`: a previous observation exists but is no longer fresh
- `degraded`: the resource works with a known limitation
- `failed`: observation or operation failed

Resources expose a safe display name, stable detail code, and observation
timestamp. Metrics additionally expose a nullable numeric value and fixed unit:
`percent`, `bytes`, or `celsius`.

Unavailable values remain `null`; the API never substitutes zero because zero
would be a valid measurement.

Schemas are discriminated by status. `ready`, `stale`, and `degraded` metrics
require a numeric value and observation time. `unavailable` requires null value
and time. CPU, memory, and temperature use fixed per-field units.

## 3. Adapter Boundary

`DeviceStatusProvider` is the project-owned server interface:

```ts
interface DeviceStatusProvider {
  getStatus(): Promise<DeviceStatus>;
}
```

The default `UnavailableDeviceStatusProvider` reports explicit unavailability
for:

- physical device identity
- physical audio input
- physical audio output
- CPU usage
- memory usage
- temperature

Tests inject deterministic providers covering every state. Future Linux and
ALSA implementations must remain behind this interface and must not introduce
operating-system dependencies into Agent Core, shared contracts, or Web
components.

## 4. API

```text
GET /api/device
```

The endpoint requires the administrator session and returns `DeviceStatus`.
It contains no device payloads, audio data, machine paths, serial numbers,
credentials, or provider secrets.

Adapter failures remain request failures and are rendered as an alert. They
are not converted into a successful unavailable response. Expected absence is
reported by the provider as `unavailable`.

## 5. Dashboard Behavior

The Dashboard loads and renders device status independently from its existing
runtime and routing summary. Failure of either request does not hide successful
data from the other. Device status refreshes every 15 seconds while the
Dashboard remains active; TanStack Query shares the query key to avoid
duplicate polling requests.

The Web Console localizes stable detail codes rather than rendering adapter
messages directly. Each card renders:

- resource or metric label
- safe display value, or None
- explicit availability state
- safe detail when present
- observation time, or No observation available

The state is conveyed by text in addition to color. English and Simplified
Chinese, Light and Dark themes, keyboard navigation, responsive layouts, and
representative axe scans remain required.

## 6. Extension Path

Later physical-audio work may add:

- safe input and output discovery identifiers
- selected input and output settings
- Linux/ALSA availability and failure adapters
- hot-plug and stale-observation handling
- capture/playback health

Those additions must preserve the current state vocabulary and must not expose
machine-specific paths or raw hardware errors directly to the browser.
