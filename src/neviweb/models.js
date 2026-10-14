// -----------------------------------------------------------------------------
// Which Sinopé device a Neviweb device is.
//
// Neviweb lists the devices of a location without saying what they are: the
// `signature` attribute of each one does (`protocol`, `model`, and `type` on
// the first-generation devices). Three generations coexist, each with its own
// attribute names:
//
//   - `miwi`: the first generation, behind a GT125 gateway (TH1120RF,
//     SW2500RF, RM3250RF...). Classified by `signature.type`, because the
//     MiWi model numbers overlap the Zigbee ones (1123 is both a TH1121RF and
//     a TH1123ZB).
//   - `zigbee`: behind a GT130 gateway (TH1123ZB, DM2500ZB, WL4200...).
//   - `wifi`: the devices that talk to Neviweb on their own (TH1124WF,
//     RM3250WF...).
//
// The model numbers come from the documentation of the HACS integrations
// claudegel/sinope-1 and claudegel/sinope-130 (read, not copied: GPL-3.0).
// Heat pumps, heat/cool thermostats (TH6xxxWF, TH1134ZB-HC), Sedna valves,
// tank monitors and multi-controllers are left out on purpose: their
// attributes differ again and nobody could test them (see the documentation).
// -----------------------------------------------------------------------------

export const PROTOCOLS = { MIWI: 'miwi', ZIGBEE: 'zigbee', WIFI: 'wifi' };

export const KINDS = {
  THERMOSTAT: 'thermostat',
  LIGHT: 'light',
  DIMMER: 'dimmer',
  LOAD: 'load',
  WATER_HEATER: 'water_heater',
  LEAK: 'leak',
  GATEWAY: 'gateway',
};

// MiWi `signature.type` → kind (sinope-1: climate.py, light.py, switch.py).
const MIWI_TYPES = {
  10: { kind: KINDS.THERMOSTAT, variant: 'baseboard' }, // TH1120RF, TH1121RF, OTH2750-GT…
  20: { kind: KINDS.THERMOSTAT, variant: 'floor' }, // TH1300RF, TH1500RF, FLP45…
  21: { kind: KINDS.THERMOSTAT, variant: 'low_voltage' }, // TH1400RF
  102: { kind: KINDS.LIGHT },
  112: { kind: KINDS.DIMMER },
  120: { kind: KINDS.LOAD }, // RM3250RF, RM3200RF
};

// GT125, the MiWi gateway, is known by its model.
const MIWI_GATEWAY_MODEL = 125;

// Zigbee (GT130) and Wi-Fi `signature.model` → kind (sinope-130).
const MODELS = {
  // Zigbee thermostats
  1123: { kind: KINDS.THERMOSTAT, protocol: PROTOCOLS.ZIGBEE, variant: 'baseboard' }, // TH1123ZB
  1124: { kind: KINDS.THERMOSTAT, protocol: PROTOCOLS.ZIGBEE, variant: 'baseboard' }, // TH1124ZB, OTH4000-ZB
  300: { kind: KINDS.THERMOSTAT, protocol: PROTOCOLS.ZIGBEE, variant: 'baseboard' }, // TH112xZB-G2
  737: { kind: KINDS.THERMOSTAT, protocol: PROTOCOLS.ZIGBEE, variant: 'floor' }, // TH1300ZB, TH1320ZB-04, OTH3600-GA-ZB
  7373: { kind: KINDS.THERMOSTAT, protocol: PROTOCOLS.ZIGBEE, variant: 'baseboard' }, // TH1500ZB
  7372: { kind: KINDS.THERMOSTAT, protocol: PROTOCOLS.ZIGBEE, variant: 'low_voltage' }, // TH1400ZB, TH1420ZB-01
  // Wi-Fi thermostats
  1510: { kind: KINDS.THERMOSTAT, protocol: PROTOCOLS.WIFI, variant: 'baseboard' }, // TH1123WF, TH1124WF
  742: { kind: KINDS.THERMOSTAT, protocol: PROTOCOLS.WIFI, variant: 'baseboard' }, // TH1500WF
  336: { kind: KINDS.THERMOSTAT, protocol: PROTOCOLS.WIFI, variant: 'baseboard' }, // TH1133WF, TH1134WF
  343: { kind: KINDS.THERMOSTAT, protocol: PROTOCOLS.WIFI, variant: 'baseboard' }, // THEWF01
  348: { kind: KINDS.THERMOSTAT, protocol: PROTOCOLS.WIFI, variant: 'baseboard' }, // TH1133CR, TH1134CR
  350: { kind: KINDS.THERMOSTAT, protocol: PROTOCOLS.WIFI, variant: 'baseboard' }, // TH1143WF, TH1144WF
  354: { kind: KINDS.THERMOSTAT, protocol: PROTOCOLS.WIFI, variant: 'baseboard' }, // TH1145WF
  738: { kind: KINDS.THERMOSTAT, protocol: PROTOCOLS.WIFI, variant: 'floor' }, // TH1300WF, TH13x0WF, SRM40, FLP55
  739: { kind: KINDS.THERMOSTAT, protocol: PROTOCOLS.WIFI, variant: 'low_voltage' }, // TH1400WF
  // Zigbee lighting (the -VA variants are the same switch paired to a Sedna valve)
  2121: { kind: KINDS.LIGHT, protocol: PROTOCOLS.ZIGBEE }, // SW2500ZB
  21212: { kind: KINDS.LIGHT, protocol: PROTOCOLS.ZIGBEE }, // SW2500ZB-VA
  2131: { kind: KINDS.DIMMER, protocol: PROTOCOLS.ZIGBEE }, // DM2500ZB
  21312: { kind: KINDS.DIMMER, protocol: PROTOCOLS.ZIGBEE }, // DM2500ZB-VA
  2132: { kind: KINDS.DIMMER, protocol: PROTOCOLS.ZIGBEE }, // DM2550ZB
  21322: { kind: KINDS.DIMMER, protocol: PROTOCOLS.ZIGBEE }, // DM2550ZB-VA
  // Load controllers and outlets
  2506: { kind: KINDS.LOAD, protocol: PROTOCOLS.ZIGBEE }, // RM3250ZB
  2610: { kind: KINDS.LOAD, protocol: PROTOCOLS.ZIGBEE, variant: 'outlet' }, // SP2610ZB in-wall outlet
  2600: { kind: KINDS.LOAD, protocol: PROTOCOLS.ZIGBEE, variant: 'outlet' }, // SP2600ZB plug
  346: { kind: KINDS.LOAD, protocol: PROTOCOLS.WIFI }, // RM3250WF
  2151: { kind: KINDS.WATER_HEATER, protocol: PROTOCOLS.ZIGBEE }, // RM3500ZB (Calypso)
  2152: { kind: KINDS.WATER_HEATER, protocol: PROTOCOLS.WIFI }, // RM3500WF
  339: { kind: KINDS.WATER_HEATER, protocol: PROTOCOLS.WIFI }, // RM3510WF
  // Water leak detectors on a GT130
  5051: { kind: KINDS.LEAK, protocol: PROTOCOLS.ZIGBEE }, // WL4200, WL4200S
  5053: { kind: KINDS.LEAK, protocol: PROTOCOLS.ZIGBEE }, // WL4200C
  4210: { kind: KINDS.LEAK, protocol: PROTOCOLS.ZIGBEE }, // WL4210
  // Gateway
  130: { kind: KINDS.GATEWAY, protocol: PROTOCOLS.ZIGBEE }, // GT130
};

/**
 * Classify a device from its signature.
 * @param {{ protocol?: string, model?: number|string, type?: number|string }|null|undefined} signature
 * @returns {{ kind: string, protocol: string, variant?: string, model: number }|null}
 *   null for a device the integration does not handle
 */
export function classify(signature) {
  if (!signature || typeof signature !== 'object') {
    return null;
  }
  const model = Number(signature.model);
  const protocol = String(signature.protocol ?? '').toLowerCase();
  if (protocol === PROTOCOLS.MIWI) {
    if (model === MIWI_GATEWAY_MODEL) {
      return { kind: KINDS.GATEWAY, protocol: PROTOCOLS.MIWI, model };
    }
    const entry = MIWI_TYPES[Number(signature.type)];
    return entry ? { ...entry, protocol: PROTOCOLS.MIWI, model } : null;
  }
  if (model === MIWI_GATEWAY_MODEL) {
    // A GT125 whose signature carries no protocol.
    return { kind: KINDS.GATEWAY, protocol: PROTOCOLS.MIWI, model };
  }
  const entry = MODELS[model];
  return entry ? { ...entry, model } : null;
}

/**
 * Whether Neviweb keeps an hourly consumption history for the device (the
 * `consumption/hourly` statistics of the GT130 and Wi-Fi generations). A
 * low-voltage thermostat drives a relay, not a load: no energy.
 */
export function hasEnergyHistory(info) {
  if (info.protocol === PROTOCOLS.MIWI) {
    return false;
  }
  if (info.kind === KINDS.THERMOSTAT) {
    return info.variant !== 'low_voltage';
  }
  return info.kind === KINDS.LOAD || info.kind === KINDS.WATER_HEATER;
}

/**
 * Whether the device reports the Éco-Sinopé peak events (`drStatus`): the
 * GT130 and Wi-Fi thermostats and load controllers, not the outlets.
 */
export function hasPeakStatus(info) {
  return (
    info.protocol !== PROTOCOLS.MIWI &&
    [KINDS.THERMOSTAT, KINDS.LOAD, KINDS.WATER_HEATER].includes(info.kind) &&
    info.variant !== 'outlet'
  );
}
