import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './app.ts';
import { closeDatabase, db } from './database.ts';

let accessToken = '';

beforeAll(async () => {
  const login = await request(app).post('/api/v1/auth/login').send({ username: 'admin', password: process.env.APEX_BOOTSTRAP_ADMIN_PASSWORD });
  expect(login.status).toBe(200);
  accessToken = login.body.accessToken;
  db.prepare(`DELETE FROM app_data WHERE namespace = 'test'`).run();
});

afterAll(() => {
  db.prepare(`DELETE FROM app_data WHERE namespace = 'test'`).run();
  closeDatabase();
});

describe('ApexDB secure API', () => {
  it('reports integrity through the health endpoint', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body.integrity).toBe('ok');
  });

  it('rejects anonymous writes and reads', async () => {
    const read = await request(app).get('/api/v1/data/test/persist');
    const write = await request(app).put('/api/v1/data/test/persist').send({ data: { value: 1 } });
    expect(read.status).toBe(401);
    expect(write.status).toBe(401);
  });

  it('persists authenticated data and rejects stale optimistic writes', async () => {
    const created = await request(app)
      .put('/api/v1/data/test/persist')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ data: { value: 42 } });
    expect(created.status).toBe(200);
    expect(created.body.version).toBe(1);

    const read = await request(app)
      .get('/api/v1/data/test/persist')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(read.body.data).toEqual({ value: 42 });

    const conflict = await request(app)
      .put('/api/v1/data/test/persist')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ data: { value: 43 }, expectedVersion: 999 });
    expect(conflict.status).toBe(409);
  });

  it('rejects malformed JSON and invalid paths', async () => {
    const malformed = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{bad');
    expect(malformed.status).toBe(400);
    const invalid = await request(app).get('/api/v1/data/../secret').set('Authorization', `Bearer ${accessToken}`);
    expect(invalid.status).toBeGreaterThanOrEqual(400);
  });

  it('separates liveness and readiness probes', async () => {
    const live = await request(app).get('/api/v1/live');
    const ready = await request(app).get('/api/v1/ready');
    expect(live.status).toBe(200);
    expect(ready.status).toBe(200);
  });

  it('protects admin metrics and reports persisted counters', async () => {
    const unauthorized = await request(app).get('/api/v1/metrics');
    expect(unauthorized.status).toBe(401);
    const authorized = await request(app).get('/api/v1/metrics').set('Authorization', `Bearer ${accessToken}`);
    expect(authorized.status).toBe(200);
    expect(authorized.text).toContain('apexdb_records_total');
  });
});
