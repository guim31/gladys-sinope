// -----------------------------------------------------------------------------
// The pure parts: which Sinopé device a signature is, the readers that accept
// every shape Neviweb sends, the mode/preset mapping and the attribute writes
// of each command.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BLUEPRINTS,
  THERMOSTAT_MODE as MODE,
  THERMOSTAT_PRESET as PRESET,
  batteryPercent,
  num,
  onOff,
  thermostatModes,
} from '../src/devices.js';
import {
  KINDS,
  PROTOCOLS,
  classify,
  hasEnergyHistory,
  hasPeakStatus,
} from '../src/neviweb/models.js';

test('the MiWi models are classified by type, never by their Zigbee namesakes', () => {
  // 1123 is a TH1121RF behind a GT125, and a TH1123ZB behind a GT130.
  assert.deepEqual(classify({ protocol: 'miwi', model: 1123, type: 10 }), {
    kind: KINDS.THERMOSTAT,
    variant: 'baseboard',
    protocol: PROTOCOLS.MIWI,
    model: 1123,
  });
  assert.equal(classify({ protocol: 'sinopcom', model: 1123 }).protocol, PROTOCOLS.ZIGBEE);
  assert.equal(classify({ protocol: 'miwi', model: 2130, type: 112 }).kind, KINDS.DIMMER);
  assert.equal(classify({ protocol: 'miwi', model: 125 }).kind, KINDS.GATEWAY);
  assert.equal(classify({ model: 1510 }).protocol, PROTOCOLS.WIFI);
  assert.equal(classify({ protocol: 'sinopcom', model: '737' }).variant, 'floor');
});

test('unknown and left-out models are not classified', () => {
  for (const signature of [
    null,
    undefined,
    {},
    { protocol: 'sinopcom', model: 6810 }, // heat pump
    { protocol: 'wifi', model: 6727 }, // heat/cool
    { protocol: 'sinopcom', model: 3150 }, // Sedna valve
    { protocol: 'miwi', type: 99, model: 1 },
  ]) {
    assert.equal(classify(signature), null, JSON.stringify(signature));
  }
});

test('energy history and peak status: GT130 and Wi-Fi only', () => {
  assert.equal(hasEnergyHistory(classify({ protocol: 'miwi', model: 1123, type: 10 })), false);
  assert.equal(hasEnergyHistory(classify({ model: 1123 })), true);
  assert.equal(hasEnergyHistory(classify({ model: 7372 })), false, 'low voltage: a relay');
  assert.equal(hasEnergyHistory(classify({ model: 2131 })), false, 'dimmers');
  assert.equal(hasPeakStatus(classify({ model: 2506 })), true);
  assert.equal(hasPeakStatus(classify({ model: 2610 })), false, 'outlets');
});

test('the readers accept every shape and invent nothing', () => {
  assert.equal(num(21.5), 21.5);
  assert.equal(num('21.5'), 21.5);
  assert.equal(num({ value: 21.5, error: null }), 21.5);
  assert.equal(num({ percent: 40, sourceType: 'heating' }), 40);
  for (const raw of [null, undefined, '', 'abc', {}, { value: null }, NaN, Infinity]) {
    assert.equal(num(raw), null, String(raw));
  }
  assert.equal(onOff('on'), 1);
  assert.equal(onOff('off'), 0);
  assert.equal(onOff(100), 1);
  assert.equal(onOff(0), 0);
  assert.equal(onOff('probe'), null);
  assert.equal(batteryPercent(3.1), 100);
  assert.equal(batteryPercent(2.5), 50);
  assert.equal(batteryPercent(1.8), 0);
  assert.equal(batteryPercent(null), null);
});

test('modes and presets of the three generations', () => {
  assert.deepEqual(thermostatModes('off'), { mode: MODE.OFF, preset: null });
  assert.deepEqual(thermostatModes('auto'), { mode: MODE.HEATING, preset: PRESET.SCHEDULE });
  assert.deepEqual(thermostatModes('autoBypass'), { mode: MODE.HEATING, preset: PRESET.SCHEDULE });
  assert.deepEqual(thermostatModes('manual'), { mode: MODE.HEATING, preset: PRESET.COMFORT });
  assert.deepEqual(thermostatModes('heat'), { mode: MODE.HEATING, preset: PRESET.COMFORT });
  assert.deepEqual(thermostatModes('away'), { mode: MODE.HEATING, preset: PRESET.AWAY });
  assert.deepEqual(thermostatModes('frostProtection'), {
    mode: MODE.HEATING,
    preset: PRESET.FROST,
  });
  assert.deepEqual(thermostatModes('manual', 'away'), { mode: MODE.HEATING, preset: PRESET.AWAY });
  assert.deepEqual(thermostatModes('surprise'), { mode: null, preset: null });
});

const wifi = classify({ protocol: 'wifi', model: 1510 });
const zigbee = classify({ protocol: 'sinopcom', model: 1123 });
const miwiDimmer = classify({ protocol: 'miwi', model: 2130, type: 112 });

test('a thermostat turned off heats nothing, whatever its last percentage', () => {
  const { states } = BLUEPRINTS.thermostat.read(zigbee, {
    roomTemperature: { value: 19.96 },
    roomSetpoint: 20,
    systemMode: 'off',
    outputPercentDisplay: 35,
  });
  assert.deepEqual(states, {
    temperature: 20,
    setpoint: 20,
    mode: MODE.OFF,
    preset: null,
    operating_state: 0,
    heating: 0,
  });
});

test('a missing reading publishes nothing for it', () => {
  const { states } = BLUEPRINTS.thermostat.read(wifi, {
    roomTemperature: { value: null, error: 'sensor' },
  });
  assert.equal(states.temperature, null);
  assert.equal(states.heating, null);
  assert.equal(states.operating_state, null);
});

test('turning a Wi-Fi thermostat off then on keeps its away occupancy', () => {
  const runtime = { rawMode: 'off', occupancy: 'away', lastActiveMode: 'manual' };
  const { writes, states } = BLUEPRINTS.thermostat.command(wifi, 'mode', MODE.HEATING, runtime);
  assert.deepEqual(writes, [{ setpointMode: 'manual' }]);
  assert.deepEqual(states, { mode: MODE.HEATING, preset: PRESET.AWAY });

  const away = BLUEPRINTS.thermostat.command(wifi, 'preset', PRESET.AWAY, { rawMode: 'off' });
  assert.deepEqual(away.writes, [{ setpointMode: 'manual' }, { occupancyMode: 'away' }]);
});

test('a dimmer brightness of 0 turns it off; a light turned off keeps its brightness', () => {
  assert.deepEqual(BLUEPRINTS.dimmer.command(miwiDimmer, 'brightness', 0).writes, [
    { intensity: 0 },
  ]);
  assert.deepEqual(BLUEPRINTS.dimmer.read(miwiDimmer, { intensity: 0 }).states, { light: 0 });
  assert.deepEqual(BLUEPRINTS.dimmer.read(miwiDimmer, { intensity: 42 }).states, {
    light: 1,
    brightness: 42,
  });
});

test('leak detectors and water heaters: water, dry, or unknown', () => {
  const leak = classify({ model: 5051 });
  assert.deepEqual(
    BLUEPRINTS.leak.read(leak, {
      waterLeakStatus: 'water',
      roomTemperature: 12.04,
      batteryVoltage: 2.2,
    }).states,
    { leak: 1, battery: 20, temperature: 12 },
  );
  assert.equal(BLUEPRINTS.leak.read(leak, { waterLeakStatus: 'probe' }).states.leak, null);

  const tank = classify({ model: 2152 });
  const { states, peak } = BLUEPRINTS.water_heater.read(tank, {
    onOff: 'on',
    loadWattNow: { value: 4500 },
    waterTemperature: 61.24,
    drStatus: { drActive: 'on' },
  });
  assert.deepEqual(states, { switch: 1, power: 4500, water_temperature: 61.2 });
  assert.equal(peak, 1);
});

test('gateways: online or not', () => {
  const gt130 = classify({ model: 130 });
  assert.deepEqual(BLUEPRINTS.gateway.read(gt130, { status: 'online' }).states, { online: 1 });
  assert.deepEqual(BLUEPRINTS.gateway.read(gt130, { status: 'offline' }).states, { online: 0 });
  assert.deepEqual(BLUEPRINTS.gateway.read(gt130, {}).states, { online: null });
});
