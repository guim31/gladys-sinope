// -----------------------------------------------------------------------------
// The `thermostats` widget: content within the core budget (checked by the
// SDK's own validator), localized, filtered by its settings, and its
// home/away buttons.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_ACTIONS, WIDGET_KEY, buildThermostatsContent } from '../src/widgets.js';
import { createDevices, createWorld, discovered } from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, request) {
  const ack = await w.gladys.fake.widgetGet(WIDGET_KEY, request);
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
}

test('every thermostat of the house, temperature and setpoint, within the budget', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const fr = await content(w, { language: 'fr' });
  assert.deepEqual(validateWidgetContent(fr), []);
  const [status] = fr.components.filter((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value, item.color]),
    [
      ['Chambre', '19,4 °C → 19 °C', 'success'],
      ['Plancher', '21,3 °C → 22 °C', 'success'],
      ['Salle de bain', '22,1 °C → 23,5 °C', 'success'],
      ['Salon', '20,5 °C → 21 °C · 45 %', 'warning'],
      ['Séjour', '18 °C → 18,5 °C · 30 %', 'warning'],
    ],
  );
  const buttons = fr.components.filter((c) => c.type === 'button');
  assert.deepEqual(
    buttons.map((b) => [b.label, b.icon, b.action.key]),
    [
      ['Maison', 'check-circle', WIDGET_ACTIONS.HOME],
      ['Absent', 'log-out', WIDGET_ACTIONS.AWAY],
    ],
  );

  const us = await content(w, { language: 'en', units: 'us' });
  const [usStatus] = us.components.filter((c) => c.type === 'status');
  assert.equal(usStatus.items[3].value, '68.9 °F → 69.8 °F · 45 %');

  for (const language of ['en', 'de', 'es']) {
    assert.deepEqual(validateWidgetContent(await content(w, { language })), [], language);
  }
});

test('the thermostats picked in the settings only', async (t) => {
  const w = await world(t);
  await createDevices(w);
  const picked = [discovered(w, 3002).external_id, discovered(w, 4002).external_id];
  const result = await content(w, { language: 'en', settings: { thermostats: picked } });
  const [status] = result.components.filter((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((item) => item.label),
    ['Salon', 'Séjour'],
  );
});

test('an off or unreachable thermostat says so', () => {
  const snapshot = {
    configured: true,
    discovered: true,
    peakActive: true,
    locationModes: ['away'],
    thermostats: [
      { externalId: 'a', name: 'Bureau', reachable: true, states: { temperature: 17.2, mode: 0 } },
      { externalId: 'b', name: 'Garage', reachable: false, states: { temperature: 9 } },
    ],
  };
  const result = buildThermostatsContent(snapshot, { language: 'fr' });
  assert.deepEqual(validateWidgetContent(result), []);
  assert.deepEqual(result.components[0], {
    type: 'text',
    variant: 'heading',
    text: 'Période de pointe Éco-Sinopé en cours',
  });
  const [status] = result.components.filter((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.value, item.color]),
    [
      ['17,2 °C · arrêt', 'neutral'],
      ['9 °C', 'danger'],
    ],
  );
  const away = result.components.find(
    (c) => c.type === 'button' && c.action.key === WIDGET_ACTIONS.AWAY,
  );
  assert.equal(away.icon, 'check-circle');
});

test('more than ten thermostats: ten rows and a count', () => {
  const thermostats = Array.from({ length: 13 }, (_, i) => ({
    externalId: `t${i}`,
    name: `Pièce ${String(i).padStart(2, '0')}`,
    reachable: true,
    states: { temperature: 20, setpoint: 21, mode: 1, operating_state: 0, heating: 0 },
  }));
  const result = buildThermostatsContent(
    { configured: true, discovered: true, peakActive: false, locationModes: [], thermostats },
    { language: 'en' },
  );
  assert.deepEqual(validateWidgetContent(result), []);
  assert.equal(result.components.find((c) => c.type === 'status').items.length, 10);
  assert.equal(result.components.find((c) => c.type === 'text').text, '+3');
});

test('not configured, nothing added yet', async (t) => {
  const empty = await world(t, { config: {} });
  const notConfigured = await content(empty, { language: 'de' });
  assert.match(notConfigured.components[0].text, /Gib die E-Mail-Adresse/);

  const w = await world(t);
  const none = await content(w, { language: 'es' });
  assert.equal(none.components[0].text, 'Aún no hay ningún termostato añadido a Gladys');
});

test('the away button sets every location away, and says so', async (t) => {
  const w = await world(t);
  await createDevices(w, [3002]);
  const ack = await w.gladys.fake.widgetAction(WIDGET_KEY, WIDGET_ACTIONS.AWAY);
  assert.equal(ack.success, true);
  assert.equal(ack.data.message.fr, 'Mode absent envoyé à 2 emplacement(s) Neviweb');
  assert.deepEqual(
    w.server.locations.map((l) => l.mode),
    ['away', 'away'],
  );
  const after = await content(w, { language: 'en' });
  const away = after.components.find(
    (c) => c.type === 'button' && c.action.key === WIDGET_ACTIONS.AWAY,
  );
  assert.equal(away.icon, 'check-circle');
  assert.ok(w.gladys.fake.widgetRefreshes.length > 0, 'the widget is asked to refresh');
});
