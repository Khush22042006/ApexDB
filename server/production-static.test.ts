import fs from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

const distPath = path.resolve(process.cwd(), 'dist');
const assetDir = path.join(distPath, 'assets');
const createdDist = !fs.existsSync(distPath);
const assetPath = path.join(assetDir, `public-static-${process.pid}.js`);
const indexPath = path.join(distPath, 'index.html');
const createdIndex = !fs.existsSync(indexPath);

fs.mkdirSync(assetDir, { recursive: true });
fs.writeFileSync(assetPath, 'window.staticAssetCheck = true;');
if (createdIndex) fs.writeFileSync(indexPath, '<!doctype html><title>SPA test</title>');
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = 'vitest-production-static-secret-long-enough';
process.env.DATABASE_PATH = ':memory:';
process.env.APEX_BOOTSTRAP_ADMIN_PASSWORD = 'Vitest-Only-Password!2026';

const { app } = await import('./app.ts');
const { closeDatabase } = await import('./database.ts');

afterAll(() => {
  closeDatabase();
  fs.rmSync(assetPath, { force: true });
  if (createdIndex) fs.rmSync(indexPath, { force: true });
  if (createdDist) fs.rmSync(distPath, { recursive: true, force: true });
});

describe('production frontend serving', () => {
  it('serves static assets publicly with their JavaScript MIME type', async () => {
    const response = await request(app)
      .get(`/assets/${path.basename(assetPath)}`)
      .set('Origin', 'https://unconfigured.example');

    expect(response.status).toBe(200);
    expect(response.type).toBe('text/javascript');
    expect(response.text).toContain('staticAssetCheck');
  });

  it('keeps unknown API routes as JSON 404s instead of serving the SPA', async () => {
    const response = await request(app).get('/api/v1/not-a-route');

    expect(response.status).toBe(404);
    expect(response.type).toBe('application/json');
    expect(response.body.error).toBe('API route not found');
  });

  it('serves the SPA entry point for frontend routes', async () => {
    const response = await request(app).get('/dashboard/settings');

    expect(response.status).toBe(200);
    expect(response.type).toBe('text/html');
  });
});
