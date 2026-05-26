#!/usr/bin/env node

import { LeveldbPersistence } from 'y-leveldb';
import Database from 'better-sqlite3';
import * as Y from 'yjs';

const printUsage = () => {
  console.log('Usage: node scripts/migrate-y-leveldb-to-sqlite.mjs <leveldbPath> <sqlitePath> [batchSize]');
  console.log('Example: node scripts/migrate-y-leveldb-to-sqlite.mjs ./legacy-leveldb ./db.sqlite 200');
};

const [leveldbPath, sqlitePath, batchSizeArg] = process.argv.slice(2);

if (!leveldbPath || !sqlitePath) {
  printUsage();
  process.exit(1);
}

const batchSize = Number.parseInt(batchSizeArg ?? '200', 10);
if (!Number.isFinite(batchSize) || batchSize <= 0) {
  console.error('Invalid batchSize. It must be a positive integer.');
  process.exit(1);
}

const persistence = new LeveldbPersistence(leveldbPath);
const sqlite = new Database(sqlitePath);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS "documents" (
    "name" varchar(255) NOT NULL,
    "data" blob NOT NULL,
    UNIQUE(name)
  )
`);

const upsert = sqlite.prepare(`
  INSERT INTO "documents" ("name", "data") VALUES (@name, @data)
  ON CONFLICT(name) DO UPDATE SET data = @data
`);

const runUpsertBatch = sqlite.transaction(rows => {
  for (const row of rows) {
    upsert.run(row);
  }
});

const run = async () => {
  const docNames = await persistence.getAllDocNames();
  console.log(`Found ${docNames.length} documents in y-leveldb`);

  let migrated = 0;
  let failed = 0;

  for (let i = 0; i < docNames.length; i += batchSize) {
    const chunk = docNames.slice(i, i + batchSize);

    const settled = await Promise.allSettled(
      chunk.map(async name => {
        const ydoc = await persistence.getYDoc(name);
        const mergedUpdate = Y.encodeStateAsUpdate(ydoc);
        return { name, data: Buffer.from(mergedUpdate) };
      })
    );

    const rows = [];
    settled.forEach(result => {
      if (result.status === 'fulfilled') {
        rows.push(result.value);
      } else {
        failed += 1;
        console.error('Failed to migrate document:', result.reason);
      }
    });

    if (rows.length > 0) {
      runUpsertBatch(rows);
      migrated += rows.length;
    }

    console.log(
      `Progress: ${Math.min(i + chunk.length, docNames.length)}/${docNames.length} docs scanned, ${migrated} migrated, ${failed} failed`
    );
  }

  sqlite.close();
  console.log(`Done. Migrated ${migrated} documents. Failed ${failed}.`);
};

run().catch(error => {
  try {
    sqlite.close();
  } catch {
    // ignore close failure on fatal path
  }
  console.error('Migration failed:', error);
  process.exit(1);
});
