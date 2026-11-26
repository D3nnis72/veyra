import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createBlock,
  getBlockDetail,
  openVeyraDb,
  updateBlock,
  type BlockSideWorkEntry,
} from '../src/index.js';

const NOW = '2026-11-25T09:00:00.000Z';

const SIDE_WORK: BlockSideWorkEntry[] = [
  {
    projectId: '11111111-1111-4111-8111-111111111111',
    projectName: 'Covestro',
    messageCount: 29,
    threads: [{ title: 'Run Daily Maintenance Flow', messageCount: 29 }],
  },
  {
    projectId: null,
    projectName: 'Workspace',
    messageCount: 3,
    threads: [{ title: 'Scratch', messageCount: 3 }],
  },
];

describe('block sideWork', () => {
  it('defaults to null, round-trips with autoSummary, survives unrelated updates, and clears', () => {
    const veyraDb = openVeyraDb(':memory:');
    try {
      const created = createBlock(veyraDb, { title: 'Strategic Sourcing Figma' }, { now: NOW });
      expect(created.sideWork).toBeNull();
      expect(getBlockDetail(veyraDb, created.id, NOW).sideWork).toBeNull();

      const updated = updateBlock(
        veyraDb,
        created.id,
        { autoSummary: 'Reworked the packages page in Figma.', sideWork: SIDE_WORK },
        { now: NOW },
      );
      expect(updated.sideWork).toEqual(SIDE_WORK);

      const detail = getBlockDetail(veyraDb, created.id, NOW);
      expect(detail.autoSummary).toBe('Reworked the packages page in Figma.');
      expect(detail.sideWork).toEqual(SIDE_WORK);

      updateBlock(veyraDb, created.id, { title: 'Strategic Sourcing Figma v2' }, { now: NOW });
      expect(getBlockDetail(veyraDb, created.id, NOW).sideWork).toEqual(SIDE_WORK);

      updateBlock(veyraDb, created.id, { sideWork: null }, { now: NOW });
      expect(getBlockDetail(veyraDb, created.id, NOW).sideWork).toBeNull();
    } finally {
      veyraDb.sqlite.close();
    }
  });

  it('rejects malformed sideWork entries', () => {
    const veyraDb = openVeyraDb(':memory:');
    try {
      const created = createBlock(veyraDb, { title: 'Block' }, { now: NOW });
      expect(() =>
        updateBlock(
          veyraDb,
          created.id,
          // missing projectName and negative count
          { sideWork: [{ projectId: null, messageCount: -1, threads: [] }] } as never,
          { now: NOW },
        ),
      ).toThrow();
    } finally {
      veyraDb.sqlite.close();
    }
  });

  it('adds blocks.side_work to legacy databases via additive migration', async () => {
    const { default: Database } = await import('better-sqlite3');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyra-core-side-work-'));
    const dbPath = path.join(tmpDir, 'legacy.db');
    try {
      const legacy = new Database(dbPath);
      legacy.exec(`
        CREATE TABLE blocks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          goal_id TEXT,
          title TEXT NOT NULL,
          is_ops INTEGER NOT NULL DEFAULT 0,
          bucket TEXT NOT NULL DEFAULT 'inbox',
          scheduled_date TEXT,
          planned_start_at TEXT,
          planned_end_at TEXT,
          due_date TEXT,
          revisit_at TEXT,
          order_key TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'todo',
          carryover_count INTEGER NOT NULL DEFAULT 0,
          energy_signal TEXT,
          outcome_note TEXT,
          resume_note TEXT,
          auto_summary TEXT,
          recurrence_rule TEXT,
          series_id TEXT,
          notes TEXT NOT NULL DEFAULT '',
          external_links TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );
      `);
      legacy.close();

      const upgraded = openVeyraDb(dbPath);
      try {
        const cols = upgraded.sqlite.prepare('PRAGMA table_info(blocks)').all() as Array<{
          name: string;
        }>;
        expect(cols.some((c) => c.name === 'side_work')).toBe(true);
      } finally {
        upgraded.sqlite.close();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
