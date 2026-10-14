# v2.1.2

A reliability fix. No configuration changes are needed.

## Fixed
- **Devices that couldn't be controlled after a restart:** when Homebridge started while the
  Panasonic cloud briefly failed to return the device list, devices still appeared in the Home app
  but didn't respond until Homebridge was restarted again. The plugin now retries every minute and
  brings them back as soon as the list loads. Thanks to @tiger93064 for reporting it (#2).

**Full changelog:** see [CHANGELOG.md](CHANGELOG.md).
