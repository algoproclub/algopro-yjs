import { Server } from '@hocuspocus/server';
import { SQLite } from '@hocuspocus/extension-sqlite';
import process from 'process';
import dotenv from 'dotenv';

import { initializeFirebaseAdmin, FirebaseAuth } from './FirebaseAuth';
import { CopyFileAPI } from './CopyFileAPI';
import { StatsSync } from './StatsSync';

dotenv.config();

const firebaseAdmin = initializeFirebaseAdmin();

const server = new Server({
  port: process.env.PORT ? parseInt(process.env.PORT) : 1234,
  address: process.env.HOST || '127.0.0.1',
  name: process.env.NAME || 'algopro-yjs',

  extensions: [
    new SQLite({ database: 'db.sqlite' }),
    new FirebaseAuth(firebaseAdmin),
    new CopyFileAPI(),
    new StatsSync(firebaseAdmin),
  ],
});

await server.listen();
