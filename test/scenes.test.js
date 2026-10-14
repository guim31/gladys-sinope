// -----------------------------------------------------------------------------
// The `set_location_mode` scene action and the connection test action.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, createWorld } from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

test('set_location_mode: away then home on every configured location', async (t) => {
  const w = await world(t, { config: { ...CONFIG, locations: 'Maison' } });
  const away = await w.gladys.fake.sceneAction('set_location_mode', { mode: 'away' });
  assert.deepEqual(away, { success: true, data: { outputs: { locations: 1 } } });
  assert.deepEqual(
    w.server.locations.map((l) => [l.name, l.mode]),
    [
      ['Maison', 'away'],
      ['Chalet', 'home'],
    ],
  );
  await w.gladys.fake.sceneAction('set_location_mode', { mode: 'home' });
  assert.equal(w.server.locations[0].mode, 'home');
});

test('set_location_mode refuses an unknown mode', async (t) => {
  const w = await world(t);
  const result = await w.gladys.fake.sceneAction('set_location_mode', { mode: 'vacation' });
  assert.equal(result.success, false);
  assert.match(result.error, /home or away/);
});

test('the connection test lists the locations and the devices', async (t) => {
  const w = await world(t);
  const result = await w.gladys.fake.action('test_connection');
  assert.equal(result.success, true);
  assert.match(
    result.data.message.fr,
    /^Connecté à Neviweb : 2 emplacement\(s\) \(Maison, Chalet\), 15 appareil\(s\) pris en charge, non pris en charge : Thermopompe \(HP6000ZB-GE\)\. \d+ requêtes Neviweb aujourd’hui\.$/,
  );
});

test('the connection test says what is wrong', async (t) => {
  const empty = await world(t, { config: {} });
  const notConfigured = await empty.gladys.fake.action('test_connection');
  assert.match(notConfigured.data.message.en, /Enter the e-mail/);

  const wrong = await world(t, { config: { ...CONFIG, password: 'nope' } });
  const refused = await wrong.gladys.fake.action('test_connection');
  assert.match(refused.data.message.de, /lehnt diese E-Mail-Adresse/);
});
