# Neviweb fixtures

`account.json` is a fictional Neviweb account: a "Maison" location behind a
GT130 (Zigbee and Wi-Fi devices) and a "Chalet" location behind a GT125
(first-generation MiWi devices). Ids, identifiers, names and the postal code
are invented.

Neviweb has no public documentation, and the integrations that talk to it
publish no captured responses. These shapes are reconstructed from what the
HACS integrations
[claudegel/sinope-1](https://github.com/claudegel/sinope-1) and
[claudegel/sinope-130](https://github.com/claudegel/sinope-130) read in each
answer (GPL-3.0: read to understand the protocol, nothing copied):

- the device list entry and the signature of `3010` follow the one example
  log of the sinope-130 README (`family`, `identifier`, `signature.protocol:
"sinopcom"`), with invented values;
- `roomTemperature` is `{ value, error }`, `outputPercentDisplay` a number on
  GT130/MiWi thermostats and `{ percent, sourceType }` on Wi-Fi ones,
  `drStatus.drActive` is `"on"`/`"off"`, a MiWi `wattageInstant` is
  `{ value }` and a GT130 one a number: what the parsing code of the HACS
  integrations expects;
- `hourly` lists the Wh of the last complete hours, oldest first; the fake
  server (`test/helpers/fakeNeviweb.js`) dates them on the test clock, as
  `{ history: [{ date, period }] }`.

The Wi-Fi `signature.protocol` (`"wifi"` here) is a guess: the integration
classifies the non-MiWi devices by model number only. `scripts/probe.mjs`,
run with a real account, prints the actual shapes (keys and types only).
