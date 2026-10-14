// -----------------------------------------------------------------------------
// Neviweb client: the HTTP API behind the Neviweb app and neviweb.com.
//
// Neviweb has no public documentation. What this client knows comes from the
// HACS integrations claudegel/sinope-1 and claudegel/sinope-130 (GPL-3.0,
// read to understand the protocol, nothing copied):
//
//   POST /api/login                         { username, password, interface, stayConnected }
//                                           → { session, account: { id }, user }
//   GET  /api/locations?account$id=<id>     → [{ id, name, mode, ... }]
//   GET  /api/devices?location$id=<id>      → [{ id, name, sku, identifier, ... }]
//   GET  /api/device/<id>/attribute?attributes=a,b → { a, b }
//   PUT  /api/device/<id>/attribute         { a: value }
//   GET  /api/device/<id>/status            → { status } (gateways)
//   GET  /api/device/<id>/consumption/hourly → { history: [{ date, period }] } (Wh)
//   POST /api/location/<id>/mode            { mode: 'home' | 'away' }
//
// Every authenticated request carries the `Session-Id` header. A failure is
// a 200 (or 4xx) whose body is `{ error: { code } }`.
//
// Sinopé cuts off the accounts that call too much: 30,000 requests a day,
// ACCDAYREQMAX past it, until midnight. So this client sends ONE request at a
// time (a queue), counts the requests of the day (kept in /data across
// restarts), and stops reading — never commanding — past DAILY_SOFT_LIMIT.
// Logins are rare too: the session is kept in /data, a refused password is
// never tried again until the configuration changes (repeated bad logins lock
// a Neviweb account), and a refused login waits LOGIN_COOLDOWN_MS.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export const NEVIWEB_URL = 'https://neviweb.com';

// Under the 30,000 a day of Neviweb, with room for the commands of the user.
export const DAILY_SOFT_LIMIT = 25_000;
export const REQUEST_TIMEOUT_MS = 30_000;
export const LOGIN_COOLDOWN_MS = 15 * 60_000;
const COUNTER_SAVE_EVERY = 20;

export class NeviwebError extends Error {
  /**
   * @param {string} code the Neviweb error code (USRBADLOGIN, DVCCOMMTO...) or
   *   one of this client (NETWORK, TIMEOUT, HTTP_<status>, BAD_RESPONSE,
   *   NOT_CONFIGURED, LOGIN_BLOCKED, LOGIN_COOLDOWN, DAILY_BUDGET)
   * @param {string} [message]
   * @param {{ status?: number }} [details]
   */
  constructor(code, message = code, { status } = {}) {
    super(message);
    this.name = 'NeviwebError';
    this.code = code;
    this.status = status;
  }

  /** The device did not answer, the account itself is fine. */
  get isDeviceError() {
    return DEVICE_ERRORS.has(this.code);
  }
}

// Errors about one device: the others keep being read.
const DEVICE_ERRORS = new Set([
  'DVCCOMMTO', // the device did not answer Neviweb in time
  'DVCUNVLB', // the device is unreachable (often a Wi-Fi device offline)
  'DVCBUSY',
  'DVCNOTSYNC',
  'DVCERR',
  'DVCATTRNSPTD', // an attribute the firmware does not know
  'DVCACTNSPTD',
  'ReadTimeout',
]);

// Login refusals that must not be retried at once.
const LOGIN_REFUSALS = new Set(['ACCSESSEXC', 'ACCRATELIMIT', 'ACCDAYREQMAX', 'MAINTENANCE']);

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** Local calendar day (the container gets the Gladys timezone in TZ). */
const localDay = (ms) => new Date(ms).toLocaleDateString('sv-SE');

/**
 * @param {object} options
 * @param {() => { username: string, password: string }} options.getCredentials
 * @param {import('../store.js').Store} options.store
 * @param {typeof fetch} [options.fetch]
 * @param {() => number} [options.now]
 * @param {string} [options.baseUrl]
 * @param {number} [options.timeoutMs]
 * @param {{ debug: Function, info: Function, warn: Function }} options.logger
 */
export function createNeviwebClient({
  getCredentials,
  store,
  fetch = globalThis.fetch,
  now = () => Date.now(),
  baseUrl = NEVIWEB_URL,
  timeoutMs = REQUEST_TIMEOUT_MS,
  logger,
}) {
  let session = null; // { userKey, sessionId, accountId, cookies }
  let sessionLoaded = false;
  let blockedKey = null; // credentials Neviweb refused (in memory only)
  let cooldownUntil = 0;
  let chain = Promise.resolve();

  const credentials = () => getCredentials();
  const userKey = () => sha256(`neviweb:${credentials().username.toLowerCase()}`);
  const credentialsKey = () => sha256(`${credentials().username}\u0000${credentials().password}`);

  /** Run one request at a time, in call order. */
  function enqueue(task) {
    const run = chain.then(task, task);
    chain = run.catch(() => {});
    return run;
  }

  async function loadSession() {
    if (!sessionLoaded) {
      sessionLoaded = true;
      const saved = await store.readJson('session.json');
      if (saved?.sessionId && saved.userKey === userKey()) {
        session = saved;
      }
    }
    if (session && session.userKey !== userKey()) {
      session = null; // another account in the configuration
    }
    return session;
  }

  async function saveSession(next) {
    session = next;
    if (next) {
      await store.writeJson('session.json', next);
    } else {
      await store.remove('session.json');
    }
  }

  // The counter of the day lives in memory and is written to /data every few
  // requests: a restart loses a handful of them, an SD card is not written at
  // every request.
  let counter = null;
  async function loadCounter() {
    if (counter === null) {
      const saved = await store.readJson('requests.json');
      counter = saved && typeof saved.count === 'number' ? saved : { day: '', count: 0 };
    }
    const today = localDay(now());
    if (counter.day !== today) {
      counter = { day: today, count: 0 };
    }
    return counter;
  }

  async function countRequest() {
    const current = await loadCounter();
    current.count += 1;
    if (current.count % COUNTER_SAVE_EVERY === 1) {
      await store.writeJson('requests.json', current);
    }
  }

  async function requestsToday() {
    return (await loadCounter()).count;
  }

  /** One HTTP exchange, no retry. Never logs a body: it may hold the session. */
  async function exchange(method, path, { body, auth = true, essential = false } = {}) {
    if (!essential && (await requestsToday()) >= DAILY_SOFT_LIMIT) {
      // Logged once by the caller's issue log.
      throw new NeviwebError(
        'DAILY_BUDGET',
        `${DAILY_SOFT_LIMIT} Neviweb requests today, reading paused until midnight`,
      );
    }
    const headers = { Accept: 'application/json' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (auth) {
      headers['Session-Id'] = session.sessionId;
    }
    const cookies = Object.entries(session?.cookies ?? {});
    if (cookies.length > 0) {
      headers.Cookie = cookies.map(([name, value]) => `${name}=${value}`).join('; ');
    }

    await countRequest();
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      const cause = err?.cause;
      const detail = cause?.code || cause?.message || err?.message || 'unknown';
      throw new NeviwebError(
        timeout ? 'TIMEOUT' : 'NETWORK',
        timeout ? 'Neviweb did not answer in time' : `Neviweb unreachable (${detail})`,
      );
    }

    const setCookies = response.headers.getSetCookie?.() ?? [];
    if (setCookies.length > 0 && session) {
      const jar = { ...session.cookies };
      for (const line of setCookies) {
        const [pair] = line.split(';');
        const index = pair.indexOf('=');
        if (index > 0) {
          jar[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
        }
      }
      session = { ...session, cookies: jar };
    }

    const text = await response.text();
    let data = {};
    if (text.trim() !== '') {
      try {
        data = JSON.parse(text);
      } catch {
        throw new NeviwebError(
          response.ok ? 'BAD_RESPONSE' : `HTTP_${response.status}`,
          `Unexpected answer from Neviweb (HTTP ${response.status})`,
          { status: response.status },
        );
      }
    }
    const code =
      data && typeof data === 'object' && !Array.isArray(data) ? data.error?.code : undefined;
    if (code) {
      throw new NeviwebError(String(code), `Neviweb refused the request (${code})`, {
        status: response.status,
      });
    }
    if (!response.ok) {
      throw new NeviwebError(
        `HTTP_${response.status}`,
        `Neviweb answered HTTP ${response.status}`,
        {
          status: response.status,
        },
      );
    }
    return data;
  }

  async function login() {
    const { username, password } = credentials();
    if (!username || !password) {
      throw new NeviwebError('NOT_CONFIGURED', 'Neviweb account not configured');
    }
    if (blockedKey === credentialsKey()) {
      throw new NeviwebError('LOGIN_BLOCKED', 'Neviweb refused this e-mail and password');
    }
    if (now() < cooldownUntil) {
      throw new NeviwebError('LOGIN_COOLDOWN', 'Neviweb refused the last login: waiting');
    }
    session = { userKey: userKey(), sessionId: null, accountId: null, cookies: {} };
    try {
      const data = await exchange('POST', '/api/login', {
        body: { username, password, interface: 'neviweb', stayConnected: 1 },
        auth: false,
        essential: true,
      });
      if (!data.session || data.account?.id === undefined) {
        throw new NeviwebError('BAD_RESPONSE', 'Unexpected login answer from Neviweb');
      }
      await saveSession({
        userKey: userKey(),
        sessionId: String(data.session),
        accountId: String(data.account.id),
        cookies: session.cookies,
      });
      logger.debug('Logged in to Neviweb');
      return session;
    } catch (err) {
      await saveSession(null);
      if (err.code === 'USRBADLOGIN') {
        blockedKey = credentialsKey();
      } else if (LOGIN_REFUSALS.has(err.code)) {
        cooldownUntil = now() + LOGIN_COOLDOWN_MS;
      }
      throw err;
    }
  }

  /**
   * An authenticated request: logs in first when there is no session, and
   * once again when Neviweb says the session expired.
   */
  function call(method, path, options = {}) {
    const resolve = () => (typeof path === 'function' ? path(session) : path);
    return enqueue(async () => {
      if (!(await loadSession())) {
        await login();
      }
      try {
        return await exchange(method, resolve(), options);
      } catch (err) {
        if (err.code !== 'USRSESSEXP' && err.code !== 'HTTP_401') {
          throw err;
        }
        logger.debug('Neviweb session expired: logging in again');
        await saveSession(null);
        await login();
        return exchange(method, resolve(), options);
      }
    });
  }

  const devicePath = (deviceId) => `/api/device/${encodeURIComponent(deviceId)}`;
  const list = (data) => (Array.isArray(data) ? data : []);

  return {
    /**
     * The user asks for a connection test: one more login attempt is allowed,
     * even after a refusal. The saved session is kept: a new one per test
     * would pile up sessions, which Neviweb limits (ACCSESSEXC).
     */
    unblock() {
      blockedKey = null;
      cooldownUntil = 0;
    },

    /** Forget the session and the refusals: the configuration changed. */
    async reset() {
      blockedKey = null;
      cooldownUntil = 0;
      sessionLoaded = true;
      await enqueue(() => saveSession(null));
    },

    /** The account cannot be used until the configuration changes. */
    isBlocked() {
      return blockedKey !== null && blockedKey === credentialsKey();
    },

    requestsToday,

    /** Write the request counter of the day (on shutdown). */
    async flush() {
      if (counter) {
        await store.writeJson('requests.json', counter);
      }
    },

    async getLocations() {
      return list(
        await call(
          'GET',
          (current) => `/api/locations?account$id=${encodeURIComponent(current.accountId)}`,
        ),
      );
    },

    async getDevices(locationId) {
      return list(await call('GET', `/api/devices?location$id=${encodeURIComponent(locationId)}`));
    },

    async getSignature(deviceId) {
      const data = await call('GET', `${devicePath(deviceId)}/attribute?attributes=signature`);
      return data.signature ?? null;
    },

    async getAttributes(deviceId, attributes) {
      return call('GET', `${devicePath(deviceId)}/attribute?attributes=${attributes.join(',')}`);
    },

    /** A command of the user: allowed past the daily read budget. */
    async setAttributes(deviceId, values) {
      return call('PUT', `${devicePath(deviceId)}/attribute`, { body: values, essential: true });
    },

    async getStatus(deviceId) {
      return call('GET', `${devicePath(deviceId)}/status`);
    },

    async getHourlyConsumption(deviceId) {
      const data = await call('GET', `${devicePath(deviceId)}/consumption/hourly`);
      return Array.isArray(data?.history) ? data.history : [];
    },

    async setLocationMode(locationId, mode) {
      return call('POST', `/api/location/${encodeURIComponent(locationId)}/mode`, {
        body: { mode },
        essential: true,
      });
    },
  };
}
