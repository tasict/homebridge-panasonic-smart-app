# Changelog

All notable changes to this project are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html), and the format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [2.1.0] - 2026-09-25

### Added
- **Heat exchangers (全熱交換器, ERV)**, e.g. the FY-ZY series, as a fan: power and fan speed
  (Auto/Manual on models with an automatic speed), a switch for each ventilation mode, and indoor
  and outdoor temperature sensors on models that report them.
- **Smart switches (智慧開關)**, e.g. F540107 / F540207 / F540307: one switch per circuit, which the
  Home app can show as a light or a fan. Circuits are switched through the cloud.
- **Washing machines and dryers**, as notifications only: a *Done* contact sensor that opens when a
  cycle finishes (turn on its notifications in the Home app) and a *Running* occupancy sensor. The
  plugin never controls them, since Panasonic requires Wi-Fi control to be enabled on the machine.
  Models that don't report a finished cycle are skipped.
- Air purifier: the Home app's Auto / Manual now switches the purifier's automatic fan speed.

### Fixed
- Air purifiers that describe their features as 0x01 風量, 0x07 nanoeX and 0x50 PM2.5 (the current
  Taiwanese models) showed the off timer as PM2.5 and couldn't set the fan speed or nanoe. The codes
  are now read from each model's command list; models without one keep the previous codes.
- Dehumidifier fan speed was reversed on most models: they number their speeds 1 quiet to 3 fast,
  the plugin assumed the opposite. Speeds are now ordered by their names in the model's command
  list, and the speed slider snaps to the speed actually set.
- A module that answers on the LAN but reports none of the requested values no longer leaves the
  accessory without a status; that read falls back to the cloud.

## [2.0.1] - 2026-09-25

### Added
- **Project website** in English, Traditional Chinese and Japanese:
  [tasict.github.io/homebridge-panasonic-smart-app](https://tasict.github.io/homebridge-panasonic-smart-app/).
  It is now the plugin's homepage in the Homebridge UI.
- You can now support the plugin by buying me a boba (paid by card, no PayPal account needed) as
  well as with PayPal: from the bottom of the plugin settings, the donate link in the Homebridge UI,
  the README or GitHub's Sponsor button.

### Fixed
- Settings screen: the **In HomeKit** switch and the *Not supported* badge now render correctly on
  current Homebridge UI versions, device icons are drawn inline instead of relying on an icon
  font, long device names no longer squeeze the card, and secondary text stays readable in dark
  mode.

### Changed
- The npm package now contains only what the plugin needs to run. Earlier versions also shipped the
  TypeScript sources, development notes and a sample API response.
- README: new *What you get in HomeKit* and *Support* sections, and a clearer explanation of why a
  second Smart App account is recommended.

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

[2.1.0]: https://github.com/tasict/homebridge-panasonic-smart-app/releases/tag/v2.1.0
[2.0.1]: https://github.com/tasict/homebridge-panasonic-smart-app/releases/tag/v2.0.1
[2.0.0]: https://github.com/tasict/homebridge-panasonic-smart-app/releases/tag/v2.0.0
