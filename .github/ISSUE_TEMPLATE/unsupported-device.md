---
name: Unsupported / Misdetected Device
about: Report a PetLibro device that this plugin doesn't recognise correctly
title: "[Device] PLAF*** or PLWF*** — <model name>"
labels: device-support
---

## Device details

- **Model number** (e.g. PLAF108, PLWF305, PLLB001):
- **Display name in PetLibro app**:
- **Region** (US / EU / other):
- **Firmware version** (from PetLibro app → device → about):
- **What's wrong?** (not detected at all, wrong type, switch/sensor doesn't work, etc.):

## Captured device payload

Paste the JSON the plugin logged after you enabled the debug dump. Steps:

1. In Homebridge UI X → this plugin → Settings → enable **Debug: Dump Raw Device List**.
2. Restart Homebridge.
3. Open the Homebridge log; search for `[debugDeviceDump]`.
4. Copy the JSON block that follows and paste it below. **Disable the flag afterwards.**

> ⚠️ Before pasting, scrub anything that looks like a personal identifier (your account email, location names, pet names you don't want public). The dump does NOT include your password or auth token, but device names may contain whatever you set in the PetLibro app.

```json
PASTE HERE
```

## Homebridge environment

- Plugin version (e.g. `1.4.1`):
- Homebridge version:
- Node.js version (`node --version`):
- OS:

## Additional context

Anything else? Screenshots of how the device appears (or fails to appear) in Apple Home are useful.
