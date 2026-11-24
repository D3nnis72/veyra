import { describe, expect, it } from 'vitest';
import {
  EMPTY_MENUBAR_FOCUS_STATE,
  applyFocusStatus,
  applyTodayProjects,
} from '../src/menubar-focus.js';
import { renderProjectTrayIconPng } from '../src/tray-icon.js';

describe('renderProjectTrayIconPng', () => {
  it('renders a valid 36x36 RGBA PNG for a project vector icon and monogram fallback', () => {
    const pngWithIcon = renderProjectTrayIconPng({
      name: 'Northstar',
      color: '#2E9E6F',
      icon: 'Layers',
    });
    // PNG signature + 36x36 dimensions in IHDR
    expect(pngWithIcon.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(pngWithIcon.readUInt32BE(16)).toBe(36);
    expect(pngWithIcon.readUInt32BE(20)).toBe(36);

    const pngMonogram = renderProjectTrayIconPng({
      name: 'Veyra',
      color: '#8B5CF6',
      icon: null,
    });
    expect(pngMonogram.readUInt32BE(16)).toBe(36);
    expect(pngMonogram.readUInt32BE(20)).toBe(36);
    expect(pngMonogram.equals(pngWithIcon)).toBe(false);
  });

  it('tracks activeProject from Today projects when focusing and clears it when idle', () => {
    const withFocus = applyFocusStatus(EMPTY_MENUBAR_FOCUS_STATE, {
      activeSession: {
        id: 's1',
        blockId: 'b1',
        startedAt: '2026-11-24T10:00:00.000Z',
        endedAt: null,
        note: null,
        updatedAt: '2026-11-24T10:00:00.000Z',
        deletedAt: null,
      },
      activeBlock: {
        id: 'b1',
        projectId: 'p1',
        goalId: null,
        title: 'Ship menu bar icon',
        isOps: false,
        bucket: 'scheduled',
        scheduledDate: '2026-11-24',
        plannedStartAt: null,
        plannedEndAt: null,
        dueDate: null,
        revisitAt: null,
        orderKey: 'a0',
        status: 'todo',
        carryoverCount: 0,
        energySignal: null,
        outcomeNote: null,
        resumeNote: null,
        autoSummary: null,
        recurrenceRule: null,
        seriesId: null,
        notes: '',
        externalLinks: [],
        updatedAt: '2026-11-24T10:00:00.000Z',
        deletedAt: null,
      },
      elapsedSeconds: 45,
      focusedTodayMinutes: 1,
    });

    const withProject = applyTodayProjects(withFocus, [
      { id: 'p1', name: 'Northstar', color: '#2E9E6F', icon: 'Layers' },
    ]);
    expect(withProject.activeProject).toEqual({
      id: 'p1',
      name: 'Northstar',
      color: '#2E9E6F',
      icon: 'Layers',
    });

    const cleared = applyFocusStatus(withProject, {
      activeSession: null,
      activeBlock: null,
      elapsedSeconds: 0,
      focusedTodayMinutes: 1,
    });
    expect(cleared.activeProject).toBeNull();
  });
});
