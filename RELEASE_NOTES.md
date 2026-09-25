# v2.1.1

A fix for accounts with newer Panasonic appliances. No configuration changes are needed.

## Fixed
- **Settings screen:** *Load devices* failed with "not a valid selector" when the account has a
  device whose id (GWID) isn't a MAC address. Newer models with built-in Wi-Fi use ids containing
  `+`, `/` and `=`. These devices now appear with their status and can be included in or excluded
  from HomeKit like any other.
- **Local control** only matches devices whose id is a MAC address, so such an id can never be
  mistaken for a module found on the network.

**Full changelog:** see [CHANGELOG.md](CHANGELOG.md).
