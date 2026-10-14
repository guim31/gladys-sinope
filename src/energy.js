// -----------------------------------------------------------------------------
// Energy: Neviweb's hourly consumption history, published as dated
// half-hours on the device's `thirty-minutes-consumption` feature.
//
// Neviweb publishes the consumption of an hour about two hours late
// (sinope-130 documentation). Published as a live index, a late reading would
// land in the wrong half-hour; `publishEnergyConsumption` (Gladys 5.2) dates
// every interval instead, and the core prices it in the right slot of a
// time-of-use or critical-peak tariff (Hydro-Québec rate Flex D...). The core
// upserts by instant: publishing the last 24 hours again every hour costs
// nothing and picks up the hours Neviweb filled in late.
//
// Assumption, unverified without an account: the `date` of a history entry is
// the start of its hour and `period` is in Wh (what sinope-130 does with it).
// -----------------------------------------------------------------------------

const HOUR_MS = 60 * 60_000;
const HALF_HOUR_MS = 30 * 60_000;

/**
 * @param {Array<{ date?: string, period?: number|string }>} history
 * @param {number} nowMs
 * @returns {Array<{ starts_at: string, kwh: number }>} two equal halves per
 *   complete hour, oldest first; incomplete, undated or negative hours dropped
 */
export function hourlyToIntervals(history, nowMs) {
  const byStart = new Map();
  for (const entry of Array.isArray(history) ? history : []) {
    const start = Date.parse(entry?.date);
    // `null` is an hour Neviweb has no reading for, not a zero.
    const wh = entry?.period === null || entry?.period === '' ? NaN : Number(entry?.period);
    if (!Number.isFinite(start) || !Number.isFinite(wh) || wh < 0) {
      continue;
    }
    // A slot of the Gladys clock starts on a half hour; an hour still running
    // is not a reading yet.
    if (start % HALF_HOUR_MS !== 0 || start + HOUR_MS > nowMs) {
      continue;
    }
    const kwh = Math.round((wh / 1000 / 2) * 100_000) / 100_000;
    byStart.set(start, kwh);
    byStart.set(start + HALF_HOUR_MS, kwh);
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, kwh]) => ({ starts_at: new Date(start).toISOString(), kwh }));
}
