import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVeyraServer, type VeyraServerInstance } from '../src/index.js';

const servers: VeyraServerInstance[] = [];
const dirs: string[] = [];

afterEach(async () => {
  while (servers.length > 0) await servers.pop()!.stop();
  while (dirs.length > 0) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

async function startServer(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-server-side-work-'));
  dirs.push(dir);
  const instance = createVeyraServer({
    dbPath: path.join(dir, 'veyra.db'),
    port: 0,
    host: '127.0.0.1',
    enableTestClock: true,
    rolloverCheckIntervalMs: 60_000,
  });
  servers.push(instance);
  return (await instance.start()).url;
}

describe('PATCH /api/blocks/:id sideWork', () => {
  it('persists sideWork with autoSummary, returns it from GET, and rejects invalid payloads', async () => {
    const baseUrl = await startServer();
    const headers = { 'Content-Type': 'application/json', 'X-Veyra-Now': '2026-11-25T09:00:00.000Z' };

    const created = (await (
      await fetch(`${baseUrl}/api/blocks`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'Strategic Sourcing Figma' }),
      })
    ).json()) as { block: { id: string; sideWork: unknown } };
    expect(created.block.sideWork).toBeNull();

    const sideWork = [
      {
        projectId: null,
        projectName: 'Covestro',
        messageCount: 29,
        threads: [{ title: 'Run Daily Maintenance Flow', messageCount: 29 }],
      },
    ];
    const patchRes = await fetch(`${baseUrl}/api/blocks/${created.block.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ autoSummary: 'Reworked the packages page.', sideWork }),
    });
    expect(patchRes.status).toBe(200);
    expect(((await patchRes.json()) as { block: { sideWork: unknown } }).block.sideWork).toEqual(
      sideWork,
    );

    const detail = (await (await fetch(`${baseUrl}/api/blocks/${created.block.id}`)).json()) as {
      block: { autoSummary: string | null; sideWork: unknown };
    };
    expect(detail.block.autoSummary).toBe('Reworked the packages page.');
    expect(detail.block.sideWork).toEqual(sideWork);

    const invalidRes = await fetch(`${baseUrl}/api/blocks/${created.block.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ sideWork: [{ projectName: '', messageCount: 'many', threads: [] }] }),
    });
    expect(invalidRes.status).toBe(400);
  });
});
