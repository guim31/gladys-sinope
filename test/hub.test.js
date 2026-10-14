// -----------------------------------------------------------------------------
// The hub against the in-memory Neviweb: discovery, the container's own
// reading timer (states refresh without any onPoll from the core), the
// fallback onPoll, device errors, commands, energy and the Éco-Sinopé triggers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEARTBEAT_MS, SCENE_TRIGGERS } from '../src/hub.js';
import { THERMOSTAT_MODE, THERMOSTAT_PRESET } from '../src/devices.js';
import {
  CONFIG,
  createDevices,
  createWorld,
  discovered,
  feature,
  lastState,
} from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const attributeReads = (server, id) =>
  server.requests.filter(
    (r) =>
      r.method === 'GET' &&
      r.path === `/api/device/${id}/attribute` &&
      r.query.attributes !== 'signature',
  ).length;

test('discovery publishes the supported devices and leaves the others out', async (t) => {
  const w = await world(t);
  const names = w.gladys.fake.discoveredDevices.map((device) => device.name).sort();
  assert.ok(names.includes('Salon') && names.includes('Séjour') && names.includes('GT125'));
  assert.ok(!names.includes('Thermopompe'), 'heat pumps are not supported');
  assert.deepEqual(w.hub.unsupported(), ['Thermopompe (HP6000ZB-GE)']);
  assert.equal(w.gladys.fake.connectionStatus.connected, true);

  const salon = discovered(w, 3002);
  assert.deepEqual(salon.params, [
    { name: 'NEVIWEB_ID', value: '3002' },
    { name: 'MODEL', value: 'TH1123ZB' },
    { name: 'LOCATION', value: 'Maison' },
  ]);
  assert.equal(feature(w, 3002, 'setpoint').name, 'Consigne');
});

test('the signatures are asked once, then read from /data', async (t) => {
  const w = await world(t);
  const signatureReads = () =>
    w.server.requests.filter((r) => r.query.attributes === 'signature').length;
  assert.equal(signatureReads(), 16);
  await w.gladys.fake.scanRequest();
  assert.equal(signatureReads(), 16);

  // A new start on the same /data: still no signature request.
  const again = await createWorld({ dataDir: w.dataDir, server: w.server, clock: w.clock });
  t.after(() => again.app.stop());
  assert.equal(signatureReads(), 16);
  assert.equal(w.server.logins(), 1, 'the session saved in /data is reused');
});

test('only the devices added to Gladys are read', async (t) => {
  const w = await world(t);
  await createDevices(w, [3002]);
  await w.hub.pollAll({ force: true });
  assert.ok(attributeReads(w.server, 3002) >= 1);
  assert.equal(attributeReads(w.server, 3004), 0);
  assert.equal(attributeReads(w.server, 4002), 0);
});

test('the states refresh on the container timer, without any onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await world(t, { timers: true });
  await createDevices(w, [3002]);
  assert.equal(lastState(w, 3002, 'temperature'), 20.5);

  const onPoll = t.mock.method(w.hub, 'pollFromCore');
  w.server.attributes['3002'].roomTemperature = { value: 21.84, error: null };
  w.server.attributes['3002'].roomSetpoint = 22.5;
  w.clock.advance(5 * 60_000);
  t.mock.timers.tick(5 * 60_000);
  // Let the cycle started by the timer finish.
  for (let i = 0; i < 50 && lastState(w, 3002, 'temperature') !== 21.8; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(lastState(w, 3002, 'temperature'), 21.8);
  assert.equal(lastState(w, 3002, 'setpoint'), 22.5);
  assert.equal(onPoll.mock.callCount(), 0, 'the core never polled');
});

test('the fallback onPoll does not read a device the timer just read', async (t) => {
  const w = await world(t);
  await createDevices(w, [3002]);
  await w.hub.pollAll({ force: true });
  const before = attributeReads(w.server, 3002);

  const device = w.gladys.fake.devices.find(
    (d) => d.external_id === discovered(w, 3002).external_id,
  );
  assert.deepEqual(await w.gladys.fake.poll(device), { success: true });
  assert.equal(attributeReads(w.server, 3002), before, 'skipped: read less than a period ago');

  // The timer stalled: the core's poll reads the device.
  w.clock.advance(5 * 60_000);
  await w.gladys.fake.poll(device);
  assert.equal(attributeReads(w.server, 3002), before + 1);
});

test('a cycle never reads a device read less than half a period ago', async (t) => {
  const w = await world(t);
  await createDevices(w, [3002]);
  const before = attributeReads(w.server, 3002);
  w.clock.advance(60_000);
  await w.hub.pollAll();
  assert.equal(attributeReads(w.server, 3002), before);
  w.clock.advance(2 * 60_000);
  await w.hub.pollAll();
  assert.equal(attributeReads(w.server, 3002), before + 1);
});

test('states are published with a heartbeat well under 12 hours', async (t) => {
  const w = await world(t);
  const calls = t.mock.method(w.gladys, 'publishChangedStates');
  await createDevices(w, [3002]);
  assert.ok(calls.mock.callCount() > 0);
  for (const call of calls.mock.calls) {
    assert.ok(call.arguments[1].heartbeat <= 12 * 60 * 60_000);
  }
  assert.ok(HEARTBEAT_MS <= 12 * 60 * 60_000);
});

test('a device Neviweb cannot reach turns unreachable, then back to cloud', async (t) => {
  const w = await world(t);
  await createDevices(w, [3002, 3004]);
  const id = discovered(w, 3002).external_id;
  const transport = () =>
    w.gladys.fake.transports.filter((entry) => entry.device_external_id === id).at(-1)?.transport;
  assert.equal(transport(), 'cloud');

  w.server.deviceErrors['3002'] = 'DVCCOMMTO';
  w.clock.advance(5 * 60_000);
  await w.hub.pollAll();
  assert.equal(transport(), 'unreachable');
  assert.equal(w.gladys.fake.connectionStatus.connected, true, 'the account is fine');
  assert.ok(attributeReads(w.server, 3004) >= 2, 'the other devices are still read');

  delete w.server.deviceErrors['3002'];
  w.clock.advance(5 * 60_000);
  await w.hub.pollAll();
  assert.equal(transport(), 'cloud');
});

test('an older firmware without drStatus is read without it', async (t) => {
  const w = await world(t);
  w.server.unsupportedAttributes['3002'] = ['drStatus'];
  await createDevices(w, [3002]);
  assert.equal(lastState(w, 3002, 'setpoint'), 21);
  const reads = w.server.requests.filter(
    (r) => r.path === '/api/device/3002/attribute' && r.method === 'GET',
  );
  const last = reads.at(-1).query.attributes.split(',');
  assert.ok(!last.includes('drStatus'));
  w.clock.advance(5 * 60_000);
  await w.hub.pollAll();
  const after = w.server.requests.filter(
    (r) => r.path === '/api/device/3002/attribute' && r.method === 'GET',
  );
  assert.ok(!after.at(-1).query.attributes.includes('drStatus'), 'not asked again');
});

test('an expired session logs in again once and the reading goes on', async (t) => {
  const w = await world(t);
  await createDevices(w, [3002]);
  assert.equal(w.server.logins(), 1);
  w.server.expireSessions();
  w.server.attributes['3002'].roomSetpoint = 20;
  w.clock.advance(5 * 60_000);
  await w.hub.pollAll();
  assert.equal(w.server.logins(), 2);
  assert.equal(lastState(w, 3002, 'setpoint'), 20);
});

test('a refused password is shown and never tried again until it changes', async (t) => {
  const w = await world(t, { config: { ...CONFIG, password: 'wrong' } });
  assert.equal(w.gladys.fake.connectionStatus.connected, false);
  assert.match(w.gladys.fake.connectionStatus.message.fr, /refuse ce courriel/);
  assert.equal(w.server.logins(), 1);
  for (let i = 0; i < 3; i += 1) {
    w.clock.advance(5 * 60_000);
    await w.hub.pollAll();
  }
  assert.equal(w.server.logins(), 1, 'a Neviweb account locks after repeated bad logins');

  await w.gladys.fake.configUpdated({ ...CONFIG });
  assert.equal(w.server.logins(), 2);
  assert.equal(w.gladys.fake.connectionStatus.connected, true);
  assert.equal(w.gladys.fake.discoveredDevices.length, 15);
});

test('too many sessions: the login waits 15 minutes', async (t) => {
  const w = await world(t, { connect: false });
  w.server.loginError = 'ACCSESSEXC';
  await w.gladys.connect();
  await w.app.ready;
  assert.match(w.gladys.fake.connectionStatus.message.en, /too many sessions/);
  w.server.loginError = null;
  w.clock.advance(5 * 60_000);
  await w.hub.pollAll();
  assert.equal(w.server.logins(), 1);
  w.clock.advance(11 * 60_000);
  await w.hub.pollAll();
  assert.equal(w.server.logins(), 2);
  assert.equal(w.gladys.fake.connectionStatus.connected, true);
});

test('the locations of the configuration only, accents and case aside', async (t) => {
  const w = await world(t, { config: { ...CONFIG, locations: 'chalet' } });
  const ids = w.gladys.fake.discoveredDevices.map((d) => d.external_id.split(':').at(-1));
  assert.deepEqual(ids.sort(), ['4001', '4002', '4003', '4004', '4005', '4006']);

  const none = await world(t, { config: { ...CONFIG, locations: 'Bureau' } });
  assert.equal(none.gladys.fake.connectionStatus.connected, false);
  assert.match(none.gladys.fake.connectionStatus.message.fr, /Aucun emplacement/);
});

// --- Commands --------------------------------------------------------------------

async function setValue(w, id, key, value) {
  const device = w.gladys.fake.devices.find((d) => d.external_id === discovered(w, id).external_id);
  const target = device.features.find((f) => f.external_id.endsWith(`:${key}`));
  return w.gladys.fake.setValue(device, target, value);
}

test('setpoint: rounded to the half degree, within the bounds the thermostat sends', async (t) => {
  const w = await world(t);
  await createDevices(w, [3002]);
  assert.deepEqual(await setValue(w, 3002, 'setpoint', 21.7), { success: true });
  assert.deepEqual(w.server.writes.at(-1), { id: '3002', values: { roomSetpoint: 21.5 } });
  assert.equal(lastState(w, 3002, 'setpoint'), 21.5);
  await setValue(w, 3002, 'setpoint', 45);
  assert.deepEqual(w.server.writes.at(-1).values, { roomSetpoint: 30 });
});

test('mode: off, then back on in the mode it had (GT130)', async (t) => {
  const w = await world(t);
  await createDevices(w, [3002]);
  assert.equal(lastState(w, 3002, 'preset'), THERMOSTAT_PRESET.SCHEDULE);
  await setValue(w, 3002, 'mode', THERMOSTAT_MODE.OFF);
  assert.deepEqual(w.server.writes.at(-1).values, { systemMode: 'off' });
  assert.equal(lastState(w, 3002, 'mode'), 0);
  assert.equal(lastState(w, 3002, 'operating_state'), 0);

  w.clock.advance(5 * 60_000);
  await w.hub.pollAll();
  await setValue(w, 3002, 'mode', THERMOSTAT_MODE.HEATING);
  assert.deepEqual(w.server.writes.at(-1).values, { systemMode: 'auto' }, 'back to its schedule');
});

test('presets: what each generation accepts', async (t) => {
  const w = await world(t);
  await createDevices(w, [3002, 3004, 4002]);

  // GT130: schedule and comfort (manual) only.
  await setValue(w, 3002, 'preset', THERMOSTAT_PRESET.COMFORT);
  assert.deepEqual(w.server.writes.at(-1).values, { systemMode: 'heat' });
  const refused = await setValue(w, 3002, 'preset', THERMOSTAT_PRESET.AWAY);
  assert.equal(refused.success, false);

  // Wi-Fi: away is an occupancy, leaving it restores home first.
  await setValue(w, 3004, 'preset', THERMOSTAT_PRESET.AWAY);
  assert.deepEqual(w.server.writes.at(-1).values, { occupancyMode: 'away' });
  w.clock.advance(5 * 60_000);
  await w.hub.pollAll();
  assert.equal(lastState(w, 3004, 'preset'), THERMOSTAT_PRESET.AWAY);
  await setValue(w, 3004, 'preset', THERMOSTAT_PRESET.SCHEDULE);
  assert.deepEqual(
    w.server.writes.slice(-2).map((write) => write.values),
    [{ occupancyMode: 'home' }, { setpointMode: 'auto' }],
  );

  // MiWi: frost protection.
  await setValue(w, 4002, 'preset', THERMOSTAT_PRESET.FROST);
  assert.deepEqual(w.server.writes.at(-1).values, { setpointMode: 'frostProtection' });
});

test('lights, dimmers and load controllers of both generations', async (t) => {
  const w = await world(t);
  await createDevices(w, [3005, 3006, 3010, 4005, 4006]);

  await setValue(w, 3005, 'brightness', 40);
  assert.deepEqual(w.server.writes.at(-1).values, { onOff: 'on', intensity: 40 });
  await setValue(w, 3006, 'light', 1);
  assert.deepEqual(w.server.writes.at(-1).values, { onOff: 'on' });
  await setValue(w, 3010, 'switch', 1);
  assert.deepEqual(w.server.writes.at(-1).values, { onOff: 'on' });

  await setValue(w, 4005, 'light', 0);
  assert.deepEqual(w.server.writes.at(-1).values, { intensity: 0 });
  await setValue(w, 4005, 'light', 1);
  assert.deepEqual(
    w.server.writes.at(-1).values,
    { intensity: 101 },
    'back to its last brightness',
  );
  await setValue(w, 4006, 'switch', 0);
  assert.deepEqual(w.server.writes.at(-1).values, { intensity: 0 });
  assert.equal(lastState(w, 4006, 'power'), 0);
});

test('a read-only feature and a refused command fail the command', async (t) => {
  const w = await world(t);
  await createDevices(w, [3002]);
  assert.equal((await setValue(w, 3002, 'temperature', 20)).success, false);
  w.server.deviceErrors['3002'] = 'DVCCOMMTO';
  const result = await setValue(w, 3002, 'setpoint', 20);
  assert.equal(result.success, false);
  assert.match(result.error, /DVCCOMMTO/);
});

// --- Device lifecycle, energy, peak ---------------------------------------------------

test('a device added to Gladys gets all its states at once', async (t) => {
  const w = await world(t);
  await createDevices(w, [3002]);
  // The SDK forgets what it published when a device is created or updated.
  const device = w.gladys.fake.devices.find(
    (d) => d.external_id === discovered(w, 3002).external_id,
  );
  const before = w.gladys.fake.states.length;
  await w.gladys.fake.deviceUpdated(device);
  const sent = w.gladys.fake.states
    .slice(before)
    .map((s) => s.device_feature_external_id.split(':').at(-1));
  for (const key of ['temperature', 'setpoint', 'mode', 'preset', 'operating_state', 'heating']) {
    assert.ok(sent.includes(key), key);
  }
});

test('the hourly consumption becomes dated half-hours', async (t) => {
  const w = await world(t);
  await createDevices(w, [3002, 4002]);
  const id = w.gladys.externalIds('neviweb', '3002').feature('energy');
  const states = w.gladys.fake.energyConsumption[id];
  // 850, 720, 0, 400 Wh over the last four complete hours, halves stamped at their end.
  assert.deepEqual(states.slice(0, 2), [
    { created_at: '2026-01-15T11:30:00.000Z', kwh: 0.425 },
    { created_at: '2026-01-15T12:00:00.000Z', kwh: 0.425 },
  ]);
  assert.equal(states.length, 8);
  assert.equal(states.at(-1).created_at, '2026-01-15T15:00:00.000Z');
  assert.equal(feature(w, 4002, 'energy'), undefined, 'no history on a GT125 thermostat');

  // Read once an hour, not at every cycle.
  const reads = () =>
    w.server.requests.filter((r) => r.path === '/api/device/3002/consumption/hourly').length;
  w.clock.advance(5 * 60_000);
  await w.hub.pollAll();
  assert.equal(reads(), 1);
  w.clock.advance(60 * 60_000);
  await w.hub.pollAll();
  assert.equal(reads(), 2);
});

test('Éco-Sinopé: one trigger when the peak starts, one when it ends', async (t) => {
  const w = await world(t);
  await createDevices(w, [3002, 3004, 3007]);
  await w.hub.pollAll({ force: true });
  assert.deepEqual(w.gladys.fake.sceneEvents, [], 'the first readings set the baseline');

  w.server.attributes['3002'].drStatus.drActive = 'on';
  w.server.attributes['3007'].drStatus.drActive = 'on';
  w.clock.advance(5 * 60_000);
  await w.hub.pollAll();
  w.clock.advance(5 * 60_000);
  await w.hub.pollAll();
  assert.deepEqual(
    w.gladys.fake.sceneEvents.map((event) => [event.key, event.data]),
    [[SCENE_TRIGGERS.PEAK_STARTED, { devices: 2 }]],
  );

  w.server.attributes['3002'].drStatus.drActive = 'off';
  w.clock.advance(5 * 60_000);
  await w.hub.pollAll();
  assert.equal(w.gladys.fake.sceneEvents.length, 1, 'one device still in the event');
  w.server.attributes['3007'].drStatus.drActive = 'off';
  w.clock.advance(5 * 60_000);
  await w.hub.pollAll();
  assert.deepEqual(w.gladys.fake.sceneEvents.at(-1), {
    key: SCENE_TRIGGERS.PEAK_ENDED,
    data: { devices: 0 },
  });
});

test('one request at a time, whatever runs together', async (t) => {
  const w = await world(t);
  await createDevices(w);
  w.clock.advance(5 * 60_000);
  await Promise.all([
    w.hub.pollAll(),
    setValue(w, 3002, 'setpoint', 19),
    w.gladys.fake.scanRequest(),
    w.gladys.fake.action('test_connection'),
  ]);
  assert.equal(w.server.maxInFlight, 1);
});

test('a reconnection to Gladys publishes the devices again, without reading Neviweb again', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const requests = w.server.requests.length;
  const publications = w.gladys.fake.bodies('POST', '/discovered_device').length;
  w.clock.advance(60_000);
  await w.gladys.disconnect();
  await w.gladys.connect();
  assert.equal(w.gladys.fake.bodies('POST', '/discovered_device').length, publications + 1);
  assert.deepEqual(
    w.server.requests.slice(requests).map((r) => r.path),
    ['/api/locations'],
    'only the home/away modes are read again',
  );
});

test('the connection test reuses the session: Neviweb limits the open sessions', async (t) => {
  const w = await world(t);
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await w.gladys.fake.action('test_connection')).success, true);
  }
  assert.equal(w.server.logins(), 1);
});

test('the connection test tries a refused password once more, on demand', async (t) => {
  const w = await world(t, { config: { ...CONFIG, password: 'wrong' } });
  assert.equal(w.server.logins(), 1);
  await w.gladys.fake.action('test_connection');
  assert.equal(w.server.logins(), 2);
  w.clock.advance(5 * 60_000);
  await w.hub.pollAll();
  assert.equal(w.server.logins(), 2, 'the cycles still do not');
});
