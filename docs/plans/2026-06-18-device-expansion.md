# Device Expansion Plan — homebridge-petlibro-2

**Date:** 2026-06-18
**Status:** Draft (research synthesized from a 104-agent deep-research workflow on the jjjonesjr33/petlibro HA integration)
**Source-of-truth references:**
- jjjonesjr33 dev README: <https://github.com/jjjonesjr33/petlibro/blob/dev/README.md>
- HA `api.py` (dev): <https://raw.githubusercontent.com/jjjonesjr33/petlibro/dev/custom_components/petlibro/api.py>
- Prior art (Switch pattern): <https://github.com/praveensharma/HomebridgeLibro>
- Litter-Robot precedent: <https://github.com/ryanleesmith/homebridge-litter-robot-connect>

## 1. Device matrix

The Home Assistant integration supports **11 device families** across feeders, fountains, and litter boxes. The Homebridge plugin currently models only the first two patterns (`Service.Switch` for feeders, `Service.HumiditySensor` for fountains). The detection routing in `getDeviceType` already classifies the unported models correctly by virtue of prefix matching (`PLWF*` → fountain, everything else → feeder), so most rows in the table likely *function* today; what's missing is per-model verification and richer telemetry.

| Model | Display | HA implementation file | Plugin status | HomeKit mapping |
|---|---|---|---|---|
| PLAF103 | Granary v2 | `feeders/granary_smart_feeder.py` | ✅ shipping | Switch (1s momentary) |
| PLAF107 | Space | `feeders/space_smart_feeder.py` | 🟡 untested | Switch (reuse) |
| PLAF108 | Air | `feeders/air_smart_feeder.py` | 🟡 untested | Switch (reuse) |
| PLAF109 | Polar Wet | `feeders/polar_wet_food_feeder.py` | ❌ wrong endpoint | Switch (leaky — plate rotation) |
| PLAF203 | Granary Camera | `feeders/granary_smart_camera_feeder.py` | 🟡 untested | Switch (camera unsupported) |
| PLAF301 | One RFID | `feeders/one_rfid_smart_feeder.py` | 🟡 untested | Switch (reuse) |
| PLWF105 | Dockstream | `fountains/dockstream_smart_fountain.py` | ✅ shipping | HumiditySensor |
| PLWF305 | Dockstream RFID | `fountains/dockstream_smart_rfid_fountain.py` | 🟡 untested | HumiditySensor (reuse) |
| PLWF106 | Dockstream 2 Plug-In | `fountains/dockstream_2_smart_fountain.py` | 🟡 untested | HumiditySensor (reuse) |
| PLWF116 | Dockstream 2 Cordless | `fountains/dockstream_2_smart_cordless_fountain.py` | 🟡 untested | HumiditySensor (+ Battery?) |
| PLLB001 | Luma Litter Box | `litterboxes/luma_smart_litter_box.py` | ❌ defer | Air Purifier + inverted FilterMaintenance |
| PLAF103-DT | Dual-cat hopper | (none — issue #214) | ⛔ out of scope | no upstream code yet |

Status legend: ✅ verified shipping, 🟡 *probably* works via fallthrough but unverified, ❌ requires new code, ⛔ no upstream reference.

## 2. Refuted approaches (do NOT take)

The research adversarially killed four plausible-but-wrong patterns:

- **`OccupancySensor` for litter-box presence** — HomeKit Occupancy semantics target doorway-style sustained presence, not transient pet visits. Refuted 3-0.
- **Standalone `FilterMaintenance` service** — it's a characteristic on `AirPurifier`, not a top-level service. Refuted 3-0.
- **`OccupancySensor` for pet-at-feeder events** — same semantic mismatch as above. Refuted 3-0.
- **Claim that PLLB001 Luma is unimplemented upstream** — false; PR #199 merged 2026-03-13. Refuted 3-0.

## 3. API surface gaps

The HA `api.py` exposes ~80 endpoints; the Homebridge plugin uses 4. High-value gaps with exact line refs in `api.py` on dev branch:

| Endpoint | Used for | api.py:line |
|---|---|---|
| `/device/device/baseInfo` | firmware version, serial number | L435 |
| `/device/data/grainStatus` | hopper-empty alert (feeders) | L449 |
| `/data/data/realInfo` | richer real-time payload | L439 |
| `/data/deviceDrinkWater/todayDrinkData` | per-pet drinking (PLWF305 RFID) | L441 |
| `/device/feedingPlan/todayNew` | scheduled-feed status | L451 |
| `/device/feedingPlan/list` | full schedule | L453 |
| `/device/wetFeedingPlan/wetListV3` | wet-feeder schedule | L548 |
| `/device/wetFeedingPlan/manualFeedNow` | PLAF109 manual dispense | L1197 |
| `/device/wetFeedingPlan/platePositionChange` | PLAF109 rotate to plate | L1227 |
| `/device/device/execCmdService` | Luma command verbs (CLEAN/EMPTY/STOP/OPEN_DOOR/CLOSE_DOOR/VACUUM) | L738 |
| `/device/ota/getUpgrade` | firmware update available | L447 |
| `/data/event/deviceEventsV2` | event log | L445 |

## 4. Porting waves

### Wave A — Verification (no code, just user reports) — **start here**

Most untested models likely work via existing routing. The risk is unknown `productName`/`deviceSn` strings. Action:
- Add an opt-in debug log that dumps the raw `/device/device/list` response when `config.debugDeviceDump = true`.
- Cut a v1.4.1 release inviting owners of PLAF107/108/203/301/PLWF305/106/116 to enable it and paste output in a GitHub issue.
- Use the captured payloads to write exact-match `getDeviceType` cases + tests.

### Wave B — Tighten detection (low risk)

After Wave A returns data:
- Replace open-ended PLWF/keyword matching with an explicit `KNOWN_DEVICES` table mapping product codes to `{type, displayName}`.
- Fall back to current heuristic for unknown SKUs.
- Tests in `test/device-type.test.js`: one assertion per known SKU; one assertion for unknown SKU falling back to feeder.

### Wave C — PLAF109 Polar Wet (medium effort)

- Subclass `PetLibroFeeder` → `PetLibroWetFeeder`. Override `triggerFeeding` to POST `/device/wetFeedingPlan/manualFeedNow` with `{deviceSn, plate: config.wetPlate || 1}`.
- New config field: `wetPlate` (integer 1-N, default 1).
- `getDeviceType` returns new `DEVICE_TYPE.WET_FEEDER` for PLAF109.
- Cached-accessory migration: PLAF109 UUID was previously seeded with `feeder` → new seed `wet_feeder` produces a fresh accessory; HomeKit room reassignment one-time cost.
- Tests:
  - `test/device-type.test.js`: PLAF109 → WET_FEEDER
  - `test/wet-feeder.test.js`: mock `axios.post`; assert URL `/device/wetFeedingPlan/manualFeedNow`, body `{deviceSn, plate}`; assert switch resets after 1s.

### Wave D — Hopper-empty sensor (medium effort, optional)

Use `/device/data/grainStatus` to back a `Service.OccupancySensor` (semantically OK here — "food present" / "hopper empty" is sustained state, not transient). Poll every 5 min. Per-feeder accessory adds the service alongside the existing Switch.

### Wave E — PLLB001 Luma Litter Box (high effort, defer)

- New `DEVICE_TYPE.LITTER_BOX` constant, `getDeviceType` PLLB prefix match.
- Class `PetLibroLitterBox`:
  - `Service.AirPurifier` (Active/CurrentAirPurifierState/TargetAirPurifierState/RotationSpeed?)
  - `Characteristic.FilterLifeLevel` on `Service.FilterMaintenance` linked to AirPurifier: `100 - wastePercent`.
  - `Characteristic.FilterChangeIndication` triggered when waste >= 80%.
  - Action Switches (Switch services as buttons): "Clean now", "Empty waste", "Stop". Each posts `/device/device/execCmdService` with action verb.
- Polling 5 min for waste level.
- Tests:
  - `test/device-type.test.js`: PLLB001 → LITTER_BOX
  - `test/litter-box.test.js`: per-command axios stubs (CLEAN/EMPTY/STOP); inverted filter math.

### Wave F — PLAF103-DT Dual Cat (out of scope)

Skip until upstream lands code. Track issue #214.

## 5. Open questions blocking decisive design

1. Real `productIdentifier` strings per model — unverified. Required input for Wave B.
2. PLWF116 cordless battery field — unknown. May warrant `Service.Battery` alongside HumiditySensor.
3. PLAF109 Switch semantics — does upstream tap `manualFeedNow` (dispense current plate) or `platePositionChange` (rotate)? Read `polar_wet_food_feeder.py` before Wave C.
4. Cached-accessory migration on detection-table changes — accept one-bridge-restart cost or force re-detection on version bump?

## 6. Testing approach (binding for every wave)

- Stack: `node:test` + `t.mock.method(axios, 'post', ...)`. No new dev deps.
- New test files under `test/`, suffix `.test.js`.
- Per-model unit tests assert: (a) `getDeviceType` returns correct enum, (b) accessory class produces expected HAP services, (c) API endpoint + body + headers match expected shape on action.
- Mock pattern: queue-of-responses keyed by URL path; assert call sequence + token rotation where relevant.

## 7. Version cadence

- v1.4.1: debug-dump opt-in for `/device/device/list`. PATCH (no behavior change for existing users).
- v1.5.0: explicit `KNOWN_DEVICES` detection table (Wave B). MINOR.
- v1.6.0: PLAF109 Polar Wet (Wave C). MINOR.
- v1.7.0: hopper-empty OccupancySensor (Wave D). MINOR.
- v2.0.0: PLLB001 Luma litter box (Wave E). MAJOR — adds new device-type enum and may force cache invalidation for users with edge-case prior classifications.
