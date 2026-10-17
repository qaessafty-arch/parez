#!/usr/bin/env node
/** Apply database migrations without starting the server. */
import { ready, closeDb } from './index.js';
import { seedMaster } from './seed.js';
await ready();
await seedMaster();
console.log('Migrations applied. Master data seeded.');
await closeDb();
