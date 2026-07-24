<p align="center">
  <img src="branding/icon.png" alt="Homebridge Panasonic Smart App Platform icon" width="100">
</p>

<h1 align="center">Homebridge Panasonic Smart App Platform</h1>

<p align="center">
  <a href="https://github.com/homebridge/plugins"><img src="https://badgen.net/badge/homebridge/verified/purple" alt="verified-by-homebridge"></a>
  <a href="https://github.com/tasict/homebridge-panasonic-smart-app"><img src="https://img.shields.io/github/package-json/v/tasict/homebridge-panasonic-smart-app?label=GitHub" alt="GitHub version"></a>
  <a href="https://www.npmjs.com/package/homebridge-panasonic-smart-app"><img src="https://img.shields.io/npm/v/homebridge-panasonic-smart-app?color=%23cb3837&label=npm" alt="npm version"></a>
</p>

`homebridge-panasonic-smart-app` is a dynamic platform plugin for [Homebridge](https://homebridge.io) that provides HomeKit support for devices registered in the Panasonic (Taiwan) Smart App, including air conditioners, dehumidifiers, and air purifiers.

## How it works
The plugin discovers your devices through the Panasonic (Taiwan) Smart App cloud service, so your devices must be registered and set up there first. Once discovered, when a device's Wi-Fi module can be reached on your local network the plugin talks to it **directly over the LAN** and only falls back to the cloud when the local path is unavailable — this is faster and avoids the cloud rate limit. See [Local control](#local-control).

By default every supported device on your account appears in your Home app. You can choose which devices to expose from the plugin's settings screen — see [Choosing which devices appear in HomeKit](#choosing-which-devices-appear-in-homekit). If you remove a device from your Smart App account, it also disappears from your Home app after you restart Homebridge.

## Smart App account

In the past, using the same account on multiple devices often resulted in being logged out of one of them. This made it necessary to create a secondary account in order for the plugin to operate reliably.

## Homebridge setup
Configure the plugin through the settings UI or directly in the JSON editor:

```json
{
  "platforms": [
    {
      "platform": "Panasonic Smart App Platform",
      "name": "Homebridge Panasonic Smart App Platform",
      "email": "mail@example.com",
      "password": "********",
      "localControl": true,
      "localScanSubnet": true,
      "debugMode": false
    }
  ]
}
```

Required:

* `platform` (string):
Tells Homebridge which platform this config belongs to. Leave as is.

* `name` (string):
Will be displayed in the Homebridge log.

* `email` (string):
The username of your Smart App account.

* `password` (string):
The password of your account.

Optional:

* `localControl` (boolean, default `true`):
Prefer talking to devices directly over your local network, falling back to the cloud when a device has no reachable module, a local request fails, or a command isn't supported locally. See [Local control](#local-control).

* `localScanSubnet` (boolean, default `true`):
In addition to SSDP, scan the local subnet (TCP port 57223) to locate modules. Disable if SSDP alone already finds your devices.

* `localDevices` (array):
Optional manual overrides mapping a device `gwid` (its MAC, 12 hex characters) to a LAN `host` (IP address). Use when SSDP is blocked (e.g. the module is on a different VLAN) or DHCP keeps moving a device.

* `excludedDevices` (array):
GWIDs of devices that should **not** be exposed to HomeKit. This is normally managed for you by the settings screen — see [Choosing which devices appear in HomeKit](#choosing-which-devices-appear-in-homekit).

* `debugMode` (boolean):
If `true`, the plugin will print debugging information to the Homebridge log.

## Local control

From v2.0.0, when a device's Panasonic Wi-Fi module (**CZ-T006 / CZ-T007**) is reachable on the same network, the plugin reads status and sends commands **directly over the LAN** using the TaiSEIA protocol, and only falls back to the Panasonic cloud when the local path can't be used. Local control is lower latency and isn't subject to the cloud's rate limit.

* No extra setup is needed — devices are found automatically via SSDP and an optional subnet scan, and matched to your cloud devices by MAC address. LAN address changes (DHCP) are re-discovered automatically.
* Devices are still **discovered** through the cloud, so your account credentials are always required.
* To turn it off and use the cloud exclusively, set `localControl` to `false`.

## Choosing which devices appear in HomeKit

Open the plugin's settings in the Homebridge UI. Every device on your account is shown as a card with its type, model and current status. Supported devices (air conditioner, dehumidifier, air purifier) have an **In HomeKit** switch you can turn off to hide a device from HomeKit; unsupported devices are marked accordingly. Changes are saved immediately and take effect after you restart Homebridge. Newly added devices are included by default.

## Troubleshooting

- If you have any issues with this plugin, enable the debug mode in the settings (and restart the plugin). This will print additional information to the log. If this doesn't help you resolve the issue, feel free to create a [GitHub issue](https://github.com/tasict/homebridge-panasonic-smart-app/issues) and attach the available debugging information.

- If you run into login errors despite using the correct login details, make sure you accepted the latest terms and conditions after logging into the Smart App app.

- If the plugin affects the general responsiveness and reliability of your Homebridge setup, you can run it as an isolated [child bridge](https://github.com/homebridge/homebridge/wiki/Child-Bridges).

## Contributing

You can contribute to this project in the following ways:

* Test/use the plugin and [report issues and share feedback](https://github.com/tasict/homebridge-panasonic-smart-app/issues).

* Review source code changes [before](https://github.com/tasict/homebridge-panasonic-smart-app/pulls) and [after](https://github.com/tasict/homebridge-panasonic-smart-app/commits/master) they are published.

* Contribute with your own bug fixes, code clean-ups, or additional features (pull requests are accepted).

## Acknowledgements
* Thanks to [embee8](https://github.com/embee8) for creating and maintaining [homebridge-panasonic-ac-platform](https://github.com/embee8/homebridge-panasonic-ac-platform), which served as motivation for this platform plugin and proved particularly helpful in determining API request/response payloads.

* Thanks to the team behind Homebridge. Your efforts do not go unnoticed.

* Thanks to [osk2](https://github.com/osk2) for creating and maintaining [panasonic_smart_app](https://github.com/osk2/panasonic_smart_app), which served as motivation for this platform plugin and proved particularly helpful in determining API request/response payloads.


## Disclaimer
All product and company names are trademarks™ or registered® trademarks of their respective holders. Use of them does not imply any affiliation with or endorsement by them.
