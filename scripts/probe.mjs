#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Probe of the real Neviweb API with the integration's own client, READ ONLY:
// login, locations, devices, signatures, the attributes the integration reads,
// gateway status, one hourly consumption history. Never a write, never a
// command, never a login retry.
//
// It prints SHAPES only — keys, value types, model numbers, counts, error
// codes — never a name, an id, an e-mail, a session or a value that could
// locate a home, so the output can be pasted in an issue.
//
//   node scripts/probe.mjs
//       logs in with an invented account: Neviweb must refuse it cleanly
//       (USRBADLOGIN), which proves the endpoint and the error path.
//   NEVIWEB_USERNAME=... NEVIWEB_PASSWORD=... node scripts/probe.mjs
//       probes a real account (about 2 requests per device).
//
// Behind an HTTP proxy, add NODE_USE_ENV_PROXY=1 (Node 22.18+ / 24): Node's
// fetch ignores HTTPS_PROXY otherwise.
// -----------------------------------------------------------------------------

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createNeviwebClient } from '../src/neviweb/client.js';
import { classify } from '../src/neviweb/models.js';
import { BLUEPRINTS } from '../src/devices.js';
import { Store } from '../src/store.js';
import { hourlyToIntervals } from '../src/energy.js';

const username = process.env.NEVIWEB_USERNAME || 'probe-gladys-sinope@example.invalid';
const password = process.env.NEVIWEB_PASSWORD || `invalid-${Math.random().toString(36).slice(2)}`;
const realAccount = Boolean(process.env.NEVIWEB_USERNAME && process.env.NEVIWEB_PASSWORD);

// A throwaway /data: the probe leaves no session behind.
const dataDir = mkdtempSync(join(tmpdir(), 'neviweb-probe-'));
const client = createNeviwebClient({
  getCredentials: () => ({ username, password }),
  store: new Store(dataDir),
  logger: createLogger({ level: 'silent' }),
});

/** The shape of a value: types instead of values, recursively. */
function shape(value, depth = 0) {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : `[${shape(value[0], depth + 1)}] x${value.length}`;
  }
  if (typeof value === 'object') {
    if (depth > 3) {
      return '{…}';
    }
    return `{ ${Object.entries(value)
      .map(([key, child]) => `${key}: ${shape(child, depth + 1)}`)
      .join(', ')} }`;
  }
  if (typeof value === 'string') {
    // Enumerations are useful (modes, statuses); free text is not printed.
    return /^[a-zA-Z]{1,20}$/.test(value) ? `"${value}"` : 'string';
  }
  return typeof value;
}

const print = (...lines) => console.log(lines.join('\n'));

async function main() {
  print(
    `Neviweb probe — ${realAccount ? 'real account' : 'invented account (a refusal is expected)'}`,
  );
  let locations;
  try {
    locations = await client.getLocations();
  } catch (err) {
    // A NeviwebError message holds a code or a network cause, never a secret.
    print(`login/locations: refused — ${err.code} (${err.message})`);
    if (!realAccount && err.code === 'USRBADLOGIN') {
      print('OK: Neviweb refused the invented account cleanly.');
      return 0;
    }
    return 1;
  }
  print(`locations: ${locations.length} — shape ${shape(locations[0] ?? {})}`);

  const seen = new Map(); // model → count
  let index = 0;
  for (const location of locations) {
    const devices = await client.getDevices(location.id);
    print(
      `location #${locations.indexOf(location) + 1}: ${devices.length} device(s) — shape ${shape(devices[0] ?? {})}`,
    );
    for (const device of devices) {
      index += 1;
      const tag = `device #${index}`;
      let signature;
      try {
        signature = await client.getSignature(device.id);
      } catch (err) {
        print(`${tag}: signature refused — ${err.code}`);
        continue;
      }
      const info = classify(signature);
      const model = `${signature?.protocol ?? '?'}/${signature?.model ?? '?'}/${signature?.type ?? '-'}`;
      seen.set(model, (seen.get(model) ?? 0) + 1);
      if (!info) {
        print(`${tag}: ${device.sku ?? '?'} ${model} — not supported`);
        continue;
      }
      try {
        let data;
        if (info.kind === 'gateway') {
          data = await client.getStatus(device.id);
        } else {
          const { core, optional } = BLUEPRINTS[info.kind].attributes(info);
          data = await client
            .getAttributes(device.id, [...core, ...optional])
            .catch(async (err) => {
              if (err.code !== 'DVCATTRNSPTD' || optional.length === 0) {
                throw err;
              }
              print(`${tag}: ${optional.join(', ')} refused (DVCATTRNSPTD)`);
              return client.getAttributes(device.id, core);
            });
        }
        const { states } = BLUEPRINTS[info.kind].read(info, data);
        const missing = Object.entries(states)
          .filter(([, value]) => value === null || value === undefined)
          .map(([key]) => key);
        print(
          `${tag}: ${device.sku ?? '?'} ${model} → ${info.kind}`,
          `  attributes ${shape(data)}`,
          `  features read: ${Object.keys(states).length - missing.length}/${Object.keys(states).length}` +
            (missing.length ? ` (missing: ${missing.join(', ')})` : ''),
        );
      } catch (err) {
        print(`${tag}: ${device.sku ?? '?'} ${model} — read refused: ${err.code}`);
      }
    }
  }

  // One consumption history, the first supported device that may have one.
  for (const location of locations) {
    for (const device of await client.getDevices(location.id)) {
      const info = classify(await client.getSignature(device.id).catch(() => null));
      if (
        info &&
        ['thermostat', 'load', 'water_heater'].includes(info.kind) &&
        info.protocol !== 'miwi'
      ) {
        try {
          const history = await client.getHourlyConsumption(device.id);
          const first = history[0] ?? {};
          print(
            `hourly consumption: ${history.length} entries — shape ${shape(first)}`,
            `  first date ends in ${String(first.date ?? '').slice(10) || '?'} (time and offset only)`,
            `  usable half-hours: ${hourlyToIntervals(history, Date.now()).length}`,
          );
        } catch (err) {
          print(`hourly consumption: refused — ${err.code}`);
        }
        print(`models seen: ${[...seen.entries()].map(([m, n]) => `${m} x${n}`).join(', ')}`);
        print(`requests sent: ${await client.requestsToday()}`);
        return 0;
      }
    }
  }
  print(`models seen: ${[...seen.entries()].map(([m, n]) => `${m} x${n}`).join(', ')}`);
  print(`requests sent: ${await client.requestsToday()}`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    // The message of a NeviwebError holds a code, never a secret.
    console.error(`probe failed: ${err.code ?? ''} ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => rmSync(dataDir, { recursive: true, force: true }));
