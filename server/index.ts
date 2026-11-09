import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { closeDb } from './db/client.js';

const c = config();
const app = createApp();
const server = createServer(app);

server.listen(c.PORT, () => {
  console.info(`DevRelay API listening on port ${c.PORT} (${c.NODE_ENV})`);
});

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.info(`Received ${signal}; shutting down`);
  const force = setTimeout(() => { console.error('Forced shutdown after timeout'); process.exit(1); }, 15_000);
  force.unref();
  server.close(async error => {
    if (error) console.error('HTTP server close failed', { name: error.name });
    try { await closeDb(); } catch { /* pool may already be closed */ }
    clearTimeout(force);
    process.exit(error ? 1 : 0);
  });
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
