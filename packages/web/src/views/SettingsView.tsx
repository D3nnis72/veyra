import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type CalendarSyncMode,
  type Goal,
  type GoalStatus,
  PROJECT_ACCENT_COLORS,
  type UpdateSettingsInput,
  type WebhookEventName,
} from '@veyra/core/types';
import {
  Check,
  Copy,
  FileText,
  Monitor,
  Moon,
  PlugZap,
  Plus,
  RefreshCw,
  Send,
  Server,
  Sun,
  Terminal,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import {
  apiClient,
  isElectronDesktop,
  refreshClientConfig,
} from '../api/client';
import {
  invalidateAllVeyraData,
  useActivityQuery,
  useGoalsQuery,
  useProjectsQuery,
  useSettingsQuery,
} from '../api/queries';
import type { SettingsSection } from '../app/AppShellContext';
import { Button } from '../components/Button';
import { Pill } from '../components/Pill';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { formatLocalTime, formatShortDate, getTodayDateString } from '../components/icons';

export interface SettingsViewProps {
  section: SettingsSection;
}

const WEBHOOK_EVENTS: Array<{ id: WebhookEventName; label: string; description: string }> = [
  { id: 'focus.started', label: 'focus.started', description: 'Fires when a focus timer starts' },
  { id: 'focus.ended', label: 'focus.ended', description: 'Fires when a focus timer pauses or stops' },
  {
    id: 'block.completed',
    label: 'block.completed',
    description: 'Fires when a focus block is completed with outcome & energy',
  },
];

export function SettingsView({ section }: SettingsViewProps) {
  return (
    <div className="max-w-[760px] mx-auto px-7 py-7 space-y-6">
      {section === 'goals' ? <GoalsSettingsSection /> : null}
      {section === 'integrations' ? <IntegrationsSettingsSection /> : null}
      {section === 'shortcuts' ? <ShortcutsSettingsSection /> : null}
      {section === 'server' ? <ServerCliSettingsSection /> : null}
      {section === 'appearance' ? <AppearanceSettingsSection /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Goals Section
// ---------------------------------------------------------------------------

function GoalsSettingsSection() {
  const queryClient = useQueryClient();
  const goalsQuery = useGoalsQuery({ includeArchived: true });
  const goals = goalsQuery.data?.goals ?? [];

  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newColor, setNewColor] = useState<string>(PROJECT_ACCENT_COLORS[0]);

  const invalidateGoals = () => {
    void queryClient.invalidateQueries({ queryKey: ['goals'] });
    void queryClient.invalidateQueries({ queryKey: ['today'] });
    void queryClient.invalidateQueries({ queryKey: ['plan'] });
    void queryClient.invalidateQueries({ queryKey: ['review'] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.createGoal({
        name: newName.trim(),
        description: newDescription.trim(),
        color: newColor,
      }),
    onSuccess: () => {
      setNewName('');
      setNewDescription('');
      invalidateGoals();
    },
  });

  const handleCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || createMutation.isPending) return;
    createMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-[24px] font-semibold text-[#EDEDED]">Goals</h1>
        <p className="text-[13px] text-[#9A9A9A]">
          Define 1–4 strategic outcomes. Projects inherit a default goal and Review tracks focus
          alignment automatically.
        </p>
      </header>

      {/* Inline Create Goal Card */}
      <form onSubmit={handleCreate} className="veyra-card space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
          Add Goal
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Goal name (e.g. Ship Veyra v1)"
            aria-label="Goal name"
            className="h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
          />
          <input
            type="text"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Short description (optional)"
            aria-label="Goal description"
            className="h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
          />
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
          <div className="flex items-center gap-1.5">
            {PROJECT_ACCENT_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Color ${swatch}`}
                onClick={() => setNewColor(swatch)}
                style={{ backgroundColor: swatch }}
                className={`w-5 h-5 rounded-full transition-transform ${
                  newColor === swatch
                    ? 'ring-2 ring-offset-2 ring-offset-[#1C1C1C] ring-white scale-105'
                    : 'opacity-75 hover:opacity-100'
                }`}
              />
            ))}
          </div>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            leftIcon={<Plus size={13} />}
            disabled={!newName.trim() || createMutation.isPending}
          >
            Add Goal
          </Button>
        </div>
      </form>

      {/* Existing Goals */}
      <div className="space-y-2.5">
        {goals.length === 0 ? (
          <div className="veyra-card text-[13px] text-[#6E6E6E]">No goals created yet.</div>
        ) : (
          goals.map((goal) => (
            <GoalRow key={goal.id} goal={goal} onChanged={invalidateGoals} />
          ))
        )}
      </div>
    </div>
  );
}

function GoalRow({ goal, onChanged }: { goal: Goal; onChanged: () => void }) {
  const [name, setName] = useState(goal.name);
  const [description, setDescription] = useState(goal.description);

  useEffect(() => {
    setName(goal.name);
    setDescription(goal.description);
  }, [goal.id, goal.name, goal.description]);

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof apiClient.updateGoal>[1]) =>
      apiClient.updateGoal(goal.id, input),
    onSuccess: onChanged,
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiClient.deleteGoal(goal.id),
    onSuccess: onChanged,
  });

  const flushText = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed !== goal.name || description !== goal.description) {
      updateMutation.mutate({ name: trimmed, description });
    }
  };

  return (
    <div className="veyra-card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <span
            className="w-3 h-3 rounded-full mt-1.5 shrink-0"
            style={{ backgroundColor: goal.color }}
          />
          <div className="flex-1 min-w-0 space-y-1">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={flushText}
              aria-label={`Edit goal ${goal.name}`}
              className="w-full bg-transparent text-[14.5px] font-medium text-[#EDEDED] focus:outline-none"
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={flushText}
              placeholder="Add description…"
              className="w-full bg-transparent text-[12.5px] text-[#9A9A9A] placeholder:text-[#6E6E6E] focus:outline-none"
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {(['active', 'achieved'] as GoalStatus[]).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => updateMutation.mutate({ status: st })}
              className={[
                'h-6 px-2 rounded-[6px] border text-[11px] font-medium capitalize transition-colors',
                goal.status === st
                  ? st === 'achieved'
                    ? 'bg-[#14331F] border-[#2FB463]/60 text-[#7BE0A0]'
                    : 'bg-[#1F2759] border-[#5566F2]/55 text-[#D6DCFF]'
                  : 'bg-[#262626] border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED]',
              ].join(' ')}
            >
              {st}
            </button>
          ))}
          <button
            type="button"
            aria-label={`Delete goal ${goal.name}`}
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            className="h-6 w-6 rounded-[6px] inline-flex items-center justify-center text-[#6E6E6E] hover:text-[#FF9EC5] hover:bg-[#3D1A2B]/60 transition-colors"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 pt-2 border-t border-[#2A2A2A]">
        {PROJECT_ACCENT_COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={`Set ${goal.name} color ${swatch}`}
            onClick={() => updateMutation.mutate({ color: swatch })}
            style={{ backgroundColor: swatch }}
            className={`w-4 h-4 rounded-full ${
              goal.color.toUpperCase() === swatch.toUpperCase()
                ? 'ring-2 ring-offset-1 ring-offset-[#1C1C1C] ring-white'
                : 'opacity-65 hover:opacity-100'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Integrations & Outlook Sync Section
// ---------------------------------------------------------------------------

const HOOK_LISTEN_SNIPPET = `veyra hook listen --port 4174 \\
  --on-complete './scripts/summarize-block.sh'`;

function formatActivityTimestamp(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const dateStr = getTodayDateString(dt);
  return `${formatShortDate(dateStr)} · ${formatLocalTime(iso)}`;
}

function IntegrationsSettingsSection() {
  const queryClient = useQueryClient();
  const settingsQuery = useSettingsQuery();
  const projectsQuery = useProjectsQuery({ includeArchived: false });
  const hookActivityQuery = useActivityQuery({ actor: 'hook', limit: 10 });

  const settings = settingsQuery.data?.settings;
  const syncStatus = settingsQuery.data?.calendarSyncStatus;
  const hookLogs = hookActivityQuery.data?.activity ?? [];
  const notionConfigured =
    settingsQuery.data?.notionConfigured ?? settings?.notionConfigured ?? false;
  const notionTokenSource = settings?.notionTokenSource ?? null;
  const projectsWithNotion = (projectsQuery.data?.projects ?? []).filter((p) => Boolean(p.notionUrl));

  const [syncMode, setSyncMode] = useState<CalendarSyncMode>('outlook_cli');
  const [outlookCmd, setOutlookCmd] = useState('');
  const [icsFeedUrl, setIcsFeedUrl] = useState('');
  const [syncIntervalMin, setSyncIntervalMin] = useState('15');
  const [skipDeclined, setSkipDeclined] = useState(true);

  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<WebhookEventName[]>([
    'focus.started',
    'focus.ended',
    'block.completed',
  ]);
  const [notionTokenInput, setNotionTokenInput] = useState('');
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [hookNotice, setHookNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [copiedHookSnippet, setCopiedHookSnippet] = useState(false);
  const [notionNotice, setNotionNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!settings) return;
    setSyncMode(settings.calendarSyncMode);
    setOutlookCmd(settings.outlookCliCommand ?? '');
    setIcsFeedUrl(settings.icsFeedUrl ?? '');
    setSyncIntervalMin(String(settings.calendarSyncIntervalMin));
    setSkipDeclined(settings.skipDeclinedAndAllDay);
    setWebhookUrl(settings.webhookUrl ?? '');
    setWebhookEvents(settings.webhookEvents);
  }, [settings?.updatedAt]);

  const updateSettingsMutation = useMutation({
    mutationFn: (input: UpdateSettingsInput) => apiClient.updateSettings(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['notion-search'] });
      setSaveNotice('Settings saved');
      window.setTimeout(() => setSaveNotice(null), 1800);
    },
  });

  const testNotionMutation = useMutation({
    mutationFn: (overrideToken?: string) => apiClient.testNotionConnection(overrideToken),
    onSuccess: (res) => {
      if (res.result.ok) {
        const target = res.result.workspaceName ?? res.result.botName ?? 'Notion';
        setNotionNotice({
          ok: true,
          text: `Connected to ${target}`,
        });
      } else {
        setNotionNotice({
          ok: false,
          text: res.result.error ?? `Connection failed (HTTP ${res.result.statusCode ?? 'none'})`,
        });
      }
    },
    onError: (err) => {
      setNotionNotice({
        ok: false,
        text: err instanceof Error ? err.message : 'Notion connection test failed',
      });
    },
  });

  const syncNowMutation = useMutation({
    mutationFn: () => apiClient.syncEvents(),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      void queryClient.invalidateQueries({ queryKey: ['plan'] });
      setSyncNotice(
        res.error
          ? `Sync error: ${res.error}`
          : `Synced ${res.result.upsertedCount} event(s) (${res.result.skippedCount} skipped)`,
      );
    },
    onError: (err) => {
      setSyncNotice(err instanceof Error ? err.message : 'Calendar sync failed');
    },
  });

  const testHookMutation = useMutation({
    mutationFn: () => apiClient.testHook(),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
      if (res.result.delivered) {
        setHookNotice({
          ok: true,
          text: `Test webhook delivered (HTTP ${res.result.statusCode ?? 200})`,
        });
      } else {
        setHookNotice({
          ok: false,
          text:
            res.result.error ??
            `Delivery failed (HTTP ${res.result.statusCode ?? 'none'})`,
        });
      }
    },
    onError: (err) => {
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
      setHookNotice({
        ok: false,
        text: err instanceof Error ? err.message : 'Test webhook failed',
      });
    },
  });

  const handleCopyHookSnippet = async () => {
    try {
      await navigator.clipboard.writeText(HOOK_LISTEN_SNIPPET);
      setCopiedHookSnippet(true);
      window.setTimeout(() => setCopiedHookSnippet(false), 1600);
    } catch {
      // Clipboard unavailable in headless test environments
    }
  };

  const handleSaveSync = (e: FormEvent) => {
    e.preventDefault();
    const interval = Math.min(1440, Math.max(1, Number.parseInt(syncIntervalMin, 10) || 15));
    updateSettingsMutation.mutate({
      calendarSyncMode: syncMode,
      outlookCliCommand: outlookCmd.trim() || null,
      icsFeedUrl: icsFeedUrl.trim() || null,
      calendarSyncIntervalMin: interval,
      skipDeclinedAndAllDay: skipDeclined,
    });
  };

  const toggleWebhookEvent = (ev: WebhookEventName) => {
    setWebhookEvents((prev) =>
      prev.includes(ev) ? prev.filter((item) => item !== ev) : [...prev, ev],
    );
  };

  const handleSaveWebhook = (e: FormEvent) => {
    e.preventDefault();
    updateSettingsMutation.mutate({
      webhookUrl: webhookUrl.trim() || null,
      webhookEvents,
    });
  };

  const handleSaveNotionToken = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = notionTokenInput.trim();
    if (!trimmed) return;
    setNotionNotice(null);
    updateSettingsMutation.mutate(
      { notionToken: trimmed },
      {
        onSuccess: () => {
          setNotionTokenInput('');
          setNotionNotice({ ok: true, text: 'Notion token saved securely on server' });
        },
      },
    );
  };

  const handleClearNotionToken = () => {
    setNotionNotice(null);
    updateSettingsMutation.mutate(
      { notionToken: null },
      {
        onSuccess: () => {
          setNotionTokenInput('');
          setNotionNotice({ ok: true, text: 'Stored Notion token removed' });
        },
      },
    );
  };

  const statusTone =
    syncStatus?.state === 'connected'
      ? 'energy-up'
      : syncStatus?.state === 'error'
        ? 'energy-down'
        : 'neutral';
  const statusLabel =
    syncStatus?.state === 'connected'
      ? `Connected · ${syncStatus.lastCount} events`
      : syncStatus?.state === 'error'
        ? 'Sync Error'
        : 'Manual / CLI Push';

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="font-display text-[24px] font-semibold text-[#EDEDED]">
            Integrations &amp; Outlook Sync
          </h1>
          <p className="text-[13px] text-[#9A9A9A]">
            Pull real meetings into Today, Plan, and Calendar, and dispatch focus events to external
            workflows.
          </p>
        </div>
        {saveNotice ? (
          <Pill tone="energy-up" icon={<Check size={10} />}>
            {saveNotice}
          </Pill>
        ) : null}
      </header>

      {/* Calendar Sync Card */}
      <form onSubmit={handleSaveSync} className="veyra-card space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="space-y-0.5">
            <div className="text-[14px] font-semibold text-[#EDEDED]">
              Outlook &amp; Calendar Sync
            </div>
            <div className="text-[12px] text-[#9A9A9A] tabular-nums">
              {syncStatus?.lastSyncAt
                ? `Last synced at ${formatLocalTime(syncStatus.lastSyncAt)}`
                : 'Not synced yet'}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Pill tone={statusTone} dot>
              {statusLabel}
            </Pill>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={
                <RefreshCw
                  size={12}
                  className={syncNowMutation.isPending ? 'animate-spin' : ''}
                />
              }
              onClick={() => syncNowMutation.mutate()}
              disabled={syncNowMutation.isPending}
            >
              Sync Now
            </Button>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(
            [
              { id: 'outlook_cli', label: 'Outlook CLI (local)', hint: 'Runs local CLI command' },
              { id: 'ics', label: 'ICS / CalDAV Feed', hint: 'Polls secret .ics URL' },
              { id: 'manual', label: 'Manual / CLI Push', hint: 'POST /api/events/upsert' },
            ] as Array<{ id: CalendarSyncMode; label: string; hint: string }>
          ).map((opt) => {
            const active = syncMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setSyncMode(opt.id)}
                className={[
                  'p-3 rounded-[8px] border text-left transition-colors space-y-0.5',
                  active
                    ? 'bg-[#1F2759] border-[#5566F2] text-[#EDEDED]'
                    : 'bg-[#262626] border-[#3C3C3C] text-[#C4C4C4] hover:border-[#4E4E4E]',
                ].join(' ')}
              >
                <div className="text-[12.5px] font-medium">{opt.label}</div>
                <div className="text-[11px] text-[#9A9A9A]">{opt.hint}</div>
              </button>
            );
          })}
        </div>

        {syncMode === 'outlook_cli' ? (
          <div className="space-y-1.5">
            <label htmlFor="outlook-cli-cmd" className="text-[11.5px] text-[#9A9A9A] block">
              Outlook CLI Command
            </label>
            <input
              id="outlook-cli-cmd"
              type="text"
              value={outlookCmd}
              onChange={(e) => setOutlookCmd(e.target.value)}
              placeholder="lio-outlook calendar list --json"
              className="w-full h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[12.5px] font-mono text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
            />
          </div>
        ) : syncMode === 'ics' ? (
          <div className="space-y-1.5">
            <label htmlFor="ics-feed-url" className="text-[11.5px] text-[#9A9A9A] block">
              ICS / CalDAV Feed URL
            </label>
            <input
              id="ics-feed-url"
              type="text"
              value={icsFeedUrl}
              onChange={(e) => setIcsFeedUrl(e.target.value)}
              placeholder="https://outlook.office365.com/owa/calendar/…/reachcalendar.ics"
              className="w-full h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[12.5px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
            />
          </div>
        ) : (
          <div className="text-[12.5px] text-[#9A9A9A]">
            Push normalized meetings from any local script or agent using{' '}
            <code className="text-[#AEB8FF]">veyra events sync</code> or{' '}
            <code className="text-[#AEB8FF]">POST /api/events/upsert</code>.
          </div>
        )}

        <div className="flex items-center justify-between gap-4 flex-wrap pt-2 border-t border-[#2A2A2A]">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="inline-flex items-center gap-2 text-[12.5px] text-[#C4C4C4]">
              <span>Interval (min)</span>
              <input
                type="number"
                min={1}
                max={1440}
                value={syncIntervalMin}
                onChange={(e) => setSyncIntervalMin(e.target.value)}
                className="w-16 h-8 px-2 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[12.5px] text-[#EDEDED] tabular-nums focus:outline-none focus:border-[#5566F2]"
              />
            </label>
            <ToggleSwitch
              id="skip-declined-toggle"
              checked={skipDeclined}
              onChange={setSkipDeclined}
              label="Skip declined & all-day"
              size="sm"
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={updateSettingsMutation.isPending}
          >
            Save Sync Settings
          </Button>
        </div>

        {syncStatus?.lastError ? (
          <div className="pt-2 border-t border-[#2A2A2A] text-[12px] text-[#FF9EC5]">
            Last error: {syncStatus.lastError}
          </div>
        ) : null}
        {syncNotice ? (
          <div className="text-[12px] text-[#C4C4C4]">{syncNotice}</div>
        ) : null}
      </form>

      {/* Event Webhooks Card */}
      <div className="veyra-card space-y-5">
        <form onSubmit={handleSaveWebhook} className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[14px] font-semibold text-[#EDEDED]">Event Webhooks</div>
              <div className="text-[12px] text-[#9A9A9A]">
                POST structured JSON payloads to local CLI listeners, agent scripts, or external
                workflows.
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Send size={12} />}
              onClick={() => testHookMutation.mutate()}
              disabled={testHookMutation.isPending}
            >
              Test Hook
            </Button>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="webhook-url-input" className="text-[11.5px] text-[#9A9A9A] block">
              Webhook Endpoint URL
            </label>
            <input
              id="webhook-url-input"
              type="text"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="http://127.0.0.1:4174/webhook"
              className="w-full h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
            />
          </div>

          <div className="space-y-2.5 pt-2 border-t border-[#2A2A2A]">
            {WEBHOOK_EVENTS.map((ev) => (
              <div key={ev.id} className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12.5px] font-mono text-[#EDEDED]">{ev.label}</div>
                  <div className="text-[11.5px] text-[#9A9A9A]">{ev.description}</div>
                </div>
                <ToggleSwitch
                  checked={webhookEvents.includes(ev.id)}
                  onChange={() => toggleWebhookEvent(ev.id)}
                  size="sm"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#2A2A2A]">
            <div className="text-[12px]">
              {hookNotice ? (
                <span className={hookNotice.ok ? 'text-[#7BE0A0]' : 'text-[#FF9EC5]'}>
                  {hookNotice.text}
                </span>
              ) : null}
            </div>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={updateSettingsMutation.isPending}
            >
              Save Webhook
            </Button>
          </div>
        </form>

        {/* Copyable CLI Hook Listener Snippet */}
        <div className="pt-4 border-t border-[#2A2A2A] space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E] inline-flex items-center gap-1.5">
              <Terminal size={12} className="text-[#AEB8FF]" />
              <span>Local Listener (CLI)</span>
            </span>
            <Button
              variant="secondary"
              size="xs"
              leftIcon={copiedHookSnippet ? <Check size={11} /> : <Copy size={11} />}
              onClick={() => void handleCopyHookSnippet()}
            >
              {copiedHookSnippet ? 'Copied' : 'Copy snippet'}
            </Button>
          </div>
          <pre className="px-3 py-2.5 rounded-[8px] bg-[#171717] border border-[#2A2A2A] text-[12px] font-mono text-[#C4C4C4] overflow-x-auto leading-relaxed">
            {HOOK_LISTEN_SNIPPET}
          </pre>
          <p className="text-[11.5px] text-[#9A9A9A]">
            Receives lifecycle JSON on stdin plus <code className="text-[#C4C4C4]">VEYRA_BLOCK_ID</code>{' '}
            and <code className="text-[#C4C4C4]">VEYRA_SESSION_*</code> env vars so agent scripts can
            write back via <code className="text-[#AEB8FF]">veyra summary set</code>.
          </p>
        </div>

        {/* Recent Webhook Deliveries */}
        <div className="pt-4 border-t border-[#2A2A2A] space-y-2.5" aria-label="Webhook Delivery Diagnostics">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                Recent Deliveries
              </span>
              <span className="text-[11px] text-[#6E6E6E] tabular-nums">{hookLogs.length}</span>
            </div>
            <button
              type="button"
              onClick={() => void hookActivityQuery.refetch()}
              disabled={hookActivityQuery.isFetching}
              aria-label="Refresh webhook deliveries"
              className="text-[11.5px] text-[#9A9A9A] hover:text-[#EDEDED] inline-flex items-center gap-1 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={11} className={hookActivityQuery.isFetching ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>

          {hookActivityQuery.isLoading ? (
            <div className="text-[12px] text-[#6E6E6E]">Loading delivery logs…</div>
          ) : hookLogs.length === 0 ? (
            <div className="text-[12px] text-[#6E6E6E]">
              No webhook deliveries recorded yet. Save a URL above and click Test Hook.
            </div>
          ) : (
            <ul className="divide-y divide-[#262626]">
              {hookLogs.map((entry) => {
                const isDelivered = entry.action === 'webhook.delivered';
                const isFailed = entry.action === 'webhook.failed';
                return (
                  <li
                    key={entry.id}
                    className="py-2 first:pt-0 last:pb-0 flex items-start justify-between gap-3"
                  >
                    <div className="flex items-start gap-2 min-w-0">
                      <Pill
                        tone={isDelivered ? 'energy-up' : isFailed ? 'energy-down' : 'neutral'}
                        dot
                        className="mt-0.5 shrink-0"
                      >
                        {isDelivered ? 'Delivered' : isFailed ? 'Failed' : entry.action}
                      </Pill>
                      <span className="text-[12px] text-[#C4C4C4] leading-snug break-words min-w-0">
                        {entry.summary}
                      </span>
                    </div>
                    <span className="text-[11px] text-[#6E6E6E] tabular-nums shrink-0 mt-0.5">
                      {formatActivityTimestamp(entry.createdAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Notion Links Integration Card */}
      <form onSubmit={handleSaveNotionToken} className="veyra-card space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span className="w-8 h-8 rounded-[8px] bg-[#262626] border border-[#3C3C3C] inline-flex items-center justify-center text-[#C4C4C4] shrink-0">
              <FileText size={15} />
            </span>
            <div className="space-y-0.5 min-w-0">
              <div className="text-[14px] font-semibold text-[#EDEDED]">Notion Links</div>
              <div className="text-[12.5px] text-[#9A9A9A]">
                Paste any <code className="text-[#C4C4C4]">notion.so</code> URL zero-config, or add
                an optional Notion integration token to search and attach pages inline without
                mirroring subtasks.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Pill tone={notionConfigured ? 'energy-up' : 'neutral'} dot={notionConfigured}>
              {notionConfigured
                ? notionTokenSource === 'env'
                  ? 'Connected · ENV'
                  : 'Connected'
                : 'URL Paste Only'}
            </Pill>
            <Pill tone="neutral" className="tabular-nums">
              {projectsWithNotion.length} hub{projectsWithNotion.length === 1 ? '' : 's'} linked
            </Pill>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<PlugZap size={12} />}
              onClick={() => testNotionMutation.mutate(notionTokenInput.trim() || undefined)}
              disabled={
                testNotionMutation.isPending || (!notionConfigured && !notionTokenInput.trim())
              }
            >
              Test Connection
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="notion-token-input" className="text-[11.5px] text-[#9A9A9A] block">
            Notion Integration Token (optional)
          </label>
          <input
            id="notion-token-input"
            type="password"
            autoComplete="off"
            value={notionTokenInput}
            onChange={(e) => setNotionTokenInput(e.target.value)}
            placeholder={
              notionTokenSource === 'settings'
                ? '•••••••••••••••• (saved — enter new token to replace)'
                : notionTokenSource === 'env'
                  ? 'Configured via VEYRA_NOTION_TOKEN (enter token to override)'
                  : 'ntn_… or secret_…'
            }
            className="w-full h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[13px] font-mono text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
          />
          <p className="text-[11.5px] text-[#6E6E6E]">
            Stored on the Veyra server and never returned to the browser. You can also configure{' '}
            <code className="text-[#9A9A9A]">VEYRA_NOTION_TOKEN</code> in the server environment.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#2A2A2A] flex-wrap">
          <div className="text-[12px]">
            {notionNotice ? (
              <span className={notionNotice.ok ? 'text-[#7BE0A0]' : 'text-[#FF9EC5]'}>
                {notionNotice.text}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {notionTokenSource === 'settings' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearNotionToken}
                disabled={updateSettingsMutation.isPending}
              >
                Remove Token
              </Button>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!notionTokenInput.trim() || updateSettingsMutation.isPending}
            >
              Save Token
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Server & CLI Section
// ---------------------------------------------------------------------------

function ServerCliSettingsSection() {
  const queryClient = useQueryClient();
  const settingsQuery = useSettingsQuery();
  const settings = settingsQuery.data?.settings;
  const inElectron = isElectronDesktop();

  const [connMode, setConnMode] = useState<'local' | 'remote'>('local');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteToken, setRemoteToken] = useState('');
  const [shortcut, setShortcut] = useState('CommandOrControl+Shift+P');
  const [runInMenuBar, setRunInMenuBar] = useState(true);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
    setShortcut(settings.globalCaptureShortcut);
    setRunInMenuBar(settings.runInMenuBar);
    if (!inElectron && settings.serverUrl) {
      setConnMode('remote');
      setRemoteUrl(settings.serverUrl);
    }
  }, [settings?.updatedAt, inElectron]);

  useEffect(() => {
    if (!inElectron || !window.veyraDesktop?.getClientConfig) return;
    void window.veyraDesktop.getClientConfig().then((cfg) => {
      setConnMode(cfg.mode);
      setRemoteUrl(cfg.remoteUrl ?? '');
      setRemoteToken(cfg.remoteToken ?? '');
    });
  }, [inElectron]);

  const saveConnectionMutation = useMutation({
    mutationFn: async () => {
      if (inElectron && window.veyraDesktop?.saveClientConfig) {
        await window.veyraDesktop.saveClientConfig({
          mode: connMode,
          remoteUrl: connMode === 'remote' ? remoteUrl.trim() : undefined,
          remoteToken: connMode === 'remote' ? remoteToken.trim() : undefined,
        });
        await refreshClientConfig();
        await invalidateAllVeyraData(queryClient);
      } else {
        await apiClient.updateSettings({
          serverUrl: connMode === 'remote' ? remoteUrl.trim() || null : null,
        });
        void queryClient.invalidateQueries({ queryKey: ['settings'] });
      }
    },
    onSuccess: () => {
      setStatusMessage('Connection settings updated');
      window.setTimeout(() => setStatusMessage(null), 1800);
    },
  });

  const saveDesktopPrefsMutation = useMutation({
    mutationFn: async () => {
      const trimmedShortcut = shortcut.trim() || 'CommandOrControl+Shift+P';
      await apiClient.updateSettings({
        globalCaptureShortcut: trimmedShortcut,
        runInMenuBar,
      });
      if (window.veyraDesktop?.syncDesktopPreferences) {
        await window.veyraDesktop.syncDesktopPreferences({
          globalCaptureShortcut: trimmedShortcut,
          runInMenuBar,
        });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      setStatusMessage('Desktop preferences saved');
      window.setTimeout(() => setStatusMessage(null), 1800);
    },
  });

  const cliSnippet =
    connMode === 'remote' && remoteUrl.trim()
      ? `veyra config set --url ${remoteUrl.trim()} --token <YOUR_TOKEN>\nveyra today --json`
      : `veyra today --json\nveyra add "Draft Q4 architecture doc" --date ${getTodayDateString()} --json`;

  const handleCopyCli = async () => {
    try {
      await navigator.clipboard.writeText(cliSnippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable in headless test environments
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="font-display text-[24px] font-semibold text-[#EDEDED]">
            Server &amp; CLI
          </h1>
          <p className="text-[13px] text-[#9A9A9A]">
            Run zero-config local SQLite or point Veyra Desktop &amp; CLI at your own Docker / VPS
            server.
          </p>
        </div>
        {statusMessage ? (
          <Pill tone="energy-up" icon={<Check size={10} />}>
            {statusMessage}
          </Pill>
        ) : null}
      </header>

      {/* Connection Mode Card */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveConnectionMutation.mutate();
        }}
        className="veyra-card space-y-4"
      >
        <div className="flex items-center gap-2 text-[14px] font-semibold text-[#EDEDED]">
          <Server size={15} className="text-[#AEB8FF]" />
          <span>Server Connection</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => setConnMode('local')}
            className={[
              'p-3 rounded-[8px] border text-left transition-colors space-y-0.5',
              connMode === 'local'
                ? 'bg-[#1F2759] border-[#5566F2] text-[#EDEDED]'
                : 'bg-[#262626] border-[#3C3C3C] text-[#C4C4C4] hover:border-[#4E4E4E]',
            ].join(' ')}
          >
            <div className="text-[13px] font-medium">Local SQLite (Zero-Config)</div>
            <div className="text-[11.5px] text-[#9A9A9A]">
              Bundled server on 127.0.0.1:4173 — offline-first
            </div>
          </button>

          <button
            type="button"
            onClick={() => setConnMode('remote')}
            className={[
              'p-3 rounded-[8px] border text-left transition-colors space-y-0.5',
              connMode === 'remote'
                ? 'bg-[#1F2759] border-[#5566F2] text-[#EDEDED]'
                : 'bg-[#262626] border-[#3C3C3C] text-[#C4C4C4] hover:border-[#4E4E4E]',
            ].join(' ')}
          >
            <div className="text-[13px] font-medium">Self-Hosted Docker / VPS</div>
            <div className="text-[11.5px] text-[#9A9A9A]">
              Sync across devices over HTTPS + Bearer token
            </div>
          </button>
        </div>

        {connMode === 'remote' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <label className="space-y-1">
              <span className="text-[11.5px] text-[#9A9A9A] block">Server URL</span>
              <input
                type="text"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://veyra.yourdomain.com"
                className="w-full h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11.5px] text-[#9A9A9A] block">Bearer Token</span>
              <input
                type="password"
                value={remoteToken}
                onChange={(e) => setRemoteToken(e.target.value)}
                placeholder="veyra_sk_…"
                className="w-full h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
              />
            </label>
          </div>
        ) : null}

        <div className="flex justify-end pt-2 border-t border-[#2A2A2A]">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={saveConnectionMutation.isPending}
          >
            Save Connection
          </Button>
        </div>
      </form>

      {/* CLI Setup Snippet */}
      <div className="veyra-card space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[14px] font-semibold text-[#EDEDED]">
            <Terminal size={15} className="text-[#AEB8FF]" />
            <span>veyra CLI &amp; Agent Skill</span>
          </div>
          <Button
            variant="secondary"
            size="xs"
            leftIcon={copied ? <Check size={11} /> : <Copy size={11} />}
            onClick={() => void handleCopyCli()}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <pre className="px-3 py-2.5 rounded-[8px] bg-[#171717] border border-[#2A2A2A] text-[12px] font-mono text-[#C4C4C4] overflow-x-auto leading-relaxed">
          {cliSnippet}
        </pre>
      </div>

      {/* macOS Global Shortcut & Menu Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveDesktopPrefsMutation.mutate();
        }}
        className="veyra-card space-y-4"
      >
        <div className="text-[14px] font-semibold text-[#EDEDED]">macOS Desktop Preferences</div>

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="space-y-0.5">
            <div className="text-[13px] font-medium text-[#EDEDED]">Global Capture Shortcut</div>
            <div className="text-[12px] text-[#9A9A9A]">
              Opens floating Quick Capture from any macOS space (default ⌘⇧P)
            </div>
          </div>
          <input
            type="text"
            aria-label="Global capture shortcut"
            value={shortcut}
            onChange={(e) => setShortcut(e.target.value)}
            className="w-56 h-8 px-2.5 rounded-[6px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[12px] font-mono text-[#EDEDED] focus:outline-none"
          />
        </div>

        <div className="pt-3 border-t border-[#2A2A2A] flex items-center justify-between gap-4 flex-wrap">
          <ToggleSwitch
            id="run-in-menubar-toggle"
            checked={runInMenuBar}
            onChange={setRunInMenuBar}
            label="Run in macOS menu bar"
            description="Show live focus timer in the menu bar and keep quick capture ready"
          />

          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={saveDesktopPrefsMutation.isPending}
          >
            Save Preferences
          </Button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Appearance Section
// ---------------------------------------------------------------------------

function AppearanceSettingsSection() {
  const queryClient = useQueryClient();
  const settingsQuery = useSettingsQuery();
  const settings = settingsQuery.data?.settings;
  const [timezone, setTimezone] = useState(settings?.timezone ?? 'Europe/Berlin');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings?.timezone) setTimezone(settings.timezone);
  }, [settings?.timezone]);

  const tzMutation = useMutation({
    mutationFn: () => apiClient.updateSettings({ timezone: timezone.trim() || 'UTC' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
    },
  });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-[24px] font-semibold text-[#EDEDED]">Appearance</h1>
        <p className="text-[13px] text-[#9A9A9A]">
          Neutral dark surfaces tuned for low-glare focus sessions.
        </p>
      </header>

      <div className="veyra-card space-y-4">
        <div className="text-[14px] font-semibold text-[#EDEDED]">Theme</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="p-3 rounded-[8px] bg-[#1F2759] border border-[#5566F2] space-y-1.5">
            <div className="flex items-center justify-between">
              <Moon size={15} className="text-[#AEB8FF]" />
              <Pill tone="accent">Active</Pill>
            </div>
            <div className="text-[13px] font-medium text-[#EDEDED]">Dark</div>
            <div className="text-[11.5px] text-[#C4C4C4]">Neutral #131313 canvas</div>
          </div>

          <div className="p-3 rounded-[8px] bg-[#262626]/60 border border-[#2A2A2A] opacity-60 space-y-1.5">
            <div className="flex items-center justify-between">
              <Sun size={15} className="text-[#9A9A9A]" />
              <Pill tone="neutral">Post-MVP</Pill>
            </div>
            <div className="text-[13px] font-medium text-[#C4C4C4]">Light</div>
            <div className="text-[11.5px] text-[#6E6E6E]">Ready via semantic CSS tokens</div>
          </div>

          <div className="p-3 rounded-[8px] bg-[#262626]/60 border border-[#2A2A2A] opacity-60 space-y-1.5">
            <div className="flex items-center justify-between">
              <Monitor size={15} className="text-[#9A9A9A]" />
              <Pill tone="neutral">Post-MVP</Pill>
            </div>
            <div className="text-[13px] font-medium text-[#C4C4C4]">System</div>
            <div className="text-[11.5px] text-[#6E6E6E]">Follows macOS appearance</div>
          </div>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          tzMutation.mutate();
        }}
        className="veyra-card flex items-end justify-between gap-3 flex-wrap"
      >
        <label className="space-y-1 flex-1 min-w-[220px]">
          <span className="text-[12px] font-medium text-[#C4C4C4] block">
            Local Timezone (for midnight rollover &amp; daily buckets)
          </span>
          <input
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder="Europe/Berlin"
            className="w-full h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[13px] text-[#EDEDED] focus:outline-none"
          />
        </label>
        <div className="flex items-center gap-2">
          {saved ? (
            <span className="text-[12px] text-[#7BE0A0] inline-flex items-center gap-1">
              <Check size={12} /> Saved
            </span>
          ) : null}
          <Button type="submit" variant="primary" size="md" disabled={tzMutation.isPending}>
            Save Timezone
          </Button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Keyboard Shortcuts & Global Hotkeys Section
// ---------------------------------------------------------------------------

interface HotkeyRow {
  label: string;
  description: string;
  keys: string[];
}

const GLOBAL_MACOS_HOTKEYS: HotkeyRow[] = [
  {
    label: 'Quick Capture (Daily Note / Inbox)',
    description: 'Opens the floating capture bar from any macOS app, even when Veyra is closed',
    keys: ['⌘⇧P'],
  },
  {
    label: 'Quick Focus (Create & Start Focus)',
    description: 'Opens floating capture directly on Focus Now — type a title and hit Enter to focus',
    keys: ['⌘⇧O', '⌃O'],
  },
  {
    label: 'Global Command Palette',
    description: 'Search blocks, projects, and actions from anywhere on macOS',
    keys: ['⌥K'],
  },
];

const NAVIGATION_HOTKEYS: HotkeyRow[] = [
  { label: 'Command Palette (in-app)', description: 'Jump to views, projects, or start a block', keys: ['⌘K'] },
  { label: 'New Block Composer', description: 'Open full composer sheet (⌘↵ create · ⌘⇧↵ create & focus)', keys: ['⌘N'] },
  { label: 'Switch Primary Views', description: 'Today, Plan, Calendar, Projects, Review', keys: ['⌘1', '…', '⌘5'] },
  { label: 'Save Active Drawer', description: 'Flush notes and edits in Block, Meeting, or Session drawer', keys: ['⌘S'] },
  { label: 'Open Settings', description: 'Jump directly to Full-Page Settings', keys: ['⌘,'] },
  { label: 'Close Overlay or Drawer', description: 'Dismiss active modal, palette, or right-side drawer', keys: ['Esc'] },
];

const CAPTURE_AND_FOCUS_HOTKEYS: HotkeyRow[] = [
  { label: 'Switch Quick Capture Tabs', description: 'Cycle Daily Note → Inbox → Focus Now without leaving the input', keys: ['Tab', '⇧Tab'] },
  { label: 'Cycle Project (Quick Capture)', description: 'Switch project directly via keyboard', keys: ['⌃P'] },
  { label: 'Toggle Ops Flag (Quick Capture)', description: 'Mark note or block as Ops without touching the mouse', keys: ['⌥O'] },
  { label: 'Create & Focus (from Inbox / Modal)', description: 'Immediately create block and enter Focus mode', keys: ['⌘↵', '⌘⇧↵'] },
  { label: 'Focus Mode Actions', description: 'Pause with resume note, Complete block, or toggle Notes drawer', keys: ['P', 'C', 'N'] },
];

function HotkeyListCard({
  heading,
  subtitle,
  rows,
}: {
  heading: string;
  subtitle: string;
  rows: HotkeyRow[];
}) {
  return (
    <section className="veyra-card space-y-3">
      <div className="space-y-0.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#9A9A9A]">
          {heading}
        </h2>
        <p className="text-[12px] text-[#6E6E6E]">{subtitle}</p>
      </div>

      <div className="divide-y divide-[#2A2A2A] border-t border-[#2A2A2A]">
        {rows.map((row) => (
          <div
            key={row.label}
            className="py-3 flex items-center justify-between gap-4"
          >
            <div className="min-w-0">
              <div className="text-[13.5px] font-medium text-[#EDEDED]">{row.label}</div>
              <div className="text-[12px] text-[#9A9A9A] mt-0.5">{row.description}</div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {row.keys.map((k) =>
                k === '…' ? (
                  <span key={k} className="text-[11px] text-[#6E6E6E] px-0.5">
                    –
                  </span>
                ) : (
                  <kbd
                    key={k}
                    className="h-7 min-w-[28px] px-2 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[12px] font-medium text-[#EDEDED] inline-flex items-center justify-center tabular-nums"
                  >
                    {k}
                  </kbd>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ShortcutsSettingsSection() {
  const queryClient = useQueryClient();
  const settingsQuery = useSettingsQuery();
  const current = settingsQuery.data?.settings;

  const [captureShortcut, setCaptureShortcut] = useState('CommandOrControl+Shift+P');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (current?.globalCaptureShortcut) {
      setCaptureShortcut(current.globalCaptureShortcut);
    }
  }, [current?.globalCaptureShortcut]);

  const saveShortcutMutation = useMutation({
    mutationFn: async () => {
      const next = captureShortcut.trim() || 'CommandOrControl+Shift+P';
      await apiClient.updateSettings({ globalCaptureShortcut: next });
      if (isElectronDesktop() && window.veyraDesktop?.syncDesktopPreferences) {
        await window.veyraDesktop.syncDesktopPreferences({
          globalCaptureShortcut: next,
          runInMenuBar: current?.runInMenuBar ?? true,
        });
      }
    },
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      window.setTimeout(() => setSaved(false), 1800);
    },
  });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-[22px] font-semibold text-[#EDEDED]">
          Keyboard Shortcuts
        </h1>
        <p className="text-[13px] text-[#9A9A9A]">
          Drive Veyra without touching the mouse — global macOS hotkeys work from any app.
        </p>
      </header>

      <HotkeyListCard
        heading="Global macOS Hotkeys"
        subtitle="Active system-wide while Veyra runs in the menu bar."
        rows={GLOBAL_MACOS_HOTKEYS}
      />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          saveShortcutMutation.mutate();
        }}
        className="veyra-card flex items-end justify-between gap-3 flex-wrap"
      >
        <label className="space-y-1 flex-1 min-w-[240px]">
          <span className="text-[12px] font-medium text-[#C4C4C4] block">
            Customize Global Quick Capture Accelerator
          </span>
          <input
            type="text"
            value={captureShortcut}
            onChange={(e) => setCaptureShortcut(e.target.value)}
            placeholder="CommandOrControl+Shift+P"
            className="w-full h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[13px] font-mono text-[#EDEDED] focus:outline-none"
          />
        </label>
        <div className="flex items-center gap-2">
          {saved ? (
            <span className="text-[12px] text-[#7BE0A0] inline-flex items-center gap-1">
              <Check size={12} /> Saved
            </span>
          ) : null}
          <Button type="submit" variant="primary" size="md" disabled={saveShortcutMutation.isPending}>
            Save Shortcut
          </Button>
        </div>
      </form>

      <HotkeyListCard
        heading="Navigation & Overlays"
        subtitle="Available anywhere inside the Veyra window."
        rows={NAVIGATION_HOTKEYS}
      />

      <HotkeyListCard
        heading="Quick Capture & Focus Mode"
        subtitle="Fast keyboard controls while capturing or focusing."
        rows={CAPTURE_AND_FOCUS_HOTKEYS}
      />
    </div>
  );
}
