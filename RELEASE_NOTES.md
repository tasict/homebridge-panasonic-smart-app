# v2.1.0

Three more kinds of Panasonic appliances in the Home app, and fixes for air purifiers and
dehumidifiers whose models number their features differently. No configuration changes are needed.

## Highlights

### Heat exchangers (全熱交換器)
Heat exchangers such as the FY-ZY series appear as a fan: power and fan speed (with Auto/Manual on
models that have an automatic speed), a switch for each ventilation mode, and indoor and outdoor
temperature on models that report them.

### Smart switches (智慧開關)
Each circuit of a smart switch such as the F540107 / F540207 / F540307 is its own switch. Use
*Display As* in the Home app to show a circuit as a light or a fan.

### Know when the laundry is done
Panasonic washers and dryers only accept remote commands after Wi-Fi control is enabled on the
machine, for safety, so the plugin doesn't control them. Instead each gets a **Done** sensor that
notifies you when a cycle finishes (turn on its notifications in the Home app) and a **Running**
sensor for automations. Models that don't report a finished cycle are skipped with a note in the log.

### Fixes
- **Air purifiers** of the current Taiwanese models showed the off timer as PM2.5 and couldn't
  change the fan speed or nanoe. Their codes are now read from each model's command list, and the
  Home app's Auto / Manual switches the purifier's automatic speed.
- **Dehumidifier fan speed** was reversed on most models. Speeds are now ordered by their names.

**Full changelog:** see [CHANGELOG.md](CHANGELOG.md).
