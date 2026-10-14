// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Minutes between two reads of Neviweb. Sinopé asks for five minutes at least
// (the HACS integrations moved to it after accounts were cut off), and a
// Neviweb session expires after about ten idle minutes: nothing slower is
// offered, a slower pace would log in again at every cycle.
export const POLL_INTERVALS = ['5', '10'];

export const DEFAULT_CONFIG = {
  username: '',
  password: '',
  locations: '',
  poll_interval: '5',
  language: 'fr',
};

/**
 * Location names typed by the user: commas, semicolons or new lines between
 * them, compared without case nor accents (see matchesLocation).
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseLocations(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  return [
    ...new Set(
      raw
        .split(/[,;\n]+/)
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ];
}

const fold = (text) =>
  String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

/**
 * Whether a Neviweb location is one the configuration asks for. An empty list
 * means every location of the account.
 * @param {string[]} wanted
 * @param {string} name
 */
export function matchesLocation(wanted, name) {
  return wanted.length === 0 || wanted.some((entry) => fold(entry) === fold(name));
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const pollInterval = String(source.poll_interval ?? DEFAULT_CONFIG.poll_interval);
  return {
    username: text(source.username),
    // A password may start or end with a space: kept as typed.
    password: typeof source.password === 'string' ? source.password : '',
    locations: parseLocations(source.locations),
    pollIntervalMs:
      Number(POLL_INTERVALS.includes(pollInterval) ? pollInterval : DEFAULT_CONFIG.poll_interval) *
      60_000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/** The Neviweb account is filled in. */
export function isConfigured(config) {
  return config.username !== '' && config.password !== '';
}
