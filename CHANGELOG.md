# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html), and the format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.0.0] - 2026-07-24

### Added
- **Local (LAN) control.** When a device's Panasonic Wi-Fi module (CZ-T006 / CZ-T007) is
  reachable on the network, status reads and commands now go directly over the LAN using the
  TaiSEIA protocol, falling back to the cloud only when the local path is unavailable. This is
  lower latency and is not subject to the cloud rate limit. Enabled by default; disable with
  `localControl: false`.
  - Automatic discovery via SSDP plus an optional subnet scan (`localScanSubnet`), matched to
    your cloud devices by MAC address, with automatic re-discovery after DHCP address changes.
  - Optional manual `localDevices` overrides (GWID → LAN IP) for blocked SSDP or cross-VLAN setups.
- **Custom settings screen.** The configuration page now lists every device on your account as a
  card showing its type, model and live status. Supported devices have an "In HomeKit" toggle to
  include or exclude them; unsupported devices are marked. Backed by the new `excludedDevices`
  list (default: every supported device is included).
- **Persistent session token.** The login token is saved to disk and reused across Homebridge
  restarts (validated and refreshed when older than three days), so the plugin no longer logs in
  with your email and password on every restart.
- **Accessory information.** The Wi-Fi module model and firmware version (from the device's
  `device.xml`) are shown as Hardware Revision and Firmware Revision in the Home app.

### Changed
- Reachable devices are served over the LAN in preference to the cloud by default. This is a
  behaviour change; set `localControl: false` to keep cloud-only operation.

### Dependencies
- Added `@homebridge/plugin-ui-utils` for the custom settings screen.

[2.0.0]: https://github.com/tasict/homebridge-panasonic-smart-app/releases/tag/v2.0.0
