// -----------------------------------------------------------------------------
// Wires the Gladys SDK client to the Neviweb client and the hub. Every handler
// is registered here, before connect(); index.js only builds the SDK client.
// Tests call registerHandlers with the SDK's fake Gladys, a fake fetch and a
// temporary /data.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, isConfigured } from './config.js';
import { createNeviwebClient } from './neviweb/client.js';
import { createHub } from './hub.js';
import { Store } from './store.js';
import { MESSAGES, TEXT, errorStatus } from './i18n.js';
import { createSceneActions } from './scenes.js';
import { WIDGET_ACTIONS, WIDGET_KEY, buildThermostatsContent } from './widgets.js';

export const ACTIONS = { TEST_CONNECTION: 'test_connection' };

/**
 * @param {object} gladys GladysIntegration (or the SDK's fake Gladys)
 * @param {object} [options]
 * @param {Store} [options.store]
 * @param {typeof fetch} [options.fetch]
 * @param {() => number} [options.now]
 * @param {boolean} [options.timers] the reading timer (tests drive the cycles themselves)
 * @param {string} [options.baseUrl] Neviweb (a fake server in tests)
 */
export function registerHandlers(
  gladys,
  { store = new Store(), fetch, now, timers = true, baseUrl } = {},
) {
  const logger = createLogger({ name: 'sinope' });
  let config = normalizeConfig(gladys.config ?? {});

  const client = createNeviwebClient({
    getCredentials: () => ({ username: config.username, password: config.password }),
    store,
    fetch,
    now,
    baseUrl,
    logger: logger.child('neviweb'),
  });
  const hub = createHub({
    gladys,
    client,
    getConfig: () => config,
    store,
    logger,
    now,
    timers,
    onWidgetChange: () => gladys.requestWidgetRefresh(WIDGET_KEY),
  });
  const sceneActions = createSceneActions(hub);

  // --- Devices -----------------------------------------------------------------
  gladys.onScanRequest(() => hub.scan());
  gladys.onPoll((device) => hub.pollFromCore(device));
  gladys.onDeviceCreated((device) => hub.deviceAdded(device));
  gladys.onDeviceUpdated((device) => hub.deviceAdded(device));
  gladys.onSetValue((device, feature, value) => hub.setValue(device, feature, value));

  // --- Configuration action -----------------------------------------------------
  gladys.onAction(ACTIONS.TEST_CONNECTION, async () => {
    logger.info('Connection test requested');
    if (!isConfigured(config)) {
      return TEXT.notConfigured;
    }
    try {
      return MESSAGES.testResult(await hub.test());
    } catch (err) {
      logger.warn(`Connection test failed (${err.code ?? err.message})`);
      return errorStatus(err);
    }
  });

  // --- Scene actions ------------------------------------------------------------
  for (const [key, handler] of Object.entries(sceneActions)) {
    gladys.onSceneAction(key, async (fields) => {
      logger.info(`Scene action ${key}: ${fields?.mode ?? ''}`);
      return handler(fields);
    });
  }

  // --- Widget -------------------------------------------------------------------
  gladys.onWidgetGet(WIDGET_KEY, async ({ settings, language, units } = {}) =>
    buildThermostatsContent(hub.snapshot(), { settings, language, units }),
  );
  gladys.onWidgetAction(WIDGET_KEY, async (actionKey) => {
    const mode =
      actionKey === WIDGET_ACTIONS.AWAY
        ? 'away'
        : actionKey === WIDGET_ACTIONS.HOME
          ? 'home'
          : null;
    if (!mode) {
      throw new Error(`Unknown widget action ${actionKey}`);
    }
    logger.info(`Widget: ${mode} mode requested`);
    const count = await hub.setLocationMode(mode);
    return MESSAGES.locationMode(mode, count);
  });

  // --- Configuration and connection lifecycle -----------------------------------
  gladys.onConfigUpdated(async (raw) => {
    const previous = config;
    config = normalizeConfig(raw);
    logger.info('Configuration updated');
    const sameAccount =
      previous.username === config.username && previous.password === config.password;
    if (!sameAccount) {
      await hub.resetAccount();
    }
    await hub.restart({ fresh: true });
  });

  let firstConnection = true;
  const ready = new Promise((resolve) => {
    gladys.on('connected', async () => {
      try {
        config = normalizeConfig(await gladys.getConfig());
        if (!isConfigured(config)) {
          logger.info('Waiting for the Neviweb e-mail and password');
        }
        await hub.restart({ fresh: firstConnection });
        firstConnection = false;
      } catch (err) {
        logger.error('Initialization after connection failed', err);
        await gladys.setConnectionStatus(false, TEXT.initFailed).catch(() => {});
      } finally {
        resolve();
      }
    });
  });

  return {
    hub,
    client,
    ready,
    async stop() {
      hub.stop();
      await client.flush?.();
      await store.flush();
    },
  };
}
