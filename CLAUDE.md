# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Independent Homebridge dynamic-platform plugin that bridges PetLibro smart feeders and water fountains to Apple HomeKit. Published to npm as `homebridge-petlibro-2`. Single-file implementation in `index.js` (~750 lines, no build step, no transpilation).

### Repository independence

This is **not a maintained fork**. The upstream `praveensharma/HomebridgeLibro` (npm: `homebridge-petlibro`) is abandoned — no commits in over a year, open issues unanswered, no fountain support, no test suite, no offline detection, no token persistence. The `-2` suffix in `homebridge-petlibro-2` reflects that independence: this is a separate npm package with its own release cadence, its own architecture decisions, and its own maintenance lifecycle. References to praveensharma should be treated as historical credit (in the README acknowledgments), not as an active upstream relationship.

When evaluating decisions:
- **Do NOT** assume parity with `homebridge-petlibro` (it's frozen at an older API shape that no longer matches PetLibro's current endpoints).
- **DO** treat `jjjonesjr33/petlibro` (the Home Assistant integration) as the practical reference for the PetLibro cloud API — it's actively maintained, the API endpoints have been verified there as recently as 2026, and `docs/plans/2026-06-18-device-expansion.md` catalogs what we've inherited vs. what's still portable.

### API stability

The PetLibro API is undocumented; endpoints and request shapes are reverse-engineered from the official Android app and the HA integration. Treat it as unstable — validate responses, never crash Homebridge on API errors, prefer defensive field-alias fallbacks over assumed shapes.

## Commands

- `npm install` — install `axios` (only runtime dep).
- `npm test` — run unit tests via Node's built-in `node:test` runner. **Requires Node ≥18** (the published plugin still runs on Node ≥14.18.1 per `engines`; only the test runner needs 18). Test files live in `test/*.test.js` and reach private helpers via the `_test` export at the bottom of `index.js`.
- Single file: `node --test test/device-type.test.js`. Filter by name: `node --test --test-name-pattern='1009' test/*.test.js`. The unquoted glob lets the shell expand the file list, which works on Node 18 onward; quoted globs (`'test/**/*.test.js'`) require Node 22+ for native glob support and were the cause of an early CI failure.
- `npm run lint` — placeholder; no linter wired up.
- Local Homebridge dev install: `npm install -g .` then point Homebridge at the platform `PetLibroPlatform` in `config.json`. There is no watch/build task — edit `index.js` and restart Homebridge.

## Architecture

Three classes in `index.js`, single platform:

- **`PetLibroPlatform`** (registered as `"PetLibroPlatform"` under plugin id `"homebridge-petlibro-2"`) owns all shared state: `accessToken`, `tokenExpiry`, `tokenFilePath`, plus `baseUrl` (resolved per-region — see below). On construction it attempts to load a persisted token from disk. On `didFinishLaunching` it authenticates if needed, calls `fetchDevicesFromAPI()`, then for each device generates a UUID, reuses any cached accessory matching it, and instantiates either a `PetLibroFeeder` or `PetLibroFountain`. Accessories present in cache but no longer returned by the API are unregistered.
- **`PetLibroFeeder`** wraps a `Service.Switch`. The switch is momentary: `getOn` always returns `false`; `setOn(true)` POSTs `/device/device/manualFeeding` with `grainNum: config.portions` and resets the characteristic to `false` after ~1s. If `device.online === false` it throws `HapStatusError(SERVICE_COMMUNICATION_FAILURE)` so Apple Home shows "Not Responding" instead of silently failing.
- **`PetLibroFountain`** wraps a `Service.HumiditySensor` — water level is surfaced as `CurrentRelativeHumidity` (0–100%). HomeKit has no native fill-level characteristic, and sensor services are the only HomeKit primitive that renders as a visible tile in Apple Home; humidity is mislabeled but the value displayed *is* the water level. Polls `/device/device/realInfo` every `fountainPollingInterval` seconds (default 300) and maps `weightPercent` → humidity. Also tracks `realInfo.online` and throws `HapStatusError(SERVICE_COMMUNICATION_FAILURE)` from `getWaterLevel` when offline. The constructor strips any legacy `Service.Battery` (migration from earlier versions) or `Service.Switch` (feeder→fountain type-swap) from the cached accessory.

### Single-entry API client

Every authenticated PetLibro API call goes through `platform.apiPost(path, body, opts)`:

- Calls `ensureAuthenticated()` first (which re-auths if no cached token or token expired).
- Sends only the `token` header (not `Authorization: Bearer` — the upstream HA integration validates only `token`, and the Bearer was dead weight).
- On response `code === 1009` (NOT_YET_LOGIN — server-side token invalidation, e.g. another login on the same account), re-authenticates and retries the call once with the rotated token.
- Returns the axios response unchanged for the caller to inspect.

### Token persistence

After every successful `authenticate()`, the token + expiry are written to `<api.user.storagePath()>/petlibro-token-<sha256(email):16>.json` with file mode `0600`. On platform construction the file is loaded if present and the token has at least 60s of headroom; otherwise it's ignored and the next API call triggers a fresh login.

Rationale: PetLibro enforces one active session per account. Every fresh login kicks the mobile app out. Persisting the token across Homebridge restarts dramatically reduces login traffic and keeps the user's phone app logged in.

- Per-email hashing supports multi-account installs and avoids exposing the email in the filesystem path.
- Missing storagePath, missing file, corrupt JSON, and expired/near-expired tokens all fall through silently to a fresh login.
- The token file is the only thing the plugin writes outside Homebridge's normal cache.

### Device type detection

`getDeviceType(device)` classifies based on `productName`/`deviceSn` containing `PLWF`, `Dockstream`, or `Fountain` (case-insensitive). Everything else becomes a feeder. The UUID seed includes the device type (`'petlibro-' + deviceType + '-' + deviceSn`), so a device flipping classification produces a new accessory rather than reusing the wrong service tree.

### Endpoint resolution

`resolveBaseUrl(config)` returns `config.apiEndpoint` if set, otherwise `https://api.us.petlibro.com`.

**Historical note — do not re-add EU routing without verification.** v1.5.0 shipped a speculative `api.eu.petlibro.com` URL plus a `COUNTRY_TO_REGION` map that auto-routed EU country codes to it. The EU endpoint does not actually exist (NXDOMAIN), so every user with `country: DE`/`FR`/`GB`/`CH`/etc. hit `getaddrinfo ENOTFOUND` on startup. v1.5.1 reverted to single-endpoint. The PetLibro mobile app uses the US endpoint globally regardless of the user's country, so there is no actual EU API to route to. If PetLibro ever publishes a real EU host, verify it resolves (`host api.eu.petlibro.com`) before adding it to `API_REGIONS`, and add an integration test that catches NXDOMAIN at build time.

### Auth flow

- Password is MD5-hashed before transmission (matches the official app).
- `POST /member/auth/login` with `appId: 1`, `appSn: 'c35772530d1041699c87fe62348507a8'`, `source: 'ANDROID'`, `version: '1.3.45'`. These are required — the API rejects requests with different `appSn` or missing `source`/`version` headers.
- `ensureAuthenticated()` is the single entry point every device method should call before hitting the API; in practice everything goes through `apiPost` which calls it. There is no `/member/auth/refresh` — that endpoint was unverified and removed in 1.4.0; we always re-authenticate via `/member/auth/login`.
- `requestId` uses `crypto.randomUUID()` (RFC 4122 v4).

### PetLibro field-name quirks

Device objects from `/device/device/list` use inconsistent casing across firmware versions. Anywhere you extract identity, defensively read multiple aliases — see existing fallbacks in `index.js`:
- serial: `deviceSn || device_id || deviceId || id || serial`
- name: `deviceName || device_name || name`
- model: `productName || product_name || model`

Preserve this pattern when adding new device features.

### Account constraint

PetLibro only allows one active session per account. If both the mobile app and Homebridge use the same credentials, one will be logged out. The README directs users to create a secondary shared account. Token persistence (above) is the second line of defense — it keeps Homebridge from re-logging in on every restart.

### Diagnostic dump (`debugDeviceDump`)

When `config.debugDeviceDump === true`, `fetchDevicesFromAPI` logs the raw `/device/device/list` JSON at info level after a successful fetch. Used to gather real device payloads from users with unsupported PetLibro models (see the GitHub `unsupported-device` issue template and `docs/plans/2026-06-18-device-expansion.md`). The dump contains device metadata only — no credentials, no tokens; a test asserts the password never appears in any log channel.

## Governance

`.specify/memory/constitution.md` is the project's binding rule set (Spec-Kit format). Notable hard rules: HTTP timeouts ≤30s, never log credentials/tokens, semver discipline on every npm publish, and `Switch` for feeders / sensor-style indicator for fountains. The `.github/agents/` and `.github/prompts/` directories hold Spec-Kit workflow definitions (`speckit.specify`, `speckit.plan`, `speckit.tasks`, `speckit.implement`, etc.) used for feature work; templates live under `.specify/templates/`.

The `docs/plans/` directory holds living planning documents — start with `2026-06-18-device-expansion.md` for the porting roadmap of the remaining PetLibro device families upstream supports.

## Publishing

Plugin is published to npm as `homebridge-petlibro-2`. Bump `package.json` version per semver before publish: MAJOR for config-schema breaks or dropped device support, MINOR for new device support / observable platform behavior changes, PATCH for fixes. `engines` requires Node ≥14.18.1 and Homebridge ≥1.3.0.

After `npm publish`:
- `git tag vX.Y.Z -m "..." && git push origin vX.Y.Z`
- `gh release create vX.Y.Z` with structured notes (use the v1.5.0 release for shape reference). Note: ranges like `git log v1.3.0..vX` work — v1.3.0 is tagged at the first fork commit, even though that npm version was published by the abandoned upstream.
