<!--
SYNC IMPACT REPORT
==================
Version change: N/A → 1.0.0 (Initial ratification)
Modified principles: None (initial version)
Added sections:
  - Core Principles (5 principles)
  - Technology Stack
  - Publishing & Quality Gates
  - Governance
Removed sections: None
Templates requiring updates:
  - plan-template.md: ✅ Compatible (Constitution Check section exists)
  - spec-template.md: ✅ Compatible (Requirements section supports principles)
  - tasks-template.md: ✅ Compatible (Phase structure aligns with principles)
Follow-up TODOs: None
-->

# Homebridge PetLibro 2 Constitution

## Core Principles

### I. Homebridge Specification Compliance

All code MUST adhere to the [Homebridge Plugin Development](https://developers.homebridge.io/) specification:
- Plugin MUST export a valid initializer function accepting `(api: API)` parameter
- Platform plugins MUST implement `DynamicPlatformPlugin` interface correctly
- Accessories MUST use proper HAP (HomeKit Accessory Protocol) service and characteristic types
- Configuration schema MUST be defined in `config.schema.json` for Config UI X compatibility

**Rationale**: Non-compliant plugins will fail to load or cause Homebridge instability, breaking users' smart home setups.

### II. Robust API Integration

External API communication with PetLibro servers MUST be resilient and fail-safe:
- All HTTP requests MUST include proper timeout handling (max 30 seconds)
- Authentication failures MUST be logged clearly without exposing credentials
- Network errors MUST NOT crash Homebridge; graceful degradation is mandatory
- Rate limiting MUST be respected; implement exponential backoff for retries
- API responses MUST be validated before processing

**Rationale**: PetLibro's API is external and may change or become unavailable; the plugin must never destabilize Homebridge.

### III. HomeKit Characteristic Accuracy

HomeKit service and characteristic usage MUST accurately represent device capabilities:
- Feeders MUST use `Switch` service for manual feeding triggers
- Water fountains MUST use appropriate battery/level indicators for water level
- Characteristic values MUST stay within HAP-defined valid ranges
- Accessory names MUST be derived from PetLibro device names for user clarity

**Rationale**: Incorrect characteristic usage causes HomeKit to display confusing or non-functional controls.

### IV. Structured Logging

All significant operations MUST be logged using Homebridge's logging API:
- Use `log.debug()` for routine operations (API calls, device discovery)
- Use `log.info()` for notable events (device added, feeding triggered)
- Use `log.warn()` for recoverable issues (API timeout, retry attempt)
- Use `log.error()` for failures requiring user attention
- NEVER log sensitive data (passwords, tokens, API keys)

**Rationale**: Users troubleshoot via Homebridge logs; structured logging enables effective debugging.

### V. Semantic Versioning

Version numbers MUST follow [Semantic Versioning 2.0.0](https://semver.org/):
- MAJOR: Breaking changes to configuration schema or removed device support
- MINOR: New device support, new features, backward-compatible enhancements
- PATCH: Bug fixes, security updates, documentation improvements

**Rationale**: npm consumers rely on semver for safe dependency updates.

## Technology Stack

- **Runtime**: Node.js (version as specified in `engines` field of package.json)
- **Language**: JavaScript (ES6+)
- **Framework**: Homebridge API v2.x
- **Package Manager**: npm
- **Distribution**: Published to npmjs.com as `homebridge-petlibro-2`
- **Dependencies**: MUST be minimized; prefer standard library when possible

## Publishing & Quality Gates

Before publishing to npm:
- [ ] `package.json` version MUST be incremented per semver rules
- [ ] All exported functions MUST be documented in README
- [ ] Configuration options MUST match `config.schema.json` definitions
- [ ] Plugin MUST load without errors on a clean Homebridge installation
- [ ] Changelog SHOULD be updated for user-facing changes

## Governance

This constitution supersedes informal practices and governs all development decisions:
- All code changes MUST comply with the principles above
- Principle violations require explicit justification in PR description
- Amendments to this constitution require version increment and dated changelog entry
- Complexity additions (new dependencies, architectural changes) MUST be justified against Principle II (resilience) and V (semver impact)

For runtime development guidance, consult the [Homebridge Developer Documentation](https://developers.homebridge.io/).

**Version**: 1.0.0 | **Ratified**: 2026-01-07 | **Last Amended**: 2026-01-07
