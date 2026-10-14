// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading cycle writes nothing, a failure that repeats is
// logged once, and its end once. Never the password, the e-mail, the session
// id nor a cookie — not even at debug.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORD, USERNAME } from './helpers/fakeNeviweb.js';
import { CONFIG, createDevices, createWorld } from './helpers/world.js';

/** Capture the lines of the SDK logger at the given level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  t.mock.method(console, 'info', record('out'));
  t.mock.method(console, 'debug', record('out'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createDevices(w);
  logs.clear();

  for (let i = 0; i < 4; i += 1) {
    w.server.attributes['3002'].roomTemperature = { value: 20 + i / 10, error: null };
    w.server.attributes['3007'].wattageInstant = i % 2 ? 0 : 3000;
    w.clock.advance(31 * 60_000); // the consumption is read again too
    await w.hub.pollAll();
  }
  assert.deepEqual(logs.texts(), []);
});

test('a device that stays unreachable is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createDevices(w, [3002, 3004]);
  logs.clear();

  w.server.deviceErrors['3002'] = 'DVCCOMMTO';
  for (let i = 0; i < 4; i += 1) {
    w.clock.advance(5 * 60_000);
    await w.hub.pollAll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  assert.match(logs.lines[0].text, /Salon: Neviweb cannot reach the device \(DVCCOMMTO\)/);

  logs.clear();
  delete w.server.deviceErrors['3002'];
  w.clock.advance(5 * 60_000);
  await w.hub.pollAll();
  w.clock.advance(5 * 60_000);
  await w.hub.pollAll();
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /Salon: answers again/);
});

test('Neviweb down: one line, and one when it answers again', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createDevices(w, [3002]);
  logs.clear();

  w.server.online = false;
  for (let i = 0; i < 4; i += 1) {
    w.clock.advance(5 * 60_000);
    await w.hub.pollAll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  w.server.online = true;
  w.clock.advance(5 * 60_000);
  await w.hub.pollAll();
  assert.equal(logs.lines.length, 2, logs.texts().join('\n'));
  assert.match(logs.lines[1].text, /Neviweb answers again/);
});

test('one info line per command of the user', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createDevices(w, [3002]);
  logs.clear();
  const device = w.gladys.fake.devices.find((d) => d.external_id.endsWith(':3002'));
  const setpoint = device.features.find((f) => f.external_id.endsWith(':setpoint'));
  await w.gladys.fake.setValue(device, setpoint, 20);
  assert.deepEqual(
    logs.texts().map((text) => text.replace(/^.*\] /, '')),
    ['Command: Salon setpoint → 20'],
  );
});

test('no secret in the logs, even at debug', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  await createDevices(w);
  w.server.expireSessions(); // a second login
  w.clock.advance(5 * 60_000);
  await w.hub.pollAll();
  await w.gladys.fake.action('test_connection');
  await w.gladys.fake.configUpdated({ ...CONFIG, password: 'another secret password' });

  const all = logs.texts().join('\n');
  assert.ok(logs.lines.length > 20, 'debug shows the readings');
  for (const secret of [
    PASSWORD,
    'another secret password',
    USERNAME,
    'session-1',
    'session-2',
    'cookie-1',
  ]) {
    assert.ok(!all.includes(secret), `"${secret}" appears in the logs`);
  }
});

test('Gladys refusing the states is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createDevices(w, [3002]);
  logs.clear();
  t.mock.method(w.gladys, 'publishChangedStates', async () => {
    throw new Error('RATE_LIMIT_EXCEEDED: max 300 states per minute');
  });
  for (let i = 0; i < 3; i += 1) {
    w.server.attributes['3002'].roomSetpoint = 18 + i;
    w.clock.advance(5 * 60_000);
    await w.hub.pollAll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /RATE_LIMIT_EXCEEDED/);
});
