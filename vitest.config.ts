import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    env: {
      NODE_ENV: 'development',
      JWT_SECRET: 'vitest-only-secret-that-is-at-least-32-characters',
      APEX_BOOTSTRAP_ADMIN_PASSWORD: 'Vitest-Only-Password!2026',
      DATABASE_PATH: './.vitest/apex.db',
    },
  },
});
