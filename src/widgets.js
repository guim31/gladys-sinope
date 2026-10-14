// -----------------------------------------------------------------------------
// The `thermostats` dashboard widget: every thermostat of the house on one
// card, its room temperature and setpoint, whether it heats, the Éco-Sinopé
// peak in progress, and the home/away mode of the Neviweb locations.
//
// A pure builder: src/app.js hands it what the hub read (no Neviweb request
// on a dashboard opening). Budget of the core: 8 components, 2 texts at most,
// one `status` list of 10 rows, 4 buttons. The current home/away mode is
// shown by the `check-circle` icon, never by the `primary` style, invisible in
// dark mode (Gladys#3153).
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { TEXT, pick } from './i18n.js';

export const WIDGET_KEY = 'thermostats';
export const WIDGET_ACTIONS = { HOME: 'mode_home', AWAY: 'mode_away' };

const MAX_ROWS = 10;

function formatTemperature(celsius, language, units) {
  const value = units === 'us' ? (celsius * 9) / 5 + 32 : celsius;
  const text = new Intl.NumberFormat(language, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(value);
  return `${text} ${units === 'us' ? '°F' : '°C'}`;
}

function row(thermostat, language, units) {
  const { states } = thermostat;
  const name = thermostat.name.length > 40 ? `${thermostat.name.slice(0, 39)}…` : thermostat.name;
  const temperature =
    typeof states.temperature === 'number'
      ? formatTemperature(states.temperature, language, units)
      : '–';
  let value;
  let color;
  if (!thermostat.reachable) {
    value = temperature;
    color = WIDGET_COLORS.DANGER;
  } else if (states.mode === 0) {
    value = `${temperature} · ${pick(TEXT.widgetOff, language)}`;
    color = WIDGET_COLORS.NEUTRAL;
  } else {
    const setpoint =
      typeof states.setpoint === 'number'
        ? formatTemperature(states.setpoint, language, units)
        : '–';
    const heating =
      typeof states.heating === 'number' && states.heating > 0 ? ` · ${states.heating} %` : '';
    value = `${temperature} → ${setpoint}${heating}`;
    color = states.operating_state === 1 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS;
  }
  return { label: name, value: value.slice(0, 40), icon: 'thermometer', color };
}

/**
 * @param {ReturnType<ReturnType<import('./hub.js').createHub>['snapshot']>} snapshot
 * @param {{ language?: string, units?: string, settings?: { thermostats?: string[] } }} [request]
 */
export function buildThermostatsContent(
  snapshot,
  { language = 'en', units = 'metric', settings = {} } = {},
) {
  if (!snapshot.configured) {
    return {
      ttl_seconds: 300,
      components: [{ type: 'text', variant: 'body', text: pick(TEXT.notConfigured, language) }],
    };
  }
  const chosen = Array.isArray(settings.thermostats) ? settings.thermostats : [];
  const thermostats = snapshot.thermostats.filter(
    (thermostat) => chosen.length === 0 || chosen.includes(thermostat.externalId),
  );
  const components = [];
  if (snapshot.peakActive) {
    components.push({ type: 'text', variant: 'heading', text: pick(TEXT.widgetPeak, language) });
  }
  if (thermostats.length === 0) {
    const text = snapshot.discovered ? TEXT.widgetNoThermostat : TEXT.widgetWaiting;
    components.push({ type: 'text', variant: 'body', text: pick(text, language) });
  } else {
    const sorted = [...thermostats].sort((a, b) => a.name.localeCompare(b.name, language));
    components.push({
      type: 'status',
      items: sorted.slice(0, MAX_ROWS).map((t) => row(t, language, units)),
    });
    if (sorted.length > MAX_ROWS) {
      components.push({ type: 'text', variant: 'caption', text: `+${sorted.length - MAX_ROWS}` });
    }
  }
  const modes = new Set(snapshot.locationModes);
  if (modes.size > 0) {
    const current = modes.size === 1 ? [...modes][0] : null;
    components.push(
      {
        type: 'button',
        label: pick(TEXT.widgetHome, language),
        icon: current === 'home' ? 'check-circle' : 'home',
        style: 'secondary',
        action: { key: WIDGET_ACTIONS.HOME },
      },
      {
        type: 'button',
        label: pick(TEXT.widgetAway, language),
        icon: current === 'away' ? 'check-circle' : 'log-out',
        style: 'secondary',
        action: { key: WIDGET_ACTIONS.AWAY, confirm: true },
      },
    );
  }
  return { ttl_seconds: 120, components };
}
