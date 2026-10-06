import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { buildContainer } from './container.js';

const config = loadConfig();
const server = createServer(createApp(buildContainer(config, { logger: console })));

server.listen(config.port, () => {
  process.stdout.write(`order-service listening on http://localhost:${config.port}\n`);
});
