import path from 'node:path';
import crypto from 'node:crypto';

const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET;

if (isProduction && (!jwtSecret || jwtSecret.length < 32)) {
  throw new Error('JWT_SECRET must contain at least 32 characters in production');
}

export const config = {
  port: Number(process.env.PORT || 4000),
  databasePath: process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'apex.db'),
  jwtSecret: jwtSecret || crypto.randomBytes(32).toString('hex'),
  accessTokenTtlSeconds: Number(process.env.ACCESS_TOKEN_TTL || 900),
  refreshTokenTtlSeconds: Number(process.env.REFRESH_TOKEN_TTL || 604800),
  maxBodyBytes: process.env.MAX_BODY_BYTES || '64kb',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',').map((origin) => origin.trim()).filter(Boolean),
  replicaMode: process.env.REPLICA_MODE === 'follower' ? 'follower' : 'leader',
  replicationSecret: process.env.REPLICATION_SECRET || '',
};
