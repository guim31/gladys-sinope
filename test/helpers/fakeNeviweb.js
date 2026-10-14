// -----------------------------------------------------------------------------
// An in-memory Neviweb behind a `fetch` function: the routes the integration
// calls, the session header, the errors Neviweb answers (USRBADLOGIN,
// USRSESSEXP, DVCCOMMTO...) and a count of the requests in flight, to prove
// the client never sends two at a time. No network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const FIXTURE = JSON.parse(
  readFileSync(new URL('../fixtures/neviweb/account.json', import.meta.url), 'utf8'),
);

export const BASE_URL = 'https://neviweb.test';
export const USERNAME = 'test@example.com';
export const PASSWORD = 'correct horse battery staple';

const HOUR_MS = 60 * 60_000;

export class FakeNeviweb {
  /** @param {{ now?: () => number }} [options] */
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    const data = structuredClone(FIXTURE);
    this.locations = data.locations;
    this.devices = data.devices;
    this.signatures = data.signatures;
    this.attributes = data.attributes;
    this.status = data.status;
    this.hourly = data.hourly;
    this.password = PASSWORD;
    this.sessions = new Set();
    this.sessionCounter = 0;
    this.requests = [];
    this.writes = [];
    this.inFlight = 0;
    this.maxInFlight = 0;
    this.deviceErrors = {}; // device id → error code answered for it
    this.unsupportedAttributes = {}; // device id → attribute names refused (DVCATTRNSPTD)
    this.loginError = null; // error code answered to every login
    this.online = true;
    this.fetch = this.fetch.bind(this);
  }

  /** Expire every session: the next request gets USRSESSEXP. */
  expireSessions() {
    this.sessions.clear();
  }

  logins() {
    return this.requests.filter((r) => r.path === '/api/login').length;
  }

  async fetch(url, init = {}) {
    const { pathname, searchParams } = new URL(url);
    const method = init.method ?? 'GET';
    const headers = init.headers ?? {};
    const body = init.body ? JSON.parse(init.body) : undefined;
    this.requests.push({
      method,
      path: pathname,
      query: Object.fromEntries(searchParams),
      body,
      headers,
    });
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      // Let other callers run: two requests in flight would show here.
      await new Promise((resolve) => setImmediate(resolve));
      if (!this.online) {
        throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
      }
      return this.route(method, pathname, searchParams, headers, body);
    } finally {
      this.inFlight -= 1;
    }
  }

  route(method, path, query, headers, body) {
    if (method === 'POST' && path === '/api/login') {
      if (this.loginError) {
        return json({ error: { code: this.loginError } }, 200);
      }
      if (body?.username !== USERNAME || body?.password !== this.password) {
        return json({ error: { code: 'USRBADLOGIN' } }, 200);
      }
      this.sessionCounter += 1;
      const session = `session-${this.sessionCounter}`;
      this.sessions.add(session);
      return json(
        { session, account: { id: 1001 }, user: { email: USERNAME, firstName: 'Test' } },
        200,
        [`hmac=cookie-${this.sessionCounter}; Path=/; HttpOnly`],
      );
    }
    if (!this.sessions.has(headers['Session-Id'])) {
      return json({ error: { code: 'USRSESSEXP' } }, 200);
    }
    if (method === 'GET' && path === '/api/locations') {
      return json(query.get('account$id') === '1001' ? this.locations : []);
    }
    if (method === 'GET' && path === '/api/devices') {
      return json(this.devices[query.get('location$id')] ?? []);
    }
    const match = path.match(/^\/api\/device\/(\d+)\/(attribute|status|consumption\/hourly)$/);
    if (match) {
      const [, id, route] = match;
      if (this.deviceErrors[id]) {
        return json({ error: { code: this.deviceErrors[id] } });
      }
      if (route === 'attribute' && method === 'GET') {
        const names = (query.get('attributes') ?? '').split(',').filter(Boolean);
        if (names.length === 1 && names[0] === 'signature') {
          return json({ signature: this.signatures[id] });
        }
        const refused = this.unsupportedAttributes[id] ?? [];
        if (names.some((name) => refused.includes(name))) {
          return json({ error: { code: 'DVCATTRNSPTD' } });
        }
        const attributes = this.attributes[id] ?? {};
        return json(
          Object.fromEntries(names.filter((n) => n in attributes).map((n) => [n, attributes[n]])),
        );
      }
      if (route === 'attribute' && method === 'PUT') {
        this.writes.push({ id, values: body });
        Object.assign((this.attributes[id] ??= {}), body);
        return json({});
      }
      if (route === 'status') {
        return json(this.status[id] ?? {});
      }
      if (route === 'consumption/hourly') {
        // The last complete hours, oldest first, dated on the test clock.
        const values = this.hourly[id] ?? [];
        const currentHour = Math.floor(this.now() / HOUR_MS) * HOUR_MS;
        return json({
          history: values.map((period, index) => ({
            date: new Date(currentHour - (values.length - index) * HOUR_MS).toISOString(),
            period,
          })),
        });
      }
    }
    const mode = path.match(/^\/api\/location\/(\d+)\/mode$/);
    if (method === 'POST' && mode) {
      const location = this.locations.find((l) => String(l.id) === mode[1]);
      if (!location) {
        return json({ error: { code: 'SVCINVREQ' } });
      }
      location.mode = body.mode;
      return json({});
    }
    return json({ error: { code: 'SVCINVREQ' } }, 404);
  }
}

function json(value, status = 200, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const cookie of cookies) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(JSON.stringify(value), { status, headers });
}
