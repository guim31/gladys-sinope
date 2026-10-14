# Sinopé Neviweb for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for the
**Sinopé** devices managed by **Neviweb**, the Sinopé cloud: the electric
baseboard and floor heating thermostats found in so many Québec homes, light
switches and dimmers, load controllers (water heater, pool, car charger),
water leak detectors and the GT125 and GT130 gateways — first-generation
devices (GT125), Zigbee devices behind a GT130, and Wi-Fi devices.

> **Developed without the hardware: feedback welcome.** No Sinopé device nor
> Neviweb account was available while writing it: the Neviweb API is
> undocumented, and what this integration knows of it comes from the
> community integrations (see Credits). Please report what works and what does
> not in the [issues](https://github.com/guim31/gladys-sinope/issues).

## Features

- **Thermostats**: room temperature, setpoint (by half degree), mode (off or
  heating), preset (Schedule, Comfort, Away, Frost — as each generation
  allows), heating state and heating power in %.
- **Lights and dimmers**: on/off and brightness.
- **Load controllers, outlets and water heater controllers**: on/off, power
  in watts, water temperature and leak probe (water heaters).
- **Leak detectors**: water leak, battery, temperature.
- **Gateways**: online or not; every device gets the "unreachable" badge when
  Neviweb cannot reach it.
- **Energy** (Gladys 5.2): the hourly consumption Neviweb keeps for the GT130
  and Wi-Fi thermostats and load controllers, published as dated half-hours
  (`publishEnergyConsumption`), so the energy dashboard and the contracts
  (e.g. a Hydro-Québec rate with critical peaks) count it in the right slot
  even though Neviweb publishes it two hours late.
- **Éco-Sinopé**: scene triggers when a peak period starts and ends, read from
  the devices enrolled in the programme.
- **Scene action**: set the Neviweb home/away mode.
- **Dashboard widget**: every thermostat of the house on one card, the peak in
  progress, and home/away buttons.
- Four languages (English, French, German, Spanish); French by default.

## Requirements

- Gladys Assistant **5.2.0** or later.
- A Neviweb account (the e-mail and password of the Neviweb app).
- Internet access from Gladys: this is a cloud integration (`neviweb.com`).

Zigbee devices paired directly to Zigbee2MQTT already work in Gladys and are
not concerned.

## Installation

1. In Gladys: **Integrations → Install from GitHub**, then
   `https://github.com/guim31/gladys-sinope`.
2. Enter the Neviweb e-mail and password, save, and press **Test the Neviweb
   connection**.
3. Add the devices from the **Discovery** tab.

The full documentation, in four languages, is in [`docs/`](docs/en.md).

## How it works

- **Polling, gently**: Neviweb has no push API. The container reads the
  devices added to Gladys every 5 minutes (or 10), the pace Sinopé asks for,
  with its own timer (the core's `onPoll` is only a fallback, see
  GladysAssistant/Gladys#3198). Requests go one at a time, and a daily counter
  stops the readings at 25,000 requests — Neviweb cuts an account off at
  30,000.
- **Logins, rarely**: the session is kept in `/data`; a refused password is
  never tried twice (repeated bad logins lock a Neviweb account); a refused
  login (too many sessions, rate limit) waits 15 minutes.
- **Three generations**: the GT125 (MiWi), GT130 (Zigbee) and Wi-Fi devices
  name their attributes differently; the device is identified once by its
  Neviweb signature (kept in `/data`), then read and commanded with the
  attributes of its generation.
- **Commands**: written to Neviweb, shown at once, and read back 15 seconds
  later to show what Neviweb really applied.

## Limitations

- Cloud only: without Neviweb, no reading nor command; a change shows up to
  5 minutes late.
- Not supported: heat pumps (HP6000), heat/cool thermostats (TH6xxxWF,
  TH1134ZB-HC), Sedna valves and flow meters, tank monitors, multi-controllers.
- Device settings (backlight, keypad lock, early start, timers, away
  setpoint) stay in the Neviweb app.
- Unverified assumptions, without hardware: the date of the hourly
  consumption entries (start of the hour), the Éco-Sinopé status of the Wi-Fi
  devices, the exact values of some modes. `scripts/probe.mjs` checks them
  against a real account, read only, and prints shapes only.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test, against the SDK's fake Gladys and an in-memory Neviweb
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .   # store validator
node scripts/probe.mjs                           # Neviweb must refuse an invented account
NEVIWEB_USERNAME=… NEVIWEB_PASSWORD=… node scripts/probe.mjs   # read-only probe of a real account
```

```
index.js                SDK wiring (src/app.js registers the handlers)
src/app.js              handlers: discovery, commands, action, scene action, widget
src/hub.js              discovery, the reading timer, energy, peak triggers, commands
src/devices.js          Sinopé device -> Gladys features, states and attribute writes
src/neviweb/client.js   Neviweb HTTP client: session, queue, daily budget
src/neviweb/models.js   signature -> device kind (MiWi, Zigbee, Wi-Fi models)
src/energy.js           hourly history -> dated half-hours
src/widgets.js          "Sinopé thermostats" dashboard widget
src/scenes.js           "Set the Neviweb home/away mode" scene action
src/store.js            /data: session, request counter, signatures
scripts/probe.mjs       read-only probe of the real API
test/                   node --test; fake Gladys of the SDK, fake Neviweb
```

`test/gladys-rules.test.js` checks every discovered device against the
category/type table extracted from the Gladys core.

Releases are made by the **Release** workflow (Actions → Release); never edit
the versions by hand. See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [claudegel/sinope-1](https://github.com/claudegel/sinope-1) and
  [claudegel/sinope-130](https://github.com/claudegel/sinope-130), the Home
  Assistant integrations of Claude Gélinas and contributors (GPL-3.0): their
  code was read to understand the Neviweb API — endpoints, attributes of each
  generation, model numbers, error codes, quotas — and nothing was copied.
- [Gladys Assistant](https://github.com/GladysAssistant/Gladys) and its
  integration SDK.

## Disclaimer

Not affiliated with, endorsed or sponsored by Sinopé Technologies. Sinopé,
Neviweb and Éco-Sinopé are trademarks of their owners.

## License

[Apache-2.0](LICENSE)
