# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Homebridge dynamic platform plugin that bridges PetLibro smart feeders and water fountains to Apple HomeKit. Published to npm as `homebridge-petlibro-2`. Single-file implementation in `index.js` (~600 lines, no build step, no transpilation).

The PetLibro API is undocumented; endpoints and request shapes are reverse-engineered from the official Android app and the Home Assistant integration at https://github.com/jjjonesjr33/petlibro. Treat it as unstable — validate responses, never crash Homebridge on API errors.

## Commands

- `npm install` — install `axios` (only runtime dep).
- `npm test` / `npm run lint` — placeholders (no tests, no linter configured). Do not assume CI guards exist.
- Local Homebridge dev install: `npm install -g .` then point Homebridge at the platform `PetLibroPlatform` in `config.json`. There is no watch/build task — edit `index.js` and restart Homebridge.

## Architecture

Three classes in `index.js`, single platform:

- **`PetLibroPlatform`** (registered as `"PetLibroPlatform"` under plugin id `"homebridge-petlibro-2"`) owns all shared state: `accessToken`, `refreshToken`, `tokenExpiry`, plus `baseUrl` (default `https://api.us.petlibro.com`). On `didFinishLaunching` it authenticates, calls `fetchDevicesFromAPI()`, then for each device generates a UUID, reuses any cached accessory matching it, and instantiates either a `PetLibroFeeder` or `PetLibroFountain`. Accessories present in cache but no longer returned by the API are unregistered.
- **`PetLibroFeeder`** wraps a `Service.Switch`. The switch is momentary: `getOn` always returns `false`; `setOn(true)` POSTs `/device/device/manualFeeding` with `grainNum: config.portions` and resets the characteristic to `false` after ~1s.
- **`PetLibroFountain`** wraps a `Service.Battery` (intentionally — HomeKit has no native "water level" characteristic, so water % is exposed as `BatteryLevel` with `StatusLowBattery` tripping under 20%). It polls `/device/device/realInfo` every `fountainPollingInterval` seconds (default 300) and maps `weightPercent` → battery level. The constructor also strips any legacy `HumiditySensor` or `Switch` service from the cached accessory — this is the migration path from earlier plugin versions and from feeders that were re-classified as fountains.

### Device type detection

`getDeviceType(device)` classifies based on `productName`/`deviceSn` containing `PLWF`, `Dockstream`, or `Fountain` (case-insensitive). Everything else becomes a feeder. The UUID seed includes the device type (`'petlibro-' + deviceType + '-' + deviceSn`), so a device flipping classification produces a new accessory rather than reusing the wrong service tree.

### Auth flow

- Password is MD5-hashed before transmission (matches the official app).
- `POST /member/auth/login` with `appId: 1`, `appSn: 'c35772530d1041699c87fe62348507a8'`, `source: 'ANDROID'`, `version: '1.3.45'`. These are required — the API rejects requests with different `appSn` or missing `source`/`version` headers.
- Subsequent requests send **both** `Authorization: Bearer <token>` and a `token: <token>` header. Don't drop one — different endpoints check different headers.
- `ensureAuthenticated()` is the single entry point every device method should call before hitting the API. `refreshAuthToken()` falls back to a full re-login if the refresh endpoint fails.

### PetLibro field-name quirks

Device objects from `/device/device/list` use inconsistent casing across firmware versions. Anywhere you extract identity, defensively read multiple aliases — see existing fallbacks in `index.js`:
- serial: `deviceSn || device_id || deviceId || id || serial`
- name: `deviceName || device_name || name`
- model: `productName || product_name || model`

Preserve this pattern when adding new device features.

### Account constraint

PetLibro only allows one active session per account. If both the mobile app and Homebridge use the same credentials, one will be logged out. The README directs users to create a secondary shared account; surface this clearly in any auth-failure error path.

## Governance

`.specify/memory/constitution.md` is the project's binding rule set (Spec-Kit format). Notable hard rules: HTTP timeouts ≤30s, never log credentials/tokens, semver discipline on every npm publish, and `Switch` for feeders / battery-style indicator for fountains. The `.github/agents/` and `.github/prompts/` directories hold Spec-Kit workflow definitions (`speckit.specify`, `speckit.plan`, `speckit.tasks`, `speckit.implement`, etc.) used for feature work; templates live under `.specify/templates/`.

## Publishing

Plugin is published to npm. Bump `package.json` version per semver before publish: MAJOR for config-schema breaks or dropped device support, MINOR for new device support, PATCH for fixes. `engines` requires Node ≥14.18.1 and Homebridge ≥1.3.0.
