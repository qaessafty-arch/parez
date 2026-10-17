/** Server entry point. */
import { createApp } from './app.js';
import { config } from './config.js';
import { ready, closeDb } from './db/index.js';
import { seedMaster } from './db/seed.js';
import { seedDemo } from './db/seedDemo.js';

await ready(); // run migrations on boot
await seedMaster();
if (process.env.PAREZ_DEMO === '1') await seedDemo();

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  console.log(`PAREZ server running at http://${config.host}:${config.port}`);
  console.log(`Database: ${config.dbUrl.startsWith('file:') ? config.dbPath : 'Turso (remote)'}`);
});

function shutdown() {
  console.log('\nShutting down...');
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
