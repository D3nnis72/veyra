import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createVeyraServer } from './app.js';

export * from './app.js';
export * from './macos-focus.js';
export * from './notion.js';
export * from './sse.js';
export * from './webhooks.js';
export * from './sync/types.js';
export * from './sync/ics-adapter.js';
export * from './sync/outlook-cli-adapter.js';
export * from './sync/sync-runner.js';

function isDirectEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    const resolved = fs.realpathSync(entry);
    return pathToFileURL(resolved).href === import.meta.url;
  } catch {
    return pathToFileURL(path.resolve(entry)).href === import.meta.url;
  }
}

async function runCli(): Promise<void> {
  const port = Number.parseInt(process.env.VEYRA_PORT ?? '4173', 10);
  const host = process.env.VEYRA_HOST ?? '127.0.0.1';
  const dbPath =
    process.env.VEYRA_DB_PATH ?? path.join(os.homedir(), '.veyra', 'veyra.db');
  const bearerToken = process.env.VEYRA_TOKEN;
  const notionToken = process.env.VEYRA_NOTION_TOKEN;
  const webDistDir = process.env.VEYRA_WEB_DIST_DIR;
  const enableTestClock = process.env.VEYRA_ENABLE_TEST_CLOCK === '1';

  const server = createVeyraServer({
    dbPath,
    port: Number.isNaN(port) ? 4173 : port,
    host,
    bearerToken,
    notionToken,
    webDistDir,
    enableTestClock,
  });

  const started = await server.start();
  console.log(`Veyra server listening on ${started.url} (db: ${dbPath})`);

  const shutdown = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

if (isDirectEntrypoint()) {
  runCli().catch((err) => {
    console.error('Failed to start Veyra server:', err);
    process.exit(1);
  });
}
