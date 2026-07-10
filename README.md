# Homebridge Panasonic Smart App Platform

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![GitHub version](https://img.shields.io/github/package-json/v/tasict/homebridge-panasonic-smart-app?label=GitHub)](https://github.com/tasict/homebridge-panasonic-smart-app)
[![npm version](https://img.shields.io/npm/v/homebridge-panasonic-smart-app?color=%23cb3837&label=npm)](https://www.npmjs.com/package/homebridge-panasonic-smart-app)

`homebridge-panasonic-smart-app` is a dynamic platform plugin for [Homebridge](https://homebridge.io) that provides HomeKit support for Panasonic single and multi-split air conditioning systems.

## How it works
The plugin communicates with your AC units through the Smart App service. This means your units must be registered and set up there before you can use this plugin.

All devices that are set up on your Smart App account will appear in your Home app. If you remove a device from your Smart App account, it will also disappear from your Home app after you restart Homebridge.

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
        "debugMode": false,
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

* `debugMode` (boolean):
If `true`, the plugin will print debugging information to the Homebridge log.

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
