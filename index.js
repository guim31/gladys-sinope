// -----------------------------------------------------------------------------
// Entry point: wires the Gladys SDK to the Sinopé Neviweb integration
// (src/app.js). No Neviweb logic here. Handlers are registered before
// connect().
//
// Environment provided by the Gladys supervisor: GLADYS_HOST_API_URL,
// GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR (read by the SDK), and
// TZ, the timezone of Gladys (the request counter resets at local midnight).
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { registerHandlers } from './src/app.js';

const gladys = new GladysIntegration();
const app = registerHandlers(gladys);

gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal}, stopping`);
  return app.stop(); // stops the timer, writes the request counter under /data
});

logger.info('Starting the Sinopé Neviweb integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
