import { createApp } from './app.js';
import { config } from './config.js';
import { client, connect } from './db.js';

if (config.jwtSecret.length < 32) throw new Error('JWT_SECRET doit contenir au moins 32 caractères');

await connect();
const server = createApp().listen(config.port, () => {
  console.log(`Regestion écoute sur le port ${config.port}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    server.close(async () => {
      await client.close();
      process.exit(0);
    });
    server.closeIdleConnections();
  });
}
