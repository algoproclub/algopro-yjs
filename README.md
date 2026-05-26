# algopro-yjs

Yjs collaboration backend built on Hocuspocus, with:

- SQLite document persistence (`db.sqlite`)
- Firebase ID token authentication and per-document access checks
- Internal HTTP API for document copy
- Periodic stats sync to Firebase Realtime Database


## Environment Variables

The server loads `.env` at startup.

### Required For Production

- `NODE_ENV=production`
- `SECURITY_KEY` (required for `/copyFile` authorization)
- `FIREBASE_CRED_PATH` or a valid `./serviceAccountKey.json` file

### Optional (With Defaults)

- `PORT`
  - Default: `1234`
- `HOST`
  - Default: `127.0.0.1`
- `NAME`
  - Default: `algopro-yjs`
- `FIREBASE_CRED_PATH`
  - Default: `./serviceAccountKey.json`
- `FIREBASE_DB_URL`
  - Default in production:
    - `https://algopro-app-default-rtdb.europe-west1.firebasedatabase.app`
  - Default outside production:
    - `http://firebase:9000?ns=algopro-app-default-rtdb`

## Deployment Steps

1. Install dependencies:

```bash
npm install
```

2. Create/verify environment file (example):

```env
NODE_ENV=production
PORT=1234
HOST=0.0.0.0
NAME=algopro-yjs
SECURITY_KEY=replace-with-long-random-secret
FIREBASE_CRED_PATH=/app/secrets/serviceAccountKey.json
FIREBASE_DB_URL=https://your-project-default-rtdb.region.firebasedatabase.app
```

3. Ensure Firebase service account credentials are present at `FIREBASE_CRED_PATH`.

4. Build:

```bash
npm run build
```

5. Run:

```bash
node dist/index.js
```

## Caddy Proxy (Production)

For production, run this service behind Caddy for TLS termination and public routing.

Recommended app bind settings behind Caddy:

- `HOST=127.0.0.1`
- `PORT=1234`

Example `Caddyfile`:

```caddy
yjs.algopro.hu

reverse_proxy :1234
```

## Migration From y-leveldb

A helper script is included:

```bash
node scripts/migrate-y-leveldb-to-sqlite.mjs <legacyLevelDbPath> <sqlitePath> [batchSize]
```

It reads all y-leveldb docs, encodes merged Yjs state, and upserts into the SQLite `documents` table used by Hocuspocus.

## Notes

- The SQLite filename is currently hardcoded to `db.sqlite`.
- The build script copies `.env` into `dist/.env`.
