
# ApexDB

A browser-based relational database engine and visualization platform built with React, TypeScript, and Vite.

## Run locally

```bash
npm install --legacy-peer-deps
npm run dev
```

Open `http://localhost:3000/`.

## Validate

```bash
npm run lint
npm run test
npm run build
npm run check
```

## Architecture

- Custom SQL lexer/parser and AST execution
- Volcanic-style query operators
- Buffer pool and slotted-page storage simulation
- MVCC transaction metadata and rollback demonstrations
- WAL logging and recovery workflows
- B+ tree, learned, and vector indexes
- Branch snapshots, overlays, conflict detection, and merge flows
- Workload cache and query X-Ray visualization
- Autonomous optimization and agent safety tickets

## Persisted API mode

```bash
npm run dev:full
```

The API runs on `http://127.0.0.1:4000` and persists to SQLite WAL storage. Its bootstrap admin account is controlled by `APEX_BOOTSTRAP_ADMIN_PASSWORD`.

```bash
npm run dev:api   # API only
npm start         # production build and combined static/API server
```

The API provides bcrypt password hashing, short-lived JWT access tokens, rotating refresh tokens, strict role authorization, Helmet/CORS protections, rate limits, audit logging, integrity health checks, optimistic data versioning, SQLite backups, retained backup pruning, and leader/follower read-only mode hooks. TLS must be terminated by a reverse proxy in production.

Operational endpoints:

- `/api/v1/live` — process liveness
- `/api/v1/ready` — database readiness
- `/api/v1/health` — compatibility health summary
- `/api/v1/metrics` — admin-only Prometheus-style counters

## Supported limitations

ApexDB now includes a persisted SQLite-backed API, browser localStorage snapshots, authentication, authorization, audit logging, backups, and leader/follower boundaries. The React SQL engine remains an in-browser educational simulator and is not yet the storage engine behind every API operation.

It does not provide automatic multi-node failover, continuous replication, distributed consensus, or PostgreSQL/MySQL compatibility. Production deployments should still use TLS termination, managed secrets, isolated infrastructure, backups, monitoring, and an externally operated database before relying on real data.

The automated suite covers core SQL constraints, transactions, cache isolation, branch isolation, vector validation, and page integrity. UI flows should also be verified in a browser after rebuilding.

## Scripts

- `npm run dev` — start the Vite development server
- `npm run lint` — run TypeScript type checking
- `npm run test` — run automated regressions
- `npm run build` — create a production bundle
- `npm run check` — run lint, tests, and build together
- `npm run clean` — remove generated build files
