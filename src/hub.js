// -----------------------------------------------------------------------------
// The hub: what the integration knows of the Neviweb account, and every
// exchange with it.
//
//   - Discovery: locations → devices → signature of each device (asked once,
//     kept in /data) → one Gladys device per supported Sinopé device.
//   - Reading: its own timer, every 5 minutes by default, reads the devices
//     the user ADDED to Gladys, one request at a time (the client queues
//     them). The core cannot be trusted to poll (GladysAssistant/Gladys#3198,
//     not fixed in 5.2.1): onPoll is only a fallback, skipped while the timer
//     runs. A device polled less than half a period ago is skipped, so the
//     two never read the same device twice.
//   - Energy: once an hour per device, the hourly history (src/energy.js).
//   - Éco-Sinopé: the peak status of the devices, turned into the
//     `peak_period_started` / `peak_period_ended` scene triggers.
//   - Commands: the attribute writes of src/devices.js, then a reading of the
//     device a little later, to show what Neviweb really applied.
//
// Logs at info: the lifecycle only (connection, a device lost and back, the
// user's commands, the peak events). A normal reading writes at debug.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import {
  BLUEPRINTS,
  POLL_FREQUENCY,
  buildDevice,
  deviceIds,
  featureKey,
  THERMOSTAT_MODE,
} from './devices.js';
import { hourlyToIntervals } from './energy.js';
import { createIssueLog } from './issues.js';
import { MESSAGES, TEXT, errorStatus } from './i18n.js';
import { KINDS, classify, hasEnergyHistory } from './neviweb/models.js';
import { NeviwebError } from './neviweb/client.js';
import { isConfigured, matchesLocation } from './config.js';

export const SCENE_TRIGGERS = {
  PEAK_STARTED: 'peak_period_started',
  PEAK_ENDED: 'peak_period_ended',
};

// Gladys shows "no recent value" past 48 h: an unchanged value is sent again
// well before.
export const HEARTBEAT_MS = 6 * 60 * 60_000;
export const ENERGY_PERIOD_MS = 60 * 60_000;
export const REDISCOVERY_MS = 6 * 60 * 60_000;
export const CONFIRM_DELAY_MS = 15_000;

/**
 * @param {object} options
 * @param {object} options.gladys the SDK client (or its fake)
 * @param {ReturnType<import('./neviweb/client.js').createNeviwebClient>} options.client
 * @param {() => object} options.getConfig the current normalized config
 * @param {import('./store.js').Store} options.store
 * @param {{ debug: Function, info: Function, warn: Function, error: Function }} options.logger
 * @param {() => number} [options.now]
 * @param {boolean} [options.timers] run the reading timer and the delayed confirmations
 * @param {(key: string) => void} [options.onWidgetChange] something the widget shows changed
 */
export function createHub({
  gladys,
  client,
  getConfig,
  store,
  logger,
  now = () => Date.now(),
  timers = true,
  onWidgetChange = () => {},
}) {
  const issues = createIssueLog(logger);

  /** Supported devices of the account, by Gladys external id. */
  let catalog = new Map();
  let unsupported = [];
  let locations = [];
  let discoveredAt = null;
  let discovering = null;

  const runtime = new Map(); // external id → last runtime values (thermostats)
  const states = new Map(); // external id → last states read
  const peaks = new Map(); // external id → 0|1
  let peakActive = null; // null until a first complete cycle
  const lastPolledAt = new Map();
  const energyReadAt = new Map();
  const transports = new Map(); // external id → transport published
  const optionalOff = new Set(); // devices whose firmware refused an optional attribute
  let connectionOk = null;

  let timer = null;
  let stopped = true;
  let cycle = null;
  const confirmations = new Set();

  const periodMs = () => getConfig().pollIntervalMs;

  // --- Connection status ------------------------------------------------------

  async function setStatus(ok, message) {
    const key = ok ? 'ok' : JSON.stringify(message);
    if (connectionOk === key) {
      return;
    }
    connectionOk = key;
    await gladys.setConnectionStatus(ok, ok ? undefined : message).catch(() => {});
  }

  /** An account-level failure: logged once, shown in the Configuration screen. */
  async function accountFailed(err) {
    issues.fail('account', `Neviweb: ${err.message} (${err.code ?? 'error'})`);
    await setStatus(false, errorStatus(err));
  }

  async function accountOk() {
    issues.ok('account', 'Neviweb answers again');
    await setStatus(true);
  }

  // --- Discovery ----------------------------------------------------------------

  async function readSignatures(devices) {
    const cache = (await store.readJson('signatures.json')) ?? {};
    let changed = false;
    for (const device of devices) {
      const id = String(device.id);
      if (cache[id] === undefined) {
        try {
          cache[id] = (await client.getSignature(id)) ?? null;
        } catch (err) {
          if (!(err instanceof NeviwebError) || !err.isDeviceError) {
            throw err;
          }
          // Asked again at the next discovery.
          logger.debug(`Signature of Neviweb device ${id} unavailable (${err.code})`);
          continue;
        }
        changed = true;
      }
    }
    if (changed) {
      await store.writeJson('signatures.json', cache);
    }
    return cache;
  }

  async function runDiscovery() {
    const config = getConfig();
    const all = await client.getLocations();
    locations = all
      .filter((location) => matchesLocation(config.locations, location.name))
      .map((location) => ({
        id: location.id,
        name: String(location.name ?? location.id),
        mode: location.mode,
      }));
    if (locations.length === 0) {
      throw new NeviwebError('NO_LOCATION', 'No Neviweb location matches the configuration');
    }

    const next = new Map();
    const others = [];
    for (const location of locations) {
      const devices = await client.getDevices(location.id);
      const signatures = await readSignatures(devices);
      for (const device of devices) {
        const signature = signatures[String(device.id)];
        const info = classify(signature);
        if (!info) {
          if (signature !== undefined) {
            others.push(`${device.name ?? device.id} (${device.sku ?? signature?.model ?? '?'})`);
          }
          continue;
        }
        const externalId = deviceIds(gladys, device.id).device;
        next.set(externalId, {
          id: String(device.id),
          name: device.name,
          sku: device.sku,
          location,
          info,
          externalId,
        });
      }
    }
    catalog = next;
    unsupported = others;
    discoveredAt = now();
    if (others.length > 0) {
      logger.debug(`Neviweb devices not supported: ${others.join(', ')}`);
    }
    await publishDevices();
    return {
      locations: locations.map((l) => l.name),
      supported: catalog.size,
      unsupported: others,
    };
  }

  async function publishDevices() {
    const { language } = getConfig();
    const devices = [...catalog.values()].map((entry) => buildDevice(gladys, entry, language));
    try {
      await gladys.publishDiscoveredDevices(devices);
    } catch (err) {
      await setStatus(false, MESSAGES.publishFailed(err.message));
      throw err;
    }
  }

  /** One discovery at a time; callers in the meantime share it. */
  function discover() {
    if (!discovering) {
      discovering = runDiscovery().finally(() => {
        discovering = null;
      });
    }
    return discovering;
  }

  // --- Reading ------------------------------------------------------------------

  /** Catalog entries of the devices the user added to Gladys. */
  function createdEntries() {
    const created = new Set((gladys.devices ?? []).map((device) => device.external_id));
    return [...catalog.values()].filter((entry) => created.has(entry.externalId));
  }

  async function readEntry(entry) {
    const blueprint = BLUEPRINTS[entry.info.kind];
    if (entry.info.kind === KINDS.GATEWAY) {
      return blueprint.read(entry.info, await client.getStatus(entry.id));
    }
    const { core, optional } = blueprint.attributes(entry.info);
    const withOptional = optional.length > 0 && !optionalOff.has(entry.externalId);
    try {
      const data = await client.getAttributes(
        entry.id,
        withOptional ? [...core, ...optional] : core,
      );
      return blueprint.read(entry.info, data ?? {});
    } catch (err) {
      if (!withOptional || err.code !== 'DVCATTRNSPTD') {
        throw err;
      }
      // An older firmware without the Éco-Sinopé status: read without it from now on.
      optionalOff.add(entry.externalId);
      logger.debug(`${entry.name}: ${optional.join(', ')} not supported, read without`);
      return blueprint.read(entry.info, (await client.getAttributes(entry.id, core)) ?? {});
    }
  }

  async function publishStates(entry, values) {
    const ids = deviceIds(gladys, entry.id);
    const list = Object.entries(values)
      .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
      .map(([key, value]) => ({ device_feature_external_id: ids.feature(key), state: value }));
    if (list.length > 0) {
      await gladys.publishChangedStates(list, { heartbeat: HEARTBEAT_MS });
    }
  }

  function remember(entry, result) {
    const previous = states.get(entry.externalId) ?? {};
    const merged = { ...previous };
    for (const [key, value] of Object.entries(result.states)) {
      if (value !== null && value !== undefined) {
        merged[key] = value;
      }
    }
    states.set(entry.externalId, merged);
    if (Object.keys(result.runtime ?? {}).length > 0) {
      const before = runtime.get(entry.externalId) ?? {};
      const raw = result.runtime.rawMode;
      runtime.set(entry.externalId, {
        ...before,
        ...result.runtime,
        lastActiveMode: raw && raw !== 'off' ? raw : before.lastActiveMode,
      });
    }
    if (result.peak !== null && result.peak !== undefined) {
      peaks.set(entry.externalId, result.peak);
    }
    return JSON.stringify(previous) !== JSON.stringify(merged);
  }

  /**
   * Read one device and publish what it says. Device errors are logged once
   * and turn its transport badge to unreachable; account errors are thrown.
   * @returns {Promise<boolean>} whether a state the widget shows changed
   */
  async function pollEntry(entry) {
    lastPolledAt.set(entry.externalId, now());
    let result;
    try {
      result = await readEntry(entry);
    } catch (err) {
      if (err instanceof NeviwebError && err.isDeviceError) {
        issues.fail(
          `device:${entry.id}`,
          `${entry.name}: Neviweb cannot reach the device (${err.code})`,
        );
        transports.set(entry.externalId, DEVICE_TRANSPORTS.UNREACHABLE);
        return false;
      }
      throw err;
    }
    issues.ok(`device:${entry.id}`, `${entry.name}: answers again`);
    transports.set(entry.externalId, DEVICE_TRANSPORTS.CLOUD);
    const changed = remember(entry, result);
    await publishStates(entry, result.states);
    logger.debug(`${entry.name}: read ${JSON.stringify(result.states)}`);
    return changed && entry.info.kind === KINDS.THERMOSTAT;
  }

  let publishedTransports = new Map();
  async function publishTransports() {
    const changed = [...transports.entries()]
      .filter(([id, transport]) => publishedTransports.get(id) !== transport)
      .map(([external_id, transport]) => ({ external_id, transport }));
    for (let i = 0; i < changed.length; i += 100) {
      await gladys.publishTransports(changed.slice(i, i + 100));
    }
    publishedTransports = new Map(transports);
  }

  async function readEnergy(entries, { force = false } = {}) {
    const created = new Map((gladys.devices ?? []).map((device) => [device.external_id, device]));
    for (const entry of entries) {
      if (!hasEnergyHistory(entry.info)) {
        continue;
      }
      const featureId = deviceIds(gladys, entry.id).feature('energy');
      const device = created.get(entry.externalId);
      // A device created before the feature existed, or updated without it.
      if (!device?.features?.some((feature) => feature.external_id === featureId)) {
        continue;
      }
      const last = energyReadAt.get(entry.externalId);
      if (!force && last !== undefined && now() - last < ENERGY_PERIOD_MS) {
        continue;
      }
      energyReadAt.set(entry.externalId, now());
      try {
        const intervals = hourlyToIntervals(await client.getHourlyConsumption(entry.id), now());
        if (intervals.length > 0) {
          const { changed_from: changedFrom } = await gladys.publishEnergyConsumption(
            featureId,
            intervals,
          );
          logger.debug(
            `${entry.name}: ${intervals.length} half-hours of consumption, changed from ${changedFrom}`,
          );
        }
        issues.ok(`energy:${entry.id}`, `${entry.name}: consumption history available again`);
      } catch (err) {
        if (err instanceof NeviwebError && !err.isDeviceError && err.code !== 'SVCERR') {
          throw err;
        }
        issues.fail(
          `energy:${entry.id}`,
          `${entry.name}: consumption history unavailable (${err.code ?? err.message})`,
        );
      }
    }
  }

  async function updatePeak(entries) {
    const tracked = entries.filter((entry) => peaks.has(entry.externalId));
    if (tracked.length === 0) {
      return false;
    }
    const inPeak = tracked.filter((entry) => peaks.get(entry.externalId) === 1).length;
    const active = inPeak > 0;
    if (peakActive === null) {
      // The first cycle only sets the baseline: a restart in the middle of a
      // peak does not fire "started" a second time.
      peakActive = active;
      return active;
    }
    if (active === peakActive) {
      return false;
    }
    peakActive = active;
    const key = active ? SCENE_TRIGGERS.PEAK_STARTED : SCENE_TRIGGERS.PEAK_ENDED;
    logger.info(
      active
        ? `Éco-Sinopé peak period started (${inPeak} device(s))`
        : 'Éco-Sinopé peak period ended',
    );
    try {
      await gladys.publishSceneEvent(key, { devices: inPeak });
    } catch (err) {
      logger.warn(`Scene trigger ${key} refused by Gladys (${err.message})`);
    }
    return true;
  }

  async function refreshLocations() {
    const config = getConfig();
    const all = await client.getLocations();
    let changed = false;
    locations = all
      .filter((location) => matchesLocation(config.locations, location.name))
      .map((location) => {
        const previous = locations.find((l) => String(l.id) === String(location.id));
        if (previous?.mode !== location.mode) {
          changed = true;
        }
        return { id: location.id, name: String(location.name ?? location.id), mode: location.mode };
      });
    return changed;
  }

  /** One complete reading of the account. Errors are logged, never thrown. */
  async function runCycle({ force = false } = {}) {
    const config = getConfig();
    if (!isConfigured(config)) {
      await setStatus(false, TEXT.notConfigured);
      return;
    }
    if (gladys.connected === false) {
      logger.debug('Gladys unreachable: reading skipped');
      return;
    }
    if (client.isBlocked()) {
      logger.debug('Neviweb refused the credentials: reading skipped until they change');
      return;
    }
    try {
      let widgetChanged = false;
      if (discoveredAt === null || now() - discoveredAt >= REDISCOVERY_MS) {
        await discover(); // reads the locations too
      } else {
        widgetChanged = await refreshLocations();
      }
      const entries = createdEntries();
      for (const entry of entries) {
        const last = lastPolledAt.get(entry.externalId);
        if (!force && last !== undefined && now() - last < periodMs() * 0.5) {
          continue;
        }
        if (await pollEntry(entry)) {
          widgetChanged = true;
        }
      }
      await publishTransports();
      await readEnergy(entries);
      if (await updatePeak(entries)) {
        widgetChanged = true;
      }
      await accountOk();
      issues.ok('cycle', 'Reading cycle works again');
      if (widgetChanged) {
        onWidgetChange();
      }
    } catch (err) {
      if (err instanceof NeviwebError) {
        await accountFailed(err);
      } else {
        // Gladys refusing the states (429, disconnected...): said once.
        issues.fail('cycle', `Reading cycle failed: ${err.message}`);
      }
    }
  }

  /** The cycle in progress, or a new one. */
  function pollAll(options) {
    if (!cycle) {
      cycle = runCycle(options).finally(() => {
        cycle = null;
      });
    }
    return cycle;
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    if (!timers || stopped) {
      return;
    }
    timer = setTimeout(async () => {
      timer = null;
      await pollAll();
      schedule();
    }, periodMs());
    timer.unref?.();
  }

  /** Read one device now (fallback onPoll, device just created, confirmation). */
  async function pollOne(externalId, { minGap = 0 } = {}) {
    const entry = catalog.get(externalId);
    if (!entry || client.isBlocked() || !isConfigured(getConfig())) {
      return;
    }
    const last = lastPolledAt.get(externalId);
    if (minGap > 0 && last !== undefined && now() - last < periodMs() * minGap) {
      logger.debug(`${entry.name}: read ${now() - last} ms ago, poll skipped`);
      return;
    }
    try {
      const changed = await pollEntry(entry);
      await publishTransports();
      if (changed) {
        onWidgetChange();
      }
    } catch (err) {
      if (err instanceof NeviwebError) {
        await accountFailed(err);
        return;
      }
      throw err;
    }
  }

  // --- API ------------------------------------------------------------------

  return {
    SCENE_TRIGGERS,

    /**
     * (Re)start. A new configuration reads everything again (`fresh`). A
     * reconnection to Gladys only publishes the known devices again (the
     * Discovery list lives in the memory of the core) and reads the devices
     * not read for half a period: a flapping connection never floods Neviweb.
     */
    async restart({ fresh = true } = {}) {
      stopped = false;
      if (fresh) {
        lastPolledAt.clear();
        discoveredAt = null;
      } else if (catalog.size > 0) {
        await publishDevices().catch((err) =>
          logger.warn(`Publishing the devices failed: ${err.message}`),
        );
      }
      schedule();
      await pollAll({ force: fresh });
    },

    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
      for (const confirmation of confirmations) {
        clearTimeout(confirmation);
      }
      confirmations.clear();
    },

    /** A configuration with another account: forget everything of the previous one. */
    async resetAccount() {
      catalog = new Map();
      unsupported = [];
      locations = [];
      discoveredAt = null;
      runtime.clear();
      states.clear();
      peaks.clear();
      peakActive = null;
      energyReadAt.clear();
      transports.clear();
      publishedTransports = new Map();
      optionalOff.clear();
      connectionOk = null;
      await client.reset();
    },

    pollAll,

    /** The Discovery tab asks for the devices. */
    async scan() {
      const config = getConfig();
      if (!isConfigured(config)) {
        await setStatus(false, TEXT.notConfigured);
        return;
      }
      try {
        await discover();
        await accountOk();
      } catch (err) {
        if (err instanceof NeviwebError) {
          await accountFailed(err);
          return;
        }
        throw err;
      }
    },

    /** The core's onPoll: read unless the timer just did. */
    async pollFromCore(device) {
      await pollOne(device.external_id, { minGap: 0.9 });
    },

    /** A device was added or updated in Gladys: everything again, now. */
    async deviceAdded(device) {
      const entry = catalog.get(device.external_id);
      if (!entry) {
        return;
      }
      energyReadAt.delete(entry.externalId);
      await pollOne(device.external_id);
      try {
        await readEnergy([entry], { force: true });
      } catch (err) {
        if (err instanceof NeviwebError) {
          await accountFailed(err);
        }
      }
      onWidgetChange();
    },

    /** The user commands a feature. */
    async setValue(device, feature, value) {
      if (catalog.size === 0) {
        await discover();
      }
      const entry = catalog.get(device.external_id);
      if (!entry) {
        throw new Error(`Unknown Neviweb device ${device.external_id}`);
      }
      const key = featureKey(entry.externalId, feature.external_id);
      const blueprint = BLUEPRINTS[entry.info.kind];
      const { writes, states: expected } = blueprint.command(
        entry.info,
        key,
        value,
        runtime.get(entry.externalId) ?? {},
      );
      logger.info(`Command: ${entry.name} ${key} → ${value}`);
      if (
        entry.info.kind === KINDS.THERMOSTAT &&
        key === 'mode' &&
        Number(value) === THERMOSTAT_MODE.OFF
      ) {
        logger.info(`${entry.name}: heating stopped until the thermostat is turned back on`);
      }
      try {
        for (const write of writes) {
          await client.setAttributes(entry.id, write);
        }
      } catch (err) {
        logger.warn(`Command refused: ${entry.name} ${key} (${err.code ?? err.message})`);
        throw new Error(err instanceof NeviwebError ? `Neviweb: ${err.code}` : err.message, {
          cause: err,
        });
      }
      // What the writes changed, until the confirmation reading says it.
      const written = Object.assign({}, ...writes);
      const after = {};
      if (typeof (written.setpointMode ?? written.systemMode) === 'string') {
        after.rawMode = written.setpointMode ?? written.systemMode;
      }
      if (typeof written.occupancyMode === 'string') {
        after.occupancy = written.occupancyMode;
      }
      remember(entry, { states: expected, runtime: after, peak: null });
      await publishStates(entry, expected);
      onWidgetChange();
      if (timers && !stopped) {
        // Neviweb applies the command in a few seconds: read what it did.
        const confirmation = setTimeout(() => {
          confirmations.delete(confirmation);
          pollOne(entry.externalId).catch((err) =>
            logger.debug(`Confirmation read failed: ${err.message}`),
          );
        }, CONFIRM_DELAY_MS);
        confirmation.unref?.();
        confirmations.add(confirmation);
      }
    },

    /** The connection test: a discovery, with one more login attempt if needed. */
    async test() {
      client.unblock();
      const report = await discover();
      await accountOk();
      return { ...report, requests: await client.requestsToday() };
    },

    /** Home or away on every location of the configuration. */
    async setLocationMode(mode) {
      if (locations.length === 0) {
        await discover();
      }
      for (const location of locations) {
        await client.setLocationMode(location.id, mode);
        location.mode = mode;
      }
      logger.info(`Neviweb ${mode} mode set on ${locations.length} location(s)`);
      onWidgetChange();
      return locations.length;
    },

    /** What the widget shows. */
    snapshot() {
      const thermostats = createdEntries()
        .filter((entry) => entry.info.kind === KINDS.THERMOSTAT)
        .map((entry) => ({
          externalId: entry.externalId,
          name:
            (gladys.devices ?? []).find((d) => d.external_id === entry.externalId)?.name ??
            entry.name,
          states: states.get(entry.externalId) ?? {},
          reachable: transports.get(entry.externalId) !== DEVICE_TRANSPORTS.UNREACHABLE,
        }));
      return {
        configured: isConfigured(getConfig()),
        discovered: discoveredAt !== null,
        thermostats,
        peakActive: peakActive === true,
        locationModes: locations.map((location) => location.mode).filter(Boolean),
      };
    },

    /** For tests and diagnosis. */
    catalog: () => catalog,
    unsupported: () => unsupported,
    POLL_FREQUENCY,
  };
}
