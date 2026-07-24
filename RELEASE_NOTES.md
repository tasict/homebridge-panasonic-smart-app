# v2.0.0

A major update that adds **local (LAN) control**, a **redesigned settings screen** for choosing
which devices appear in HomeKit, and **persistent login** across restarts.

## Highlights

### Local control over your network
When a device's Panasonic Wi-Fi module (**CZ-T006 / CZ-T007**) is on the same network, the plugin
now talks to it **directly over the LAN** and only falls back to the Panasonic cloud when it has
to. It is faster and avoids the cloud's rate limit. No setup is required — modules are found
automatically and matched to your account by MAC address. Prefer cloud-only operation? Set
`localControl: false`.

### Choose which devices appear in HomeKit
The settings screen has been rebuilt: every device on your account is shown as a card with its
type, model and current status. Flip the **In HomeKit** switch to include or exclude a device;
unsupported devices are clearly marked. Existing setups are unchanged — everything supported stays
included until you decide otherwise.

### Faster, quieter restarts
The login session is now saved and reused across restarts instead of signing in with your email
and password every time.

### More device detail
The Wi-Fi module model and firmware version now appear as Hardware Revision and Firmware Revision
on each accessory.

## Upgrade notes
- **Backward compatible** — no configuration changes are required, and all of your current devices
  remain exposed to HomeKit.
- Local control is **on by default**. To keep everything on the cloud, add `"localControl": false`.
- A new dependency (`@homebridge/plugin-ui-utils`) is installed automatically.

**Full changelog:** see [CHANGELOG.md](CHANGELOG.md).
