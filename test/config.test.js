import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  isConfigured,
  matchesLocation,
  normalizeConfig,
  parseLocations,
} from '../src/config.js';

test('defaults: French, every location, five minutes', () => {
  const config = normalizeConfig();
  assert.deepEqual(config, {
    username: '',
    password: '',
    locations: [],
    pollIntervalMs: 5 * 60_000,
    language: 'fr',
  });
  assert.equal(isConfigured(config), false);
  assert.equal(DEFAULT_CONFIG.language, 'fr');
});

test('the e-mail is trimmed, the password kept as typed', () => {
  const config = normalizeConfig({ username: '  me@example.com ', password: ' pass ' });
  assert.equal(config.username, 'me@example.com');
  assert.equal(config.password, ' pass ');
  assert.equal(isConfigured(config), true);
});

test('only the offered intervals and languages', () => {
  assert.equal(normalizeConfig({ poll_interval: '10' }).pollIntervalMs, 10 * 60_000);
  assert.equal(normalizeConfig({ poll_interval: 10 }).pollIntervalMs, 10 * 60_000);
  assert.equal(normalizeConfig({ poll_interval: '1' }).pollIntervalMs, 5 * 60_000);
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
  assert.equal(normalizeConfig({ language: 'es' }).language, 'es');
});

test('locations: commas, semicolons or lines; accents and case aside', () => {
  assert.deepEqual(parseLocations('Maison, chalet;Maison\n Bureau '), [
    'Maison',
    'chalet',
    'Bureau',
  ]);
  assert.deepEqual(parseLocations(undefined), []);
  assert.ok(matchesLocation(['maison'], 'Maison'));
  assert.ok(matchesLocation(['Chalet'], 'Châlet'));
  assert.ok(!matchesLocation(['Chalet'], 'Maison'));
  assert.ok(matchesLocation([], 'Anything'));
});
