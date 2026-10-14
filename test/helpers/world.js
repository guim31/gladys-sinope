// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, an in-memory Neviweb, a
// temporary /data and a clock, with the integration wired on top through
// registerHandlers — exactly as index.js does with the real SDK client.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { BASE_URL, FakeNeviweb, PASSWORD, USERNAME } from './fakeNeviweb.js';

// The integration logs its lifecycle at info; keep the test output readable
// (LOG_LEVEL is read on every log call). LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

export const CONFIG = { username: USERNAME, password: PASSWORD, language: 'fr' };

/** A clock the tests move by hand, starting on a round hour. */
export function createClock(start = Date.parse('2026-01-15T15:00:00.000Z')) {
  let time = start;
  return {
    now: () => time,
    advance(ms) {
      time += ms;
    },
  };
}

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config
 * @param {FakeNeviweb} [options.server]
 * @param {ReturnType<typeof createClock>} [options.clock]
 * @param {boolean} [options.timers] the reading timer (off: the tests drive the cycles)
 * @param {boolean} [options.connect]
 * @param {string} [options.dataDir]
 */
export async function createWorld({
  config = CONFIG,
  clock = createClock(),
  server = new FakeNeviweb({ now: clock.now }),
  timers = false,
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-sinope-')),
} = {}) {
  const gladys = createFakeGladys({ config });
  const store = new Store(dataDir);
  const app = registerHandlers(gladys, {
    store,
    fetch: server.fetch,
    now: clock.now,
    timers,
    baseUrl: BASE_URL,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, server, clock, app, hub: app.hub, store, dataDir };
}

/** The discovered device of a Neviweb device id. */
export function discovered(world, neviwebId) {
  return world.gladys.fake.discoveredDevices.find((device) =>
    device.external_id.endsWith(`:neviweb:${neviwebId}`),
  );
}

/** The user adds devices to Gladys (all the discovered ones by default). */
export async function createDevices(world, ids) {
  const devices =
    ids === undefined
      ? world.gladys.fake.discoveredDevices
      : ids.map((id) => discovered(world, id));
  for (const device of devices) {
    await world.gladys.fake.deviceCreated(device);
  }
}

/** Last state Gladys received for a feature of a Neviweb device. */
export function lastState(world, neviwebId, key) {
  return world.gladys.fake.lastState(
    world.gladys.externalIds('neviweb', String(neviwebId)).feature(key),
  );
}

/** The feature object of a discovered device. */
export function feature(world, neviwebId, key) {
  return discovered(world, neviwebId).features.find((f) => f.external_id.endsWith(`:${key}`));
}
