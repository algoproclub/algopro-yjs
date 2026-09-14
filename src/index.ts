import { Server } from '@hocuspocus/server';
import { SQLite } from '@hocuspocus/extension-sqlite';
import process from 'process';
import dotenv from 'dotenv';

import { initializeFirebaseAdmin, FirebaseAuth } from './FirebaseAuth.js';
import { CopyFileAPI } from './CopyFileAPI.js';
import { StatsSync } from './StatsSync.js';
import { Diagnostics } from './Diagnostics.js';

dotenv.config();

const firebaseAdmin = initializeFirebaseAdmin();

const firebaseAuth = new FirebaseAuth(firebaseAdmin);
const statsSync = new StatsSync(firebaseAdmin);

const dbPath = process.env.DATABASE_PATH || './db.sqlite';

const server = new Server({
  port: process.env.PORT ? parseInt(process.env.PORT) : 1234,
  address: process.env.HOST || '127.0.0.1',
  name: process.env.NAME || 'algopro-yjs',

  extensions: [
    new SQLite({ database: dbPath }),
    firebaseAuth,
    new CopyFileAPI(),
    statsSync,
    new Diagnostics(firebaseAuth, statsSync),
  ],
});

await server.listen();
