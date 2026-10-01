#!/usr/bin/env node
/** Apply database migrations without starting the server. */
import { getDb, closeDb } from './index.js';
import { seedMaster } from './seed.js';
getDb();
seedMaster();
console.log('Migrations applied. Master data seeded.');
closeDb();
