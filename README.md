# Homebridge PetLibro 2

[![npm version](https://badge.fury.io/js/homebridge-petlibro-2.svg)](https://badge.fury.io/js/homebridge-petlibro-2)
[![npm downloads](https://img.shields.io/npm/dt/homebridge-petlibro-2.svg)](https://www.npmjs.com/package/homebridge-petlibro-2)

A Homebridge plugin that integrates PetLibro smart feeders and water fountains with Apple HomeKit, allowing you to trigger manual feeding sessions and monitor water levels directly from your iOS Home app. This is a fork from the original `homebridge-petlibro` plugin, updated to support multiple PetLibro devices.

Original repository: [HomebridgeLibro](https://github.com/praveensharma/HomebridgeLibro)

## Features

- 🍽️ **Manual Feeding**: Trigger feeding sessions from your Home app
- 📱 **HomeKit Integration**: Works seamlessly with Apple's Home ecosystem
- 🔄 **Momentary Switch**: Switch automatically resets after feeding
- 🛡️ **Robust Error Handling**: Graceful failures that won't break Homebridge
- 🔐 **Secure Authentication**: Uses the same API as the official PetLibro app
- 🐾 **Multi-Device Support**: Automatically discovers and adds all feeders and fountains linked to your account
- 💧 **Water Fountain Support**: View water level of compatible water fountains in HomeKit

## Supported Devices

This plugin works with PetLibro devices that use the main PetLibro app (not PetLibro Lite):

### Smart Feeders
- Granary Smart Feeder (PLAF103)
- Space Smart Feeder (PLAF107) 
- Air Smart Feeder (PLAF108)
- Polar Wet Food Feeder (PLAF109)
- Granary Smart Camera Feeder (PLAF203)
- One RFID Smart Feeder (PLAF301)

### Water Fountains
- Dockstream Smart Fountain (PLWF105)
- Dockstream RFID Smart Fountain (PLWF305)
- Dockstream 2 Smart Fountain - Plug-In Model (PLWF106)
- Dockstream 2 Smart Fountain - Cordless Model (PLWF116)

## Installation

### Option 1: Homebridge Config UI X (Recommended)

1. Search for "PetLibro" in the Homebridge Config UI X plugin store
2. Install the plugin
3. Configure using the web interface

### Option 2: Command Line

```bash
npm install -g homebridge-petlibro-2
```

## Configuration

### Using Homebridge Config UI X

After installation, configure the plugin through the Homebridge web interface. You'll need:

- Your PetLibro account email
- Your PetLibro account password
- Number of portions to dispense (optional, defaults to 1)

### Manual Configuration

Add the following to your Homebridge `config.json` in the `platforms` section:

```json
{
  "platforms": [
    {
      "platform": "PetLibroPlatform",
      "email": "your-petlibro-email@example.com",
      "password": "your-petlibro-password",
      "portions": 1,
      "timezone": "America/New_York",
      "country": "US"
    }
  ]
}
```

### Configuration Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `platform` | Yes | | Must be `"PetLibroPlatform"` |
| `email` | Yes | | Your PetLibro account email |
| `password` | Yes | | Your PetLibro account password |
| `portions` | No | `1` | Number of portions per feeding (1-10) |
| `timezone` | No | `"America/New_York"` | Your timezone |
| `country` | No | `"US"` | Your country code |
| `fountainPollingInterval` | No | `300` | Seconds between water level updates for fountains |

## Multi-Device Support

The plugin automatically discovers all PetLibro devices linked to your account:

- **Feeders** appear as switches in HomeKit - tap to trigger manual feeding
- **Water Fountains** appear as humidity sensors showing water level percentage
- Devices use their names from the PetLibro app
- New devices are added automatically on Homebridge restart
- Removed devices are automatically cleaned up

### Water Fountain Notes

Apple Home has no native "fill level" characteristic. Water fountains are exposed as a **HumiditySensor**, which is the only sensor service Apple Home renders as a visible tile with a live percentage value.

- The percentage shown represents how full the water reservoir is (0-100%)
- Apple Home labels the tile as "Humidity" — the value displayed *is* the water level, regardless of label
- Third-party HomeKit apps (Eve, Controller for HomeKit) show the same value and can graph history
- Water level is updated periodically (default: every 5 minutes)
- You can adjust the polling interval with the `fountainPollingInterval` option

> Migrating from earlier plugin versions that used a Battery service? Restart Homebridge once — the plugin strips the old Battery service from cached accessories and replaces it with a HumiditySensor automatically.

## Important Setup Notes

### Account Limitations

⚠️ **PetLibro only allows one device to be logged into an account at a time.**

**Recommended Setup:**
1. Create a second PetLibro account with a different email
2. In your main PetLibro app, share your feeder to the new account
3. Use the new account credentials in this Homebridge plugin

This allows both your mobile app and Homebridge to work simultaneously.

### Verification Steps

Before configuring the plugin:
1. ✅ Verify your credentials work in the official PetLibro mobile app
2. ✅ Ensure you're using the main "PetLibro" app (not "PetLibro Lite")
3. ✅ Confirm your feeder is connected to WiFi and working normally

## Usage

1. After configuration, your feeder will appear as a switch in the Home app
2. Tap the switch to trigger a manual feeding
3. The switch automatically turns off after 1 second (momentary behavior)
4. Check Homebridge logs to confirm feeding was successful

## Troubleshooting

### Authentication Issues

**Problem**: Plugin fails to authenticate
- ✅ Verify email/password work in the PetLibro mobile app
- ✅ Ensure only one device is logged into your PetLibro account
- ✅ Try creating a dedicated account for Homebridge (recommended)

### Device Not Found

**Problem**: Plugin authenticates but can't find your feeder
- ✅ Confirm your feeder appears in the PetLibro mobile app
- ✅ Check that device sharing is set up correctly (if using separate account)
- ✅ Look at Homebridge logs for device discovery details

### Feeding Not Working

**Problem**: Switch appears but feeding doesn't work
- ✅ Ensure feeder has food and is powered on
- ✅ Verify feeder connectivity in the PetLibro app
- ✅ Check Homebridge logs for API error messages
- ✅ Try manual feeding through the official app first

### Common Error Messages

**"Invalid account or password"**
- Check credentials are correct
- Ensure no other device is logged into the account

**"Device ID not found"**
- Verify device sharing is configured properly
- Check that the feeder appears in your account

**"Authentication failed: SYSTEM_ERROR"**
- Usually indicates incorrect API credentials
- Verify you're using the main PetLibro app (not Lite)

## Technical Details

This plugin uses the same API endpoints as the official PetLibro mobile application, reverse-engineered from the open-source [HomeAssistant PetLibro integration](https://github.com/jjjonesjr33/petlibro).

### API Endpoints Used
- Authentication: `POST /member/auth/login`
- Device Discovery: `POST /device/device/list`  
- Manual Feeding: `POST /device/device/manualFeeding`
- Device Real Info: `POST /device/device/realInfo` (for water level)

## Testing

Tests use Node's built-in `node:test` runner — no extra dependencies. **Requires Node.js 18 or newer.**

```bash
npm install
npm test
```

### What's covered

- **`test/device-type.test.js`** — `getDeviceType()` classification: `PLWF*` serials and product names containing *Dockstream*/*Fountain* (case-insensitive) classify as fountains; everything else defaults to feeder. Includes coverage for alias field names (`product_name`, `model`, `device_id`, `deviceId`) returned by different firmware versions.
- **`test/region.test.js`** — `resolveBaseUrl()` precedence: `apiEndpoint` override > `region` > country-to-region mapping > US default. Verifies EU country codes (DE, FR, GB, …) route to the EU endpoint and unknown codes fall back to US.
- **`test/auth.test.js`** — `hashPassword()` produces RFC 1321 MD5; `apiPost()` retries once on PetLibro error code `1009` (NOT_YET_LOGIN) after re-authenticating; it sends only the `token` header (no `Authorization: Bearer`); `authenticate()` rejects when credentials are missing.

### Running a single test file

```bash
node --test test/device-type.test.js
```

### Filtering tests by name

```bash
node --test --test-name-pattern='1009' 'test/**/*.test.js'
```

### Adding tests

Test files live in `test/`, suffix `.test.js`. Internals not exported from `index.js` (`getDeviceType`, `resolveBaseUrl`, the classes) are reachable via `require('..')._test` — keep production consumers on the default Homebridge initializer.

## Contributing

Found a bug or want to contribute? 

1. Check existing [issues](https://github.com/TechPreacher/HomebridgeLibro2/issues)
2. Create a detailed bug report with:
   - Homebridge logs
   - Device model
   - Configuration (without credentials)
3. Test that your feeder works with the official PetLibro app

## Legal Disclaimer

⚠️ **This is an unofficial plugin, not affiliated with PetLibro.**

- Use at your own risk
- API endpoints may change without notice
- Check PetLibro's Terms of Service before use
- The plugin is reverse-engineered from publicly available information

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- Based on the [HomeAssistant PetLibro integration](https://github.com/jjjonesjr33/petlibro) by jjjonesjr33
- Built for the [Homebridge](https://homebridge.io/) platform

---

**Enjoying this plugin?** ⭐ Star the repository
