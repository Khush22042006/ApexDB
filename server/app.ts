import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db, backupDatabase, transaction, pruneExpiredTokens, pruneBackups } from './database.ts';
import { config } from './config.ts';
import {
  authenticate, authorize, seedAdmin, credentialsSchema, refreshSchema, signAccessToken,
  createRefreshToken, revokeRefreshToken, registerUser, verifyLogin, sha256,
} from './auth.ts';

seedAdmin();
pruneExpiredTokens();
setInterval(() => pruneExpiredTokens(), 60 * 60 * 1000).unref();
export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));

const distPath = path.resolve(process.cwd(), 'dist');
const hasProductionBuild = process.env.NODE_ENV === 'production' && fs.existsSync(distPath);
if (hasProductionBuild) {
  app.use(express.static(distPath, { index: false, maxAge: '1h', immutable: true }));
}

app.use('/api/', cors({
  origin(origin, callback) {
    if (!origin || config.corsOrigins.includes(origin)) callback(null, true);
    else callback(new Error('Origin not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Replication-Secret'],
}));
app.use(express.json({ limit: config.maxBodyBytes, strict: true }));

app.use((req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'production' ? 20 : 200,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV !== 'production'
    || ['/api/v1/live', '/api/v1/ready', '/api/v1/health', '/v1/live', '/v1/ready', '/v1/health'].includes(req.path),
});
app.use('/api/', apiLimiter);

function audit(req: Request, status: number): void {
  if (!req.path.startsWith('/api/')) return;
  db.prepare(`INSERT INTO audit_log(user_id, action, method, path, status, ip, user_agent, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    req.authUser?.id ?? null, req.method === 'POST' && req.path.includes('login') ? 'login' : req.method,
    req.method, req.path, status, req.ip ?? null, req.get('user-agent')?.slice(0, 500) ?? null, Math.floor(Date.now() / 1000),
  );
}
app.use((req, res, next) => {
  res.on('finish', () => audit(req, res.statusCode));
  next();
});

app.get('/api/v1/live', (_req, res) => {
  res.status(200).json({ status: 'alive', timestamp: Date.now() });
});

app.get('/api/v1/ready', (_req, res) => {
  try {
    const integrity = db.prepare('PRAGMA integrity_check').pluck().get() as string;
    if (integrity !== 'ok') return res.status(503).json({ status: 'not-ready', integrity, timestamp: Date.now() });
    return res.status(200).json({ status: 'ready', mode: config.replicaMode, integrity, timestamp: Date.now() });
  } catch {
    return res.status(503).json({ status: 'not-ready', timestamp: Date.now() });
  }
});

app.get('/api/v1/health', (_req, res) => {
  const integrity = db.prepare('PRAGMA integrity_check').pluck().get() as string;
  res.json({ status: integrity === 'ok' ? 'healthy' : 'degraded', mode: config.replicaMode, integrity, timestamp: Date.now() });
});

app.post('/api/v1/auth/register', authLimiter, (req, res) => {
  const registration = z.object({
    username: credentialsSchema.shape.username,
    password: credentialsSchema.shape.password,
    email: z.string().trim().email().max(254),
  }).safeParse(req.body);
  if (!registration.success) return res.status(400).json({ error: 'Invalid registration', details: registration.error.flatten() });
  try {
    const user = registerUser(registration.data.username, registration.data.email, registration.data.password);
    const accessToken = signAccessToken(user);
    const refreshToken = createRefreshToken(user.id);
    return res.status(201).json({ user, accessToken, refreshToken });
  } catch (error) {
    if (String(error).includes('UNIQUE constraint')) return res.status(409).json({ error: 'Username or email already exists' });
    return res.status(500).json({ error: 'Account creation failed' });
  }
});

app.post('/api/v1/auth/login', authLimiter, (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid credentials format' });
  const user = verifyLogin(parsed.data.username, parsed.data.password);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  return res.json({ user, accessToken: signAccessToken(user), refreshToken: createRefreshToken(user.id) });
});

app.post('/api/v1/auth/refresh', authLimiter, (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid refresh token' });
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(`SELECT rt.user_id, rt.revoked_at, rt.expires_at, u.username, u.email, u.role, u.disabled
                          FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
                          WHERE rt.token_hash = ?`).get(sha256(parsed.data.refreshToken)) as {
    user_id: number; revoked_at: number | null; expires_at: number; username: string; email: string; role: 'admin'|'editor'|'viewer'; disabled: number;
  } | undefined;
  if (!row || row.revoked_at || row.expires_at < now || row.disabled) return res.status(401).json({ error: 'Refresh token is invalid or expired' });
  return transaction(() => {
    revokeRefreshToken(parsed.data.refreshToken);
    const user = { id: row.user_id, username: row.username, email: row.email, role: row.role };
    return res.json({ user, accessToken: signAccessToken(user), refreshToken: createRefreshToken(user.id) });
  });
});

app.post('/api/v1/auth/logout', authenticate, (req, res) => {
  const parsed = refreshSchema.safeParse(req.body);
  if (parsed.success) revokeRefreshToken(parsed.data.refreshToken);
  db.prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ?`).run(Math.floor(Date.now() / 1000), req.authUser!.id);
  res.status(204).send();
});

app.get('/api/v1/auth/me', authenticate, (req, res) => res.json({ user: req.authUser }));

const dataKeySchema = z.object({ namespace: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/i), key: z.string().min(1).max(128) });
app.get('/api/v1/data/:namespace/:key', authenticate, authorize('viewer', 'editor', 'admin'), (req, res) => {
  const parsed = dataKeySchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data identifier' });
  const row = db.prepare(`SELECT payload, version, updated_at FROM app_data WHERE namespace = ? AND record_key = ?`).get(parsed.data.namespace, parsed.data.key) as { payload: string; version: number; updated_at: number } | undefined;
  if (!row) return res.status(404).json({ error: 'Record not found' });
  res.json({ namespace: parsed.data.namespace, key: parsed.data.key, data: JSON.parse(row.payload), version: row.version, updatedAt: row.updated_at });
});

app.put('/api/v1/data/:namespace/:key', authenticate, authorize('editor', 'admin'), (req, res) => {
  if (config.replicaMode === 'follower') return res.status(503).json({ error: 'Server is read-only follower' });
  const parsedKey = dataKeySchema.safeParse(req.params);
  const parsedBody = z.object({ data: z.unknown(), expectedVersion: z.number().int().positive().optional() }).safeParse(req.body);
  if (!parsedKey.success || !parsedBody.success) return res.status(400).json({ error: 'Invalid data payload' });
  const existing = db.prepare(`SELECT version FROM app_data WHERE namespace = ? AND record_key = ?`).get(parsedKey.data.namespace, parsedKey.data.key) as { version: number } | undefined;
  if (parsedBody.data.expectedVersion !== undefined && existing && parsedBody.data.expectedVersion !== existing.version) {
    return res.status(409).json({ error: 'Version conflict' });
  }
  const version = (existing?.version ?? 0) + 1;
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify(parsedBody.data.data);
  if (Buffer.byteLength(payload, 'utf8') > 64000) return res.status(413).json({ error: 'Record exceeds 64 KB limit' });
  db.prepare(`INSERT INTO app_data(namespace, record_key, payload, version, updated_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(namespace, record_key) DO UPDATE SET payload=excluded.payload, version=excluded.version, updated_at=excluded.updated_at`)
    .run(parsedKey.data.namespace, parsedKey.data.key, payload, version, now);
  res.json({ namespace: parsedKey.data.namespace, key: parsedKey.data.key, version, updatedAt: now });
});

app.delete('/api/v1/data/:namespace/:key', authenticate, authorize('editor', 'admin'), (req, res) => {
  if (config.replicaMode === 'follower') return res.status(503).json({ error: 'Server is read-only follower' });
  const parsed = dataKeySchema.safeParse(req.params);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid data identifier' });
  const result = db.prepare(`DELETE FROM app_data WHERE namespace = ? AND record_key = ?`).run(parsed.data.namespace, parsed.data.key);
  if (result.changes === 0) return res.status(404).json({ error: 'Record not found' });
  res.status(204).send();
});

app.post('/api/v1/admin/backup', authenticate, authorize('admin'), (req, res) => {
  const backupName = `apex-${Date.now()}.db`;
  const backupPath = path.resolve(process.cwd(), 'data', 'backups', backupName);
  try {
    backupDatabase(backupPath);
    pruneBackups(path.dirname(backupPath), 20);
    res.download(backupPath, backupName, () => fs.rmSync(backupPath, { force: true }));
  } catch {
    res.status(500).json({ error: 'Backup failed' });
  }
});

app.get('/api/v1/replication/status', authenticate, authorize('admin'), (_req, res) => {
  res.json({ mode: config.replicaMode, wal: { enabled: true, mode: 'WAL', synchronous: 'FULL' }, snapshotEndpoint: '/api/v1/replication/snapshot' });
});

app.get('/api/v1/replication/snapshot', (req, res) => {
  if (!config.replicationSecret || req.get('X-Replication-Secret') !== config.replicationSecret) return res.status(401).json({ error: 'Replication secret required' });
  const snapshotName = `apex-snapshot-${Date.now()}.db`;
  const snapshotPath = path.resolve(process.cwd(), 'data', 'backups', snapshotName);
  try {
    backupDatabase(snapshotPath);
    pruneBackups(path.dirname(snapshotPath), 20);
    res.download(snapshotPath, snapshotName, () => fs.rmSync(snapshotPath, { force: true }));
  } catch {
    res.status(500).json({ error: 'Snapshot failed' });
  }
});

app.get('/api/v1/metrics', authenticate, authorize('admin'), (_req, res) => {
  const users = db.prepare('SELECT COUNT(*) AS count FROM users').pluck().get() as number;
  const records = db.prepare('SELECT COUNT(*) AS count FROM app_data').pluck().get() as number;
  const auditRows = db.prepare('SELECT COUNT(*) AS count FROM audit_log').pluck().get() as number;
  res.type('text/plain').send([
    '# HELP apexdb_users_total Registered ApexDB users', '# TYPE apexdb_users_total gauge', `apexdb_users_total ${users}`,
    '# HELP apexdb_records_total Persisted application records', '# TYPE apexdb_records_total gauge', `apexdb_records_total ${records}`,
    '# HELP apexdb_audit_events_total Audit events recorded', '# TYPE apexdb_audit_events_total gauge', `apexdb_audit_events_total ${auditRows}`,
    '# HELP process_uptime_seconds Server uptime in seconds', '# TYPE process_uptime_seconds gauge', `process_uptime_seconds ${Math.floor(process.uptime())}`,
  ].join('\n'));
});

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (error.message === 'Origin not allowed by CORS') return res.status(403).json({ error: 'Origin is not allowed' });
  if (error instanceof SyntaxError) return res.status(400).json({ error: 'Malformed JSON' });
  return res.status(500).json({ error: 'Internal server error' });
});

if (hasProductionBuild) {
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found' }));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}
