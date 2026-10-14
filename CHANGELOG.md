# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Sinopé devices from a Neviweb account: thermostats for electric baseboards,
  floor heating and low voltage (temperature, setpoint, mode, preset, heating
  state and heating power), light switches and dimmers, load controllers,
  outlets and water heater controllers (on/off, power, water temperature and
  leak probe), water leak detectors (leak, battery, temperature) and the GT125
  and GT130 gateways — first-generation, GT130 and Wi-Fi devices.
- Hourly consumption of the GT130 and Wi-Fi thermostats and load controllers,
  published as dated half-hours for the energy dashboard of Gladys 5.2.
- Scene triggers when an Éco-Sinopé peak period starts and ends.
- Scene action to set the Neviweb home/away mode.
- "Sinopé thermostats" dashboard widget: every thermostat of the house, the
  peak in progress and home/away buttons.
- "Test the Neviweb connection" button in the configuration.
- Gentle with the Neviweb quotas: a reading every 5 minutes, one request at a
  time, a daily request budget, the session kept in `/data`, a refused
  password never tried twice.
- Four languages: English, French, German, Spanish.

[Unreleased]: https://github.com/guim31/gladys-sinope/commits/main
