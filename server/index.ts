import 'dotenv/config';
import { app } from './app.ts';
import { config } from './config.ts';
import { closeDatabase } from './database.ts';

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`ApexDB API listening on port ${config.port} (${config.replicaMode})`);
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
