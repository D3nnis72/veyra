import { describe, expect, it } from 'vitest';
import {
  applyFocusStatus,
  applyTodayProjects,
  computeTrayPopoverBounds,
  EMPTY_MENUBAR_FOCUS_STATE,
} from '../src/menubar-focus.js';
import { renderProjectTrayIconPng } from '../src/tray-icon.js';

describe('renderProjectTrayIconPng', () => {
  it('renders a valid 36x36 RGBA PNG that reflects distinct project accent colors', () => {
    const pngEmerald = renderProjectTrayIconPng({
      name: 'Northstar',
      color: '#2E9E6F',
      icon: 'Layers',
    });
    // PNG signature + 36x36 dimensions in IHDR
    expect(pngEmerald.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(pngEmerald.readUInt32BE(16)).toBe(36);
    expect(pngEmerald.readUInt32BE(20)).toBe(36);

    const pngViolet = renderProjectTrayIconPng({
      name: 'Veyra',
      color: '#8B5CF6',
      icon: null,
    });
    expect(pngViolet.readUInt32BE(16)).toBe(36);
    expect(pngViolet.readUInt32BE(20)).toBe(36);
    expect(pngViolet.equals(pngEmerald)).toBe(false);

    // Falls back gracefully for invalid hex
    const pngFallback = renderProjectTrayIconPng({
      name: 'Fallback',
      color: 'not-a-color',
    });
    expect(pngFallback.readUInt32BE(16)).toBe(36);
    expect(pngFallback.readUInt32BE(20)).toBe(36);
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
        sizeMinutes: null,
        energySignal: null,
        senseSignal: null,
        dropReason: null,
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

describe('computeTrayPopoverBounds', () => {
  it('centers the popover under the tray icon and clamps it within screen workArea', () => {
    const workArea = { x: 0, y: 25, width: 1512, height: 957 };

    const centered = computeTrayPopoverBounds(
      { x: 1000, y: 0, width: 28, height: 24 },
      workArea,
      300,
      180,
    );
    expect(centered).toEqual({ x: 864, y: 30, width: 300, height: 180 });

    // Clamps to right edge when tray icon sits near the far right of the menu bar
    const clampedRight = computeTrayPopoverBounds(
      { x: 1480, y: 0, width: 24, height: 24 },
      workArea,
      300,
      180,
    );
    expect(clampedRight.x).toBe(1512 - 300 - 8);
    expect(clampedRight.y).toBe(30);

    // Clamps to left edge on secondary monitors with negative x offset
    const secondaryWorkArea = { x: -1920, y: 25, width: 1920, height: 1055 };
    const clampedLeft = computeTrayPopoverBounds(
      { x: -1910, y: 0, width: 24, height: 24 },
      secondaryWorkArea,
      300,
      180,
    );
    expect(clampedLeft.x).toBe(-1912);
  });
});
