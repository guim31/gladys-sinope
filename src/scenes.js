// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`). The scene triggers are fired by
// src/hub.js (SCENE_TRIGGERS).
//
// `set_location_mode`: the home/away mode of Neviweb, on every location of
// the configuration. Away lowers every thermostat to its own away setpoint,
// set in the Neviweb app: nothing is turned off.
// -----------------------------------------------------------------------------

export const LOCATION_MODES = ['home', 'away'];

/**
 * @param {ReturnType<import('./hub.js').createHub>} hub
 * @returns {Record<string, (fields: object) => Promise<object>>}
 */
export function createSceneActions(hub) {
  return {
    async set_location_mode(fields) {
      const mode = fields?.mode;
      if (!LOCATION_MODES.includes(mode)) {
        throw new Error(`Unknown Neviweb mode "${mode}" (home or away)`);
      }
      const locations = await hub.setLocationMode(mode);
      return { locations };
    },
  };
}
