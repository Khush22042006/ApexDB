import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db, transaction } from './database.ts';
import { config } from './config.ts';

export type Role = 'admin' | 'editor' | 'viewer';
export type AuthUser = { id: number; username: string; email: string; role: Role };

declare global {
  namespace Express {
    interface Request { authUser?: AuthUser; requestId?: string; }
  }
}

export const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(12).max(128),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(32).max(512) });

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign({ sub: String(user.id), username: user.username, role: user.role }, config.jwtSecret, {
    expiresIn: config.accessTokenTtlSeconds,
    issuer: 'apexdb',
    audience: 'apexdb-api',
  });
}

export function createRefreshToken(userId: number): string {
  const token = crypto.randomBytes(48).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO refresh_tokens(user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`).run(
    userId, sha256(token), now + config.refreshTokenTtlSeconds, now,
  );
  return token;
}

export function revokeRefreshToken(token: string): void {
  db.prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ?`).run(Math.floor(Date.now() / 1000), sha256(token));
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret, {
      issuer: 'apexdb', audience: 'apexdb-api',
    }) as JwtPayload;
    const user = db.prepare(`SELECT id, username, email, role, disabled FROM users WHERE id = ?`).get(Number(payload.sub)) as {
      id: number; username: string; email: string; role: Role; disabled: number;
    } | undefined;
    if (!user || user.disabled) {
      res.status(401).json({ error: 'Account is unavailable' });
      return;
    }
    req.authUser = { id: user.id, username: user.username, email: user.email, role: user.role };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function authorize(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser || !roles.includes(req.authUser.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

export function seedAdmin(): void {
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  if (count.count > 0) return;
  const password = process.env.APEX_BOOTSTRAP_ADMIN_PASSWORD;
  if (process.env.NODE_ENV === 'production' && !password) {
    throw new Error('APEX_BOOTSTRAP_ADMIN_PASSWORD is required for the first production startup');
  }
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO users(username, email, password_hash, role, created_at, updated_at)
              VALUES (?, ?, ?, 'admin', ?, ?)`).run(
    'admin', 'admin@apex.local', bcrypt.hashSync(password || 'ChangeMe-Admin!2026', 12), now, now,
  );
}

export function registerUser(username: string, email: string, password: string): AuthUser {
  return transaction(() => {
    const now = Math.floor(Date.now() / 1000);
    const result = db.prepare(`INSERT INTO users(username, email, password_hash, role, created_at, updated_at)
                               VALUES (?, ?, ?, 'viewer', ?, ?)`).run(
      username, email, bcrypt.hashSync(password, 12), now, now,
    );
    return { id: Number(result.lastInsertRowid), username, email, role: 'viewer' };
  });
}

export function verifyLogin(username: string, password: string): AuthUser | null {
  const row = db.prepare(`SELECT id, username, email, role, password_hash, disabled FROM users WHERE username = ? COLLATE NOCASE`).get(username) as {
    id: number; username: string; email: string; role: Role; password_hash: string; disabled: number;
  } | undefined;
  if (!row || row.disabled || !bcrypt.compareSync(password, row.password_hash)) return null;
  return { id: row.id, username: row.username, email: row.email, role: row.role };
}
