import 'dotenv/config';
import { app } from './app.ts';
import { config } from './config.ts';
import { closeDatabase } from './database.ts';

const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`ApexDB API listening on http://127.0.0.1:${config.port} (${config.replicaMode})`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received; closing server`);
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
