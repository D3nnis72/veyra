import { describe, expect, it, vi } from 'vitest';
import { createBlock, createProject, listActivity, updateSettings } from '@veyra/core';
import { createVeyraServer } from '../src/app.js';

describe('macOS Focus Mode Presence', () => {
  it('runs start/end shortcuts on focus transitions and avoids flicker when switching blocks', async () => {
    const calls: Array<{ binary: string; args: readonly string[] }> = [];
    const execRunner = vi.fn(async (binary: string, args: readonly string[]) => {
      calls.push({ binary, args });
      if (args[0] === 'list') {
        return { stdout: 'Veyra Focus On\nVeyra Focus Off\nOther Shortcut\n', stderr: '' };
      }
      return { stdout: '', stderr: '' };
    });

    const server = createVeyraServer({
      dbPath: ':memory:',
      macosFocusOptions: {
        platform: 'darwin',
        execRunner,
      },
    });

    try {
      const project = createProject(server.db, { name: 'Alpha', color: '#3B4BD8' });
      const blockA = createBlock(server.db, {
        title: 'Write API tests',
        projectId: project.id,
        bucket: 'scheduled',
        scheduledDate: '2026-11-24',
      });
      const blockB = createBlock(server.db, {
        title: 'Review PR',
        projectId: project.id,
        bucket: 'scheduled',
        scheduledDate: '2026-11-24',
      });

      // Enable macOS Focus shortcuts via PATCH /api/settings
      const patchRes = await server.app.request('/api/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          macosFocusEnabled: true,
          macosFocusStartShortcut: 'Veyra Focus On',
          macosFocusEndShortcut: 'Veyra Focus Off',
        }),
      });
      expect(patchRes.status).toBe(200);
      const patched = (await patchRes.json()) as {
        settings: {
          macosFocusEnabled: boolean;
          macosFocusStartShortcut: string | null;
          macosFocusEndShortcut: string | null;
        };
      };
      expect(patched.settings.macosFocusEnabled).toBe(true);
      expect(patched.settings.macosFocusStartShortcut).toBe('Veyra Focus On');
      expect(patched.settings.macosFocusEndShortcut).toBe('Veyra Focus Off');

      // Start Block A -> triggers start shortcut once
      const startA = await server.app.request('/api/focus/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blockId: blockA.id }),
      });
      expect(startA.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(calls).toHaveLength(1);
      expect(calls[0]?.args).toEqual(['run', 'Veyra Focus On']);

      // Switch directly to Block B -> keeps macOS Focus active without flickering
      const startB = await server.app.request('/api/focus/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blockId: blockB.id }),
      });
      expect(startB.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(calls).toHaveLength(1);

      // Pause focus -> runs end shortcut
      const pauseRes = await server.app.request('/api/focus/pause', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ note: 'Back after standup' }),
      });
      expect(pauseRes.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(calls).toHaveLength(2);
      expect(calls[1]?.args).toEqual(['run', 'Veyra Focus Off']);

      // Resume Block B -> runs start shortcut again
      const resumeRes = await server.app.request('/api/focus/resume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blockId: blockB.id }),
      });
      expect(resumeRes.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(calls).toHaveLength(3);
      expect(calls[2]?.args).toEqual(['run', 'Veyra Focus On']);

      // Complete Block B -> runs end shortcut
      const completeRes = await server.app.request('/api/focus/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ blockId: blockB.id, energySignal: 'up' }),
      });
      expect(completeRes.status).toBe(200);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(calls).toHaveLength(4);
      expect(calls[3]?.args).toEqual(['run', 'Veyra Focus Off']);

      // List installed shortcuts endpoint
      const listRes = await server.app.request('/api/integrations/macos-focus/shortcuts');
      expect(listRes.status).toBe(200);
      const listJson = (await listRes.json()) as { supported: boolean; shortcuts: string[] };
      expect(listJson).toEqual({
        supported: true,
        shortcuts: ['Veyra Focus On', 'Veyra Focus Off', 'Other Shortcut'],
      });

      // Test endpoint with unsaved override name
      const testRes = await server.app.request('/api/integrations/macos-focus/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phase: 'start', shortcutName: 'Custom Focus' }),
      });
      expect(testRes.status).toBe(200);
      const testJson = (await testRes.json()) as {
        result: { ok: boolean; phase: string; shortcutName: string; skipped: boolean };
      };
      expect(testJson.result).toMatchObject({
        ok: true,
        phase: 'start',
        shortcutName: 'Custom Focus',
        skipped: false,
      });

      const logs = listActivity(server.db, { limit: 20 });
      expect(logs.some((entry) => entry.action === 'macos_focus.activated')).toBe(true);
      expect(logs.some((entry) => entry.action === 'macos_focus.deactivated')).toBe(true);
    } finally {
      await server.stop();
    }
  });

  it('skips cleanly on non-macOS hosts and records failures without breaking focus routes', async () => {
    const execRunner = vi.fn(async () => {
      throw new Error('Shortcut not found');
    });

    const linuxServer = createVeyraServer({
      dbPath: ':memory:',
      macosFocusOptions: {
        platform: 'linux',
        execRunner,
      },
    });

    try {
      updateSettings(linuxServer.db, {
        macosFocusEnabled: true,
        macosFocusStartShortcut: 'Veyra Focus On',
      });

      const listRes = await linuxServer.app.request('/api/integrations/macos-focus/shortcuts');
      expect(listRes.status).toBe(200);
      expect(await listRes.json()).toEqual({ supported: false, shortcuts: [] });

      const testRes = await linuxServer.app.request('/api/integrations/macos-focus/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phase: 'start' }),
      });
      expect(testRes.status).toBe(200);
      const testJson = (await testRes.json()) as {
        result: { ok: boolean; skipped: boolean; reason?: string };
      };
      expect(testJson.result.ok).toBe(false);
      expect(testJson.result.skipped).toBe(true);
      expect(execRunner).not.toHaveBeenCalled();
    } finally {
      await linuxServer.stop();
    }

    const darwinFailServer = createVeyraServer({
      dbPath: ':memory:',
      macosFocusOptions: {
        platform: 'darwin',
        execRunner,
      },
    });

    try {
      updateSettings(darwinFailServer.db, {
        macosFocusEnabled: true,
        macosFocusStartShortcut: 'Missing Shortcut',
      });
      const res = await darwinFailServer.app.request('/api/integrations/macos-focus/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phase: 'start' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result: { ok: boolean; error?: string } };
      expect(body.result.ok).toBe(false);
      expect(body.result.error).toContain('Shortcut not found');
    } finally {
      await darwinFailServer.stop();
    }
  });
});
