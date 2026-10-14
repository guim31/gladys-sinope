// -----------------------------------------------------------------------------
// One Gladys device per Sinopé device: its features, the Neviweb attributes it
// reads, the states those attributes give, and the attributes a command
// writes. Pure functions only: src/hub.js does the requests.
//
// Neviweb returns the same notion in several shapes depending on the
// generation (a number, `{ value }`, `{ percent }`, `'on'`/`'off'`): the
// readers below accept them all, and publish nothing rather than a guess
// when a value is missing.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';
import { KINDS, PROTOCOLS, hasEnergyHistory, hasPeakStatus } from './neviweb/models.js';
import { NAMES } from './i18n.js';

// Gladys constants (server/utils/constants.js, Gladys 5.2): integer enums.
export const THERMOSTAT_MODE = { OFF: 0, HEATING: 1 };
export const THERMOSTAT_PRESET = { SCHEDULE: 0, FROST: 1, AWAY: 2, COMFORT: 5 };

// The Gladys scheduler polls once a minute at most: the container's own timer
// does the real pace (src/poller.js), onPoll is a fallback.
export const POLL_FREQUENCY = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES;

/** Every type namespace of the external ids: one, so a reclassification never changes an id. */
export const DEVICE_TYPE = 'neviweb';

// --- Readers -------------------------------------------------------------------

/** A finite number from `12.5`, `'12.5'`, `{ value: 12.5 }` or `{ percent: 12 }`. */
export function num(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === 'string' && raw.trim() !== '') {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }
  if (raw && typeof raw === 'object') {
    return num(raw.value ?? raw.percent);
  }
  return null;
}

/** 1/0 from `'on'`/`'off'`, a boolean or a number; null otherwise. */
export function onOff(raw) {
  if (raw === 'on' || raw === true) {
    return 1;
  }
  if (raw === 'off' || raw === false) {
    return 0;
  }
  const value = num(raw);
  return value === null ? null : value > 0 ? 1 : 0;
}

const round1 = (value) => (value === null ? null : Math.round(value * 10) / 10);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Whether the device is in an Éco-Sinopé event (`drStatus.drActive`). */
export function peakActive(data) {
  const status = data?.drStatus;
  if (!status || typeof status !== 'object') {
    return null;
  }
  return onOff(status.drActive);
}

// Alkaline AA cells: 3.0 V full, 2.0 V empty (two cells in series).
export function batteryPercent(voltage) {
  const value = num(voltage);
  if (value === null || value <= 0) {
    return null;
  }
  return Math.round(clamp((value - 2) / (3 - 2), 0, 1) * 100);
}

// --- Thermostats ---------------------------------------------------------------

// The attribute holding the operating mode, and the value of each mode.
const MODE_ATTRIBUTE = {
  [PROTOCOLS.MIWI]: 'setpointMode',
  [PROTOCOLS.ZIGBEE]: 'systemMode',
  [PROTOCOLS.WIFI]: 'setpointMode',
};
const MANUAL_MODE = {
  [PROTOCOLS.MIWI]: 'manual',
  [PROTOCOLS.ZIGBEE]: 'heat',
  [PROTOCOLS.WIFI]: 'manual',
};

/** Presets each generation can be set to (sinope-1 and sinope-130 services). */
const PRESETS = {
  [PROTOCOLS.MIWI]: ['SCHEDULE', 'COMFORT', 'AWAY', 'FROST'],
  [PROTOCOLS.ZIGBEE]: ['SCHEDULE', 'COMFORT'],
  [PROTOCOLS.WIFI]: ['SCHEDULE', 'COMFORT', 'AWAY'],
};

// The labels are a fallback: the Gladys front translates the values itself.
const PRESET_LABELS = { SCHEDULE: 'Schedule', FROST: 'Frost', AWAY: 'Away', COMFORT: 'Comfort' };

/** Bounds of the setpoint shown before the first reading (the device sends its own). */
function setpointBounds(info) {
  return info.variant === 'floor' ? { min: 5, max: 36 } : { min: 5, max: 30 };
}

/**
 * Mode and preset of a raw Neviweb mode.
 * @returns {{ mode: number|null, preset: number|null }}
 */
export function thermostatModes(rawMode, occupancy) {
  if (rawMode === 'off') {
    return { mode: THERMOSTAT_MODE.OFF, preset: null };
  }
  let preset;
  switch (rawMode) {
    case 'auto':
    case 'autoBypass':
      preset = THERMOSTAT_PRESET.SCHEDULE;
      break;
    case 'manual':
    case 'heat':
    case 'emergencyHeat':
      preset = THERMOSTAT_PRESET.COMFORT;
      break;
    case 'away':
      preset = THERMOSTAT_PRESET.AWAY;
      break;
    case 'frostProtection':
      preset = THERMOSTAT_PRESET.FROST;
      break;
    default:
      return { mode: null, preset: null };
  }
  // Wi-Fi thermostats keep their mode and add an occupancy.
  if (occupancy === 'away') {
    preset = THERMOSTAT_PRESET.AWAY;
  }
  return { mode: THERMOSTAT_MODE.HEATING, preset };
}

const thermostat = {
  features(info) {
    const bounds = setpointBounds(info);
    const presets = PRESETS[info.protocol];
    const features = [
      sensor('temperature', CATEGORIES.TEMPERATURE_SENSOR, TYPES.SENSOR.DECIMAL, {
        unit: UNITS.CELSIUS,
        min: -20,
        max: 50,
      }),
      {
        key: 'setpoint',
        category: CATEGORIES.THERMOSTAT,
        type: TYPES.THERMOSTAT.TARGET_TEMPERATURE,
        unit: UNITS.CELSIUS,
        read_only: false,
        has_feedback: true,
        keep_history: true,
        min: bounds.min,
        max: bounds.max,
        step: 0.5,
      },
      {
        key: 'mode',
        category: CATEGORIES.THERMOSTAT,
        type: TYPES.THERMOSTAT.MODE,
        read_only: false,
        has_feedback: true,
        keep_history: true,
        min: 0,
        max: 1,
        supported_options: [
          { value: THERMOSTAT_MODE.OFF, label: 'Off', sort_order: 0 },
          { value: THERMOSTAT_MODE.HEATING, label: 'Heating', sort_order: 1 },
        ],
      },
      {
        key: 'preset',
        category: CATEGORIES.THERMOSTAT,
        type: TYPES.THERMOSTAT.PRESET,
        read_only: false,
        has_feedback: true,
        keep_history: true,
        min: 0,
        max: 5,
        supported_options: presets.map((name, index) => ({
          value: THERMOSTAT_PRESET[name],
          label: PRESET_LABELS[name],
          sort_order: index,
        })),
      },
      sensor('operating_state', CATEGORIES.THERMOSTAT, TYPES.THERMOSTAT.OPERATING_STATE, {
        min: 0,
        max: 1,
      }),
      // No Gladys type is a heating demand in percent: a counter with a unit
      // shows the number as it is (the choice of guim31/gladys-pihole).
      sensor('heating', CATEGORIES.COUNTER_SENSOR, TYPES.SENSOR.INTEGER, {
        unit: UNITS.PERCENT,
        min: 0,
        max: 100,
      }),
    ];
    if (hasEnergyHistory(info)) {
      features.push(energyFeature());
    }
    return features;
  },

  attributes(info) {
    const core = [
      'roomTemperature',
      'roomSetpoint',
      'roomSetpointMin',
      'roomSetpointMax',
      MODE_ATTRIBUTE[info.protocol],
      'outputPercentDisplay',
    ];
    if (info.protocol === PROTOCOLS.WIFI) {
      core.push('occupancyMode');
    }
    return { core, optional: hasPeakStatus(info) ? ['drStatus'] : [] };
  },

  read(info, data) {
    const rawMode = data[MODE_ATTRIBUTE[info.protocol]];
    const { mode, preset } = thermostatModes(rawMode, data.occupancyMode);
    const percent = num(data.outputPercentDisplay);
    const heating = percent === null ? null : Math.round(clamp(percent, 0, 100));
    return {
      states: {
        temperature: round1(num(data.roomTemperature)),
        setpoint: num(data.roomSetpoint),
        mode,
        preset,
        operating_state:
          mode === THERMOSTAT_MODE.OFF ? 0 : heating === null ? null : heating > 0 ? 1 : 0,
        heating: mode === THERMOSTAT_MODE.OFF ? 0 : heating,
      },
      runtime: {
        rawMode: typeof rawMode === 'string' ? rawMode : null,
        occupancy: data.occupancyMode ?? null,
        setpointMin: num(data.roomSetpointMin),
        setpointMax: num(data.roomSetpointMax),
      },
      peak: peakActive(data),
    };
  },

  /**
   * @param {object} info classification
   * @param {string} key feature key
   * @param {number} value Gladys value
   * @param {object} runtime the last runtime read for this device (may be empty)
   * @returns {{ writes: object[], states: object }} attribute writes, in order,
   *   and the states they lead to
   */
  command(info, key, value, runtime = {}) {
    const modeAttribute = MODE_ATTRIBUTE[info.protocol];
    const manual = MANUAL_MODE[info.protocol];
    const leaveAway =
      info.protocol === PROTOCOLS.WIFI && runtime.occupancy === 'away'
        ? [{ occupancyMode: 'home' }]
        : [];
    switch (key) {
      case 'setpoint': {
        const bounds = setpointBounds(info);
        const min = runtime.setpointMin ?? bounds.min;
        const max = runtime.setpointMax ?? bounds.max;
        const setpoint = clamp(Math.round(Number(value) * 2) / 2, min, max);
        return { writes: [{ roomSetpoint: setpoint }], states: { setpoint } };
      }
      case 'mode': {
        if (Number(value) === THERMOSTAT_MODE.OFF) {
          return {
            writes: [{ [modeAttribute]: 'off' }],
            states: { mode: THERMOSTAT_MODE.OFF, operating_state: 0, heating: 0 },
          };
        }
        if (Number(value) !== THERMOSTAT_MODE.HEATING) {
          throw new Error(`Unsupported thermostat mode ${value}`);
        }
        // Back to the mode it had before being turned off, manual otherwise.
        const previous = runtime.lastActiveMode ?? manual;
        const { preset } = thermostatModes(previous, runtime.occupancy);
        return {
          writes: [{ [modeAttribute]: previous }],
          states: { mode: THERMOSTAT_MODE.HEATING, ...(preset === null ? {} : { preset }) },
        };
      }
      case 'preset': {
        const name = Object.keys(THERMOSTAT_PRESET).find(
          (p) => THERMOSTAT_PRESET[p] === Number(value),
        );
        if (!name || !PRESETS[info.protocol].includes(name)) {
          throw new Error(`Preset ${value} is not supported by this thermostat`);
        }
        const states = { mode: THERMOSTAT_MODE.HEATING, preset: THERMOSTAT_PRESET[name] };
        switch (name) {
          case 'SCHEDULE':
            return { writes: [...leaveAway, { [modeAttribute]: 'auto' }], states };
          case 'COMFORT':
            return { writes: [...leaveAway, { [modeAttribute]: manual }], states };
          case 'AWAY':
            return {
              writes:
                info.protocol === PROTOCOLS.WIFI
                  ? [
                      ...(runtime.rawMode === 'off' ? [{ setpointMode: manual }] : []),
                      { occupancyMode: 'away' },
                    ]
                  : [{ setpointMode: 'away' }],
              states,
            };
          default: // FROST, MiWi only
            return { writes: [{ setpointMode: 'frostProtection' }], states };
        }
      }
      default:
        throw new Error(`Feature ${key} is read-only`);
    }
  },
};

// --- Lights and dimmers -------------------------------------------------------

function lightBlueprint(dimmable) {
  return {
    features() {
      const features = [
        {
          key: 'light',
          category: CATEGORIES.LIGHT,
          type: TYPES.LIGHT.BINARY,
          read_only: false,
          has_feedback: true,
          keep_history: true,
          min: 0,
          max: 1,
        },
      ];
      if (dimmable) {
        features.push({
          key: 'brightness',
          category: CATEGORIES.LIGHT,
          type: TYPES.LIGHT.BRIGHTNESS,
          read_only: false,
          has_feedback: true,
          keep_history: true,
          min: 0,
          max: 100,
        });
      }
      return features;
    },

    attributes(info) {
      // MiWi: the intensity alone (0 = off). GT130: onOff, and the intensity of a dimmer.
      if (info.protocol === PROTOCOLS.MIWI) {
        return { core: ['intensity'], optional: [] };
      }
      return { core: dimmable ? ['onOff', 'intensity'] : ['onOff'], optional: [] };
    },

    read(info, data) {
      const intensity = num(data.intensity);
      const on =
        info.protocol === PROTOCOLS.MIWI
          ? intensity === null
            ? null
            : intensity > 0
              ? 1
              : 0
          : onOff(data.onOff);
      const states = { light: on };
      if (dimmable && intensity !== null && intensity > 0) {
        // The brightness of a light turned off is the one it comes back to.
        states.brightness = Math.round(clamp(intensity, 0, 100));
      }
      return { states, runtime: {}, peak: null };
    },

    command(info, key, value) {
      const level = Math.round(clamp(Number(value), 0, 100));
      if (key === 'light') {
        const on = Number(value) > 0;
        if (info.protocol === PROTOCOLS.MIWI) {
          // 101 brings a MiWi dimmer back to its last brightness.
          return {
            writes: [{ intensity: on ? (dimmable ? 101 : 100) : 0 }],
            states: { light: on ? 1 : 0 },
          };
        }
        return { writes: [{ onOff: on ? 'on' : 'off' }], states: { light: on ? 1 : 0 } };
      }
      if (key === 'brightness' && dimmable) {
        if (level === 0) {
          return this.command(info, 'light', 0);
        }
        if (info.protocol === PROTOCOLS.MIWI) {
          return { writes: [{ intensity: level }], states: { light: 1, brightness: level } };
        }
        return {
          writes: [{ onOff: 'on', intensity: level }],
          states: { light: 1, brightness: level },
        };
      }
      throw new Error(`Feature ${key} is read-only`);
    },
  };
}

// --- Load controllers, outlets, water heaters ---------------------------------

function loadBlueprint(waterHeater) {
  return {
    features(info) {
      const features = [
        {
          key: 'switch',
          category: CATEGORIES.SWITCH,
          type: TYPES.SWITCH.BINARY,
          read_only: false,
          has_feedback: true,
          keep_history: true,
          min: 0,
          max: 1,
        },
        sensor('power', CATEGORIES.SWITCH, TYPES.SWITCH.POWER, {
          unit: UNITS.WATT,
          min: 0,
          max: 12_000, // 50 A at 240 V
        }),
      ];
      if (waterHeater) {
        features.push(
          sensor('water_temperature', CATEGORIES.TEMPERATURE_SENSOR, TYPES.SENSOR.DECIMAL, {
            unit: UNITS.CELSIUS,
            min: 0,
            max: 100,
          }),
        );
        if (info.protocol === PROTOCOLS.ZIGBEE) {
          features.push(
            sensor('leak', CATEGORIES.LEAK_SENSOR, TYPES.SENSOR.BINARY, { min: 0, max: 1 }),
          );
        }
      }
      if (hasEnergyHistory(info)) {
        features.push(energyFeature());
      }
      return features;
    },

    attributes(info) {
      const optional = hasPeakStatus(info) ? ['drStatus'] : [];
      if (info.protocol === PROTOCOLS.MIWI) {
        return { core: ['intensity', 'wattageInstant'], optional };
      }
      if (!waterHeater) {
        return { core: ['onOff', 'wattageInstant'], optional };
      }
      if (info.protocol === PROTOCOLS.WIFI) {
        return { core: ['onOff', 'loadWattNow', 'waterTemperature'], optional };
      }
      return { core: ['onOff', 'wattageInstant', 'roomTemperature', 'waterLeakStatus'], optional };
    },

    read(info, data) {
      const states = {
        switch: info.protocol === PROTOCOLS.MIWI ? onOff(num(data.intensity)) : onOff(data.onOff),
        power: num(
          info.protocol === PROTOCOLS.WIFI && waterHeater ? data.loadWattNow : data.wattageInstant,
        ),
      };
      if (waterHeater) {
        states.water_temperature = round1(
          num(info.protocol === PROTOCOLS.WIFI ? data.waterTemperature : data.roomTemperature),
        );
        if (info.protocol === PROTOCOLS.ZIGBEE) {
          states.leak = leakState(data.waterLeakStatus);
        }
      }
      return { states, runtime: {}, peak: peakActive(data) };
    },

    command(info, key, value) {
      if (key !== 'switch') {
        throw new Error(`Feature ${key} is read-only`);
      }
      const on = Number(value) > 0;
      const writes =
        info.protocol === PROTOCOLS.MIWI
          ? [{ intensity: on ? 100 : 0 }]
          : [{ onOff: on ? 'on' : 'off' }];
      return { writes, states: { switch: on ? 1 : 0, ...(on ? {} : { power: 0 }) } };
    },
  };
}

/** `water` is a leak, `ok` is dry, `probe` (disconnected probe) is unknown. */
function leakState(raw) {
  if (raw === 'water' || raw === 'leak') {
    return 1;
  }
  if (raw === 'ok') {
    return 0;
  }
  return null;
}

// --- Water leak detectors -----------------------------------------------------

const leakDetector = {
  features() {
    return [
      sensor('leak', CATEGORIES.LEAK_SENSOR, TYPES.SENSOR.BINARY, { min: 0, max: 1 }),
      sensor('battery', CATEGORIES.BATTERY, TYPES.BATTERY.INTEGER, {
        unit: UNITS.PERCENT,
        min: 0,
        max: 100,
      }),
      sensor('temperature', CATEGORIES.TEMPERATURE_SENSOR, TYPES.SENSOR.DECIMAL, {
        unit: UNITS.CELSIUS,
        min: -20,
        max: 50,
      }),
    ];
  },

  attributes() {
    return { core: ['waterLeakStatus', 'roomTemperature', 'batteryVoltage'], optional: [] };
  },

  read(_info, data) {
    return {
      states: {
        leak: leakState(data.waterLeakStatus),
        battery: batteryPercent(data.batteryVoltage),
        temperature: round1(num(data.roomTemperature)),
      },
      runtime: {},
      peak: null,
    };
  },

  command(_info, key) {
    throw new Error(`Feature ${key} is read-only`);
  },
};

// --- Gateways -----------------------------------------------------------------

const gateway = {
  features() {
    // No Gladys type says "connected": a read-only input, 1 = online.
    return [sensor('online', CATEGORIES.INPUT, TYPES.INPUT.BINARY, { min: 0, max: 1 })];
  },

  // Read through the status endpoint, not the attributes (see src/hub.js).
  attributes() {
    return { core: [], optional: [] };
  },

  read(_info, status) {
    const raw = typeof status?.status === 'string' ? status.status.toLowerCase() : null;
    return {
      states: { online: raw === null ? null : raw === 'online' ? 1 : 0 },
      runtime: {},
      peak: null,
    };
  },

  command(_info, key) {
    throw new Error(`Feature ${key} is read-only`);
  },
};

// --- Registry -----------------------------------------------------------------

export const BLUEPRINTS = {
  [KINDS.THERMOSTAT]: thermostat,
  [KINDS.LIGHT]: lightBlueprint(false),
  [KINDS.DIMMER]: lightBlueprint(true),
  [KINDS.LOAD]: loadBlueprint(false),
  [KINDS.WATER_HEATER]: loadBlueprint(true),
  [KINDS.LEAK]: leakDetector,
  [KINDS.GATEWAY]: gateway,
};

function sensor(key, category, type, extra) {
  return {
    key,
    category,
    type,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    ...extra,
  };
}

// Fed by publishEnergyConsumption with Neviweb's hourly history (src/energy.js),
// never by publishStates.
function energyFeature() {
  return sensor(
    'energy',
    CATEGORIES.ENERGY_SENSOR,
    TYPES.ENERGY_SENSOR.THIRTY_MINUTES_CONSUMPTION,
    {
      unit: UNITS.KILOWATT_HOUR,
      min: 0,
      max: 100,
    },
  );
}

/** The ids of one Neviweb device. */
export function deviceIds(gladys, neviwebId) {
  return gladys.externalIds(DEVICE_TYPE, String(neviwebId));
}

/**
 * The Gladys device of one catalog entry.
 * @param {object} gladys the SDK client (for the external ids)
 * @param {{ id: string|number, name?: string, sku?: string, location: { name: string },
 *   info: object }} entry
 * @param {string} language feature names
 */
export function buildDevice(gladys, entry, language) {
  const ids = deviceIds(gladys, entry.id);
  const names = NAMES[language] ?? NAMES.en;
  const blueprint = BLUEPRINTS[entry.info.kind];
  const name = String(entry.name ?? '').trim() || entry.sku || `Sinopé ${entry.info.model}`;
  return {
    name,
    external_id: ids.device,
    should_poll: true,
    poll_frequency: POLL_FREQUENCY,
    features: blueprint.features(entry.info).map(({ key, ...feature }) => ({
      ...feature,
      name: names[key],
      external_id: ids.feature(key),
    })),
    params: [
      { name: 'NEVIWEB_ID', value: String(entry.id) },
      { name: 'MODEL', value: String(entry.sku || entry.info.model) },
      { name: 'LOCATION', value: String(entry.location?.name ?? '') },
    ],
  };
}

/** The feature key of a feature external id, under its device. */
export function featureKey(deviceExternalId, featureExternalId) {
  const prefix = `${deviceExternalId}:`;
  return featureExternalId.startsWith(prefix) ? featureExternalId.slice(prefix.length) : null;
}
