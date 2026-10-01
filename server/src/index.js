/** Server entry point. */
import { createApp } from './app.js';
import { config } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { seedMaster } from './db/seed.js';
import { seedDemo } from './db/seedDemo.js';

getDb(); // run migrations on boot
seedMaster();
if (process.env.PAREZ_DEMO === '1') seedDemo();

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`PAREZ server running at http://${config.host}:${config.port}`);
  console.log(`Database: ${config.dbPath}`);
});

function shutdown() {
  console.log('\nShutting down...');
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
