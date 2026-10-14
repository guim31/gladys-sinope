// -----------------------------------------------------------------------------
// The Neviweb client alone: login and session kept in /data, cookies, the
// queue (one request at a time), the daily request budget, the error codes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { DAILY_SOFT_LIMIT, NeviwebError, createNeviwebClient } from '../src/neviweb/client.js';
import { Store } from '../src/store.js';
import { BASE_URL, FakeNeviweb, PASSWORD, USERNAME } from './helpers/fakeNeviweb.js';
import { createClock } from './helpers/world.js';

function setup({ credentials = { username: USERNAME, password: PASSWORD }, dir } = {}) {
  const clock = createClock();
  const server = new FakeNeviweb({ now: clock.now });
  const dataDir = dir ?? mkdtempSync(join(tmpdir(), 'gladys-sinope-client-'));
  const store = new Store(dataDir);
  const client = createNeviwebClient({
    getCredentials: () => credentials,
    store,
    fetch: server.fetch,
    now: clock.now,
    baseUrl: BASE_URL,
    logger: createLogger({ level: 'silent' }),
  });
  return { client, server, store, dataDir, clock, credentials };
}

test('logs in once, sends the session id and the cookies', async () => {
  const { client, server } = setup();
  const locations = await client.getLocations();
  assert.deepEqual(
    locations.map((l) => l.name),
    ['Maison', 'Chalet'],
  );
  await client.getDevices(2001);
  assert.equal(server.logins(), 1);
  const last = server.requests.at(-1);
  assert.equal(last.headers['Session-Id'], 'session-1');
  assert.equal(last.headers.Cookie, 'hmac=cookie-1');
  assert.equal(server.requests[0].body.interface, 'neviweb');
});

test('the session is kept in /data, readable by the container user only', async () => {
  const first = setup();
  await first.client.getLocations();
  await first.store.flush();
  const file = join(first.dataDir, 'session.json');
  assert.equal(statSync(file).mode & 0o077, 0, 'no access for group and others');
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(saved.sessionId, 'session-1');
  for (const name of readdirSync(first.dataDir)) {
    const text = readFileSync(join(first.dataDir, name), 'utf8');
    assert.ok(!text.includes(PASSWORD), `${name} holds the password`);
    assert.ok(!text.includes(USERNAME), `${name} holds the e-mail`);
  }

  // Another container start on the same /data reuses it.
  const second = setup({ dir: first.dataDir });
  second.server.sessions.add('session-1');
  await second.client.getLocations();
  assert.equal(second.server.logins(), 0);
});

test('a session saved for another account is not reused', async () => {
  const first = setup();
  await first.client.getLocations();
  await first.store.flush();
  const second = setup({
    dir: first.dataDir,
    credentials: { username: 'other@example.com', password: 'x' },
  });
  second.server.sessions.add('session-1');
  await assert.rejects(second.client.getLocations(), { code: 'USRBADLOGIN' });
  assert.equal(second.server.logins(), 1);
});

test('a refused password is not sent again until it changes', async () => {
  const { client, server, credentials } = setup({
    credentials: { username: USERNAME, password: 'wrong' },
  });
  await assert.rejects(client.getLocations(), { code: 'USRBADLOGIN' });
  await assert.rejects(client.getLocations(), { code: 'LOGIN_BLOCKED' });
  assert.equal(server.logins(), 1);
  assert.equal(client.isBlocked(), true);
  credentials.password = PASSWORD;
  assert.equal(client.isBlocked(), false);
  await client.getLocations();
  assert.equal(server.logins(), 2);
});

test('rate-limited logins wait 15 minutes', async () => {
  const { client, server, clock } = setup();
  server.loginError = 'ACCRATELIMIT';
  await assert.rejects(client.getLocations(), { code: 'ACCRATELIMIT' });
  server.loginError = null;
  await assert.rejects(client.getLocations(), { code: 'LOGIN_COOLDOWN' });
  clock.advance(15 * 60_000);
  await client.getLocations();
  assert.equal(server.logins(), 2);
});

test('device errors are told apart from account errors', async () => {
  const { client, server } = setup();
  server.deviceErrors['3002'] = 'DVCCOMMTO';
  const err = await client.getAttributes('3002', ['roomTemperature']).catch((e) => e);
  assert.ok(err instanceof NeviwebError);
  assert.equal(err.isDeviceError, true);

  server.online = false;
  const offline = await client.getLocations().catch((e) => e);
  assert.equal(offline.code, 'NETWORK');
  assert.equal(offline.isDeviceError, false);
});

test('a non-JSON answer is an error, not a crash', async () => {
  const broken = createNeviwebClient({
    getCredentials: () => ({ username: USERNAME, password: PASSWORD }),
    store: new Store(mkdtempSync(join(tmpdir(), 'gladys-sinope-client-'))),
    fetch: async () => new Response('<html>maintenance</html>', { status: 503 }),
    baseUrl: BASE_URL,
    logger: createLogger({ level: 'silent' }),
  });
  await assert.rejects(broken.getLocations(), { code: 'HTTP_503' });
});

test('past the daily budget, reading stops but commands still go', async () => {
  const { client, server, store, clock } = setup();
  await store.writeJson('requests.json', {
    day: new Date(clock.now()).toLocaleDateString('sv-SE'),
    count: DAILY_SOFT_LIMIT - 2,
  });
  await client.getLocations(); // login + locations
  await assert.rejects(client.getDevices(2001), { code: 'DAILY_BUDGET' });
  await client.setAttributes('3002', { roomSetpoint: 20 });
  assert.deepEqual(server.writes.at(-1), { id: '3002', values: { roomSetpoint: 20 } });

  // A new day.
  clock.advance(24 * 60 * 60_000);
  await client.getDevices(2001);
  assert.equal(await client.requestsToday(), 1);
});

test('the requests go one at a time, in call order', async () => {
  const { client, server } = setup();
  await Promise.all([
    client.getLocations(),
    client.getDevices(2001),
    client.getDevices(2002),
    client.getAttributes('3002', ['roomSetpoint']),
    client.setAttributes('3005', { onOff: 'off' }),
  ]);
  assert.equal(server.maxInFlight, 1);
  assert.deepEqual(
    server.requests.map((r) => r.path),
    [
      '/api/login',
      '/api/locations',
      '/api/devices',
      '/api/devices',
      '/api/device/3002/attribute',
      '/api/device/3005/attribute',
    ],
  );
});
