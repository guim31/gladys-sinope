// -----------------------------------------------------------------------------
// Neviweb's hourly history → the dated half-hours of publishEnergyConsumption.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hourlyToIntervals } from '../src/energy.js';

const NOW = Date.parse('2026-01-15T15:20:00.000Z');

test('each complete hour becomes two equal half-hours, in kWh', () => {
  const intervals = hourlyToIntervals(
    [
      { date: '2026-01-15T13:00:00.000Z', period: 1000 },
      { date: '2026-01-15T14:00:00.000Z', period: 333 },
    ],
    NOW,
  );
  assert.deepEqual(intervals, [
    { starts_at: '2026-01-15T13:00:00.000Z', kwh: 0.5 },
    { starts_at: '2026-01-15T13:30:00.000Z', kwh: 0.5 },
    { starts_at: '2026-01-15T14:00:00.000Z', kwh: 0.1665 },
    { starts_at: '2026-01-15T14:30:00.000Z', kwh: 0.1665 },
  ]);
});

test('the hour still running, an unaligned or undated hour and a negative reading are dropped', () => {
  const intervals = hourlyToIntervals(
    [
      { date: '2026-01-15T15:00:00.000Z', period: 500 }, // running
      { date: '2026-01-15T12:10:00.000Z', period: 500 }, // not on a slot
      { date: 'yesterday', period: 500 },
      { period: 500 },
      { date: '2026-01-15T11:00:00.000Z', period: -1 },
      { date: '2026-01-15T10:00:00.000Z', period: null },
      { date: '2026-01-15T09:00:00.000Z', period: '250' },
    ],
    NOW,
  );
  assert.deepEqual(
    intervals.map((i) => i.starts_at),
    ['2026-01-15T09:00:00.000Z', '2026-01-15T09:30:00.000Z'],
  );
});

test('a history in local time with an offset is dated right', () => {
  const [first] = hourlyToIntervals([{ date: '2026-01-15T08:00:00-05:00', period: 200 }], NOW);
  assert.deepEqual(first, { starts_at: '2026-01-15T13:00:00.000Z', kwh: 0.1 });
});

test('nothing usable, nothing published', () => {
  assert.deepEqual(hourlyToIntervals(undefined, NOW), []);
  assert.deepEqual(hourlyToIntervals([], NOW), []);
});
