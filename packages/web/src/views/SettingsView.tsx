import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CalendarSyncMode,
  MacOsFocusPhase,
  UpdateSettingsInput,
  WebhookEventName,
} from '@veyra/core/types';
import {
  Check,
  Compass,
  Copy,
  FileText,
  Globe,
  Monitor,
  Moon,
  PlugZap,
  RefreshCw,
  Send,
  Server,
  Sun,
  Target,
  Terminal,
  Zap,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  apiClient,
  isElectronDesktop,
  refreshClientConfig,
} from '../api/client';
import {
  invalidateAllVeyraData,
  useActivityQuery,
  useProjectsQuery,
  useSettingsQuery,
} from '../api/queries';
import type { SettingsSection } from '../app/AppShellContext';
import {
  findHotkeyConflict,
  globalHotkeyPayload,
  HOTKEY_DEFAULTS,
  HOTKEY_META,
  type HotkeyId,
  normalizeAccelerator,
  useHotkeys,
} from '../app/hotkeys';
import { Button } from '../components/Button';
import { Pill } from '../components/Pill';
import {
  DEFAULT_CAPTURE_SHORTCUT,
  KeyChord,
  parseAcceleratorToKeys,
  ShortcutBinding,
  type ShortcutBindingSpec,
  ShortcutRecorder,
} from '../components/ShortcutKeys';
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
  {
    id: 'review.completed',
    label: 'review.completed',
    description:
      "Fires when a Weekly Review is wrapped so T3 Code syncs next week's rule and snapshot",
  },
];

export function SettingsView({ section }: SettingsViewProps) {
  return (
    <div className="max-w-[760px] mx-auto px-7 py-7 space-y-6">
      {section === 'integrations' ? <IntegrationsSettingsSection /> : null}
      {section === 'server' ? <ServerCliSettingsSection /> : null}
      {section === 'appearance' ? <AppearanceSettingsSection /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Integrations & Outlook Sync Section
// ---------------------------------------------------------------------------

const HOOK_LISTEN_SNIPPET = `veyra hook listen --port 4174 --auto-summary --summarizer-cmd "claude -p"`;

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
  const [notionOauthClientId, setNotionOauthClientId] = useState('');
  const [notionOauthClientSecret, setNotionOauthClientSecret] = useState('');
  const [notionOauthRedirectUri, setNotionOauthRedirectUri] = useState('');
  const [copiedNotionRedirect, setCopiedNotionRedirect] = useState(false);
  const [macosFocusEnabled, setMacosFocusEnabled] = useState(false);
  const [macosFocusStartShortcut, setMacosFocusStartShortcut] = useState('');
  const [macosFocusEndShortcut, setMacosFocusEndShortcut] = useState('');
  const [macosFocusNotice, setMacosFocusNotice] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const macosShortcutsQuery = useQuery({
    queryKey: ['macos-focus-shortcuts'],
    queryFn: () => apiClient.listMacOsFocusShortcuts(),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!settings) return;
    setSyncMode(settings.calendarSyncMode);
    setOutlookCmd(settings.outlookCliCommand ?? '');
    setIcsFeedUrl(settings.icsFeedUrl ?? '');
    setSyncIntervalMin(String(settings.calendarSyncIntervalMin));
    setSkipDeclined(settings.skipDeclinedAndAllDay);
    setWebhookUrl(settings.webhookUrl ?? '');
    setWebhookEvents(settings.webhookEvents);
    setNotionOauthClientId(settings.notionOauthClientId ?? '');
    setNotionOauthRedirectUri(settings.notionOauthRedirectUri ?? '');
    setMacosFocusEnabled(settings.macosFocusEnabled);
    setMacosFocusStartShortcut(settings.macosFocusStartShortcut ?? '');
    setMacosFocusEndShortcut(settings.macosFocusEndShortcut ?? '');
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

  const startNotionOAuthMutation = useMutation({
    mutationFn: () =>
      apiClient.startNotionOAuth({
        clientId: notionOauthClientId.trim() || undefined,
        clientSecret: notionOauthClientSecret.trim() || undefined,
        redirectUri: notionOauthRedirectUri.trim() || undefined,
      }),
    onSuccess: async (res) => {
      setNotionOauthClientSecret('');
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      setNotionNotice({
        ok: true,
        text: 'Browser opened — approve access in Notion and return here.',
      });
      if (window.veyraDesktop?.openExternalUrl) {
        await window.veyraDesktop.openExternalUrl(res.authorizeUrl);
      } else {
        window.open(res.authorizeUrl, '_blank', 'noopener,noreferrer');
      }
    },
    onError: (err) => {
      setNotionNotice({
        ok: false,
        text: err instanceof Error ? err.message : 'Failed to start Notion OAuth flow',
      });
    },
  });

  const defaultNotionRedirectUri =
    typeof window !== 'undefined' &&
    (window.location.protocol === 'http:' || window.location.protocol === 'https:')
      ? `${window.location.origin}/api/integrations/notion/oauth/callback`
      : 'http://127.0.0.1:4173/api/integrations/notion/oauth/callback';

  const effectiveNotionRedirectUri =
    notionOauthRedirectUri.trim() || defaultNotionRedirectUri;

  const handleCopyNotionRedirect = async () => {
    try {
      await navigator.clipboard.writeText(effectiveNotionRedirectUri);
      setCopiedNotionRedirect(true);
      window.setTimeout(() => setCopiedNotionRedirect(false), 1600);
    } catch {
      // Clipboard unavailable in headless test environments
    }
  };

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

  const testMacOsFocusMutation = useMutation({
    mutationFn: (vars: { phase: MacOsFocusPhase; shortcutName?: string }) =>
      apiClient.testMacOsFocus(vars.phase, vars.shortcutName),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
      if (res.result.ok) {
        setMacosFocusNotice({
          ok: true,
          text: `Ran "${res.result.shortcutName}" (${res.result.phase})`,
        });
      } else {
        setMacosFocusNotice({
          ok: false,
          text: res.result.error ?? res.result.reason ?? 'macOS Focus shortcut test failed',
        });
      }
    },
    onError: (err) => {
      setMacosFocusNotice({
        ok: false,
        text: err instanceof Error ? err.message : 'macOS Focus shortcut test failed',
      });
    },
  });

  const handleSaveMacOsFocus = (e: FormEvent) => {
    e.preventDefault();
    setMacosFocusNotice(null);
    updateSettingsMutation.mutate(
      {
        macosFocusEnabled,
        macosFocusStartShortcut: macosFocusStartShortcut.trim() || null,
        macosFocusEndShortcut: macosFocusEndShortcut.trim() || null,
      },
      {
        onSuccess: () => {
          setMacosFocusNotice({
            ok: true,
            text: macosFocusEnabled
              ? 'macOS Focus Mode presence saved'
              : 'macOS Focus Mode presence disabled',
          });
        },
      },
    );
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
              placeholder="http://127.0.0.1:4174/hooks/veyra"
              className="w-full h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
            />
          </div>

          <div className="space-y-2.5 pt-2 border-t border-[#2A2A2A]">
            {WEBHOOK_EVENTS.map((ev) => {
              const switchId = `webhook-event-${ev.id}`;
              return (
                <div key={ev.id} className="flex items-center justify-between gap-3">
                  <label htmlFor={switchId} className="cursor-pointer">
                    <div className="text-[12.5px] font-mono text-[#EDEDED]">{ev.label}</div>
                    <div className="text-[11.5px] text-[#9A9A9A]">{ev.description}</div>
                  </label>
                  <ToggleSwitch
                    id={switchId}
                    checked={webhookEvents.includes(ev.id)}
                    onChange={() => toggleWebhookEvent(ev.id)}
                    size="sm"
                  />
                </div>
              );
            })}
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

        {/* Copyable CLI Hook Listener & Auto-Summary One-Liner */}
        <div className="pt-4 border-t border-[#2A2A2A] space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E] inline-flex items-center gap-1.5">
              <Terminal size={12} className="text-[#AEB8FF]" />
              <span>Post-Block Auto-Summary Runner (CLI)</span>
            </span>
            <Button
              variant="secondary"
              size="xs"
              leftIcon={copiedHookSnippet ? <Check size={11} /> : <Copy size={11} />}
              onClick={() => void handleCopyHookSnippet()}
            >
              {copiedHookSnippet ? 'Copied' : 'Copy command'}
            </Button>
          </div>
          <pre className="px-3 py-2.5 rounded-[8px] bg-[#171717] border border-[#2A2A2A] text-[12px] font-mono text-[#C4C4C4] overflow-x-auto leading-relaxed">
            {HOOK_LISTEN_SNIPPET}
          </pre>
          <p className="text-[11.5px] text-[#9A9A9A] leading-relaxed">
            Point the Webhook Endpoint URL above to{' '}
            <code className="text-[#AEB8FF]">http://127.0.0.1:4174/hooks/veyra</code> (also
            accepts <code className="text-[#C4C4C4]">/webhook</code>). Add optional{' '}
            <code className="text-[#C4C4C4]">--workspace &lt;dir&gt;</code> or{' '}
            <code className="text-[#C4C4C4]">--context-cmd &lt;cmd&gt;</code> flags to include git
            commits or T3 Code / agent transcripts from the focus window; sessions under{' '}
            <code className="text-[#C4C4C4]">--min-minutes 5</code> are skipped and{' '}
            <code className="text-[#C4C4C4]">Ops</code> blocks automatically highlight recurring
            automation candidates.
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
      <div className="veyra-card space-y-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span className="w-8 h-8 rounded-[8px] bg-[#262626] border border-[#3C3C3C] inline-flex items-center justify-center text-[#C4C4C4] shrink-0">
              <FileText size={15} />
            </span>
            <div className="space-y-0.5 min-w-0">
              <div className="text-[14px] font-semibold text-[#EDEDED]">Notion Links</div>
              <div className="text-[12.5px] text-[#9A9A9A]">
                Paste any <code className="text-[#C4C4C4]">notion.so</code> URL zero-config, or
                connect via Notion OAuth (works without workspace admin permissions) or an internal
                API token to search and attach pages inline.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Pill tone={notionConfigured ? 'energy-up' : 'neutral'} dot={notionConfigured}>
              {notionConfigured
                ? settings?.notionWorkspaceName
                  ? `Connected · ${settings.notionWorkspaceName}`
                  : notionTokenSource === 'env'
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

        {/* Notion OAuth 2.0 Connection (works without admin internal-token permissions) */}
        <div className="pt-4 border-t border-[#2A2A2A] space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
              Connect with Notion OAuth (User-Scoped)
            </span>
            <Button
              type="button"
              variant="secondary"
              size="xs"
              leftIcon={copiedNotionRedirect ? <Check size={11} /> : <Copy size={11} />}
              onClick={() => void handleCopyNotionRedirect()}
            >
              {copiedNotionRedirect ? 'Copied Redirect URI' : 'Copy Redirect URI'}
            </Button>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="notion-oauth-redirect-input" className="text-[11.5px] text-[#9A9A9A] block">
              Redirect URI (register this exact URL in your Notion OAuth connection)
            </label>
            <input
              id="notion-oauth-redirect-input"
              type="text"
              value={notionOauthRedirectUri}
              onChange={(e) => setNotionOauthRedirectUri(e.target.value)}
              placeholder={defaultNotionRedirectUri}
              className="w-full h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[12.5px] font-mono text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="notion-oauth-client-id" className="text-[11.5px] text-[#9A9A9A] block">
                OAuth Client ID
              </label>
              <input
                id="notion-oauth-client-id"
                type="text"
                autoComplete="off"
                value={notionOauthClientId}
                onChange={(e) => setNotionOauthClientId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[12.5px] font-mono text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="notion-oauth-client-secret"
                className="text-[11.5px] text-[#9A9A9A] block"
              >
                OAuth Client Secret
              </label>
              <input
                id="notion-oauth-client-secret"
                type="password"
                autoComplete="off"
                value={notionOauthClientSecret}
                onChange={(e) => setNotionOauthClientSecret(e.target.value)}
                placeholder={
                  settings?.notionOauthConfigured
                    ? '•••••••••••••••• (saved — enter new secret to replace)'
                    : 'secret_…'
                }
                className="w-full h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[12.5px] font-mono text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11.5px] text-[#6E6E6E]">
              Opens Notion in your browser so you can pick which pages Veyra may search.
            </span>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => startNotionOAuthMutation.mutate()}
              disabled={
                startNotionOAuthMutation.isPending ||
                (!settings?.notionOauthConfigured &&
                  (!notionOauthClientId.trim() || !notionOauthClientSecret.trim()))
              }
            >
              {notionConfigured ? 'Reconnect Notion' : 'Connect with Notion'}
            </Button>
          </div>
        </div>

        {/* Manual Internal Integration Token (alternative) */}
        <form
          onSubmit={handleSaveNotionToken}
          className="pt-4 border-t border-[#2A2A2A] space-y-3"
        >
          <div className="space-y-1.5">
            <label htmlFor="notion-token-input" className="text-[11.5px] text-[#9A9A9A] block">
              Or paste a static Notion Integration Token (optional)
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
                variant="secondary"
                size="sm"
                disabled={!notionTokenInput.trim() || updateSettingsMutation.isPending}
              >
                Save Token
              </Button>
            </div>
          </div>
        </form>
      </div>

      {/* macOS Focus Mode Presence Card */}
      <form onSubmit={handleSaveMacOsFocus} className="veyra-card space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span className="w-8 h-8 rounded-[8px] bg-[#262626] border border-[#3C3C3C] inline-flex items-center justify-center text-[#C4C4C4] shrink-0">
              <Moon size={15} />
            </span>
            <div className="space-y-0.5 min-w-0">
              <div className="text-[14px] font-semibold text-[#EDEDED]">macOS Focus Mode</div>
              <div className="text-[12.5px] text-[#9A9A9A]">
                Automatically toggle macOS Do Not Disturb or Work Focus via Apple Shortcuts when a
                focus session starts or ends.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Pill tone={macosFocusEnabled ? 'energy-up' : 'neutral'} dot={macosFocusEnabled}>
              {macosFocusEnabled ? 'Active' : 'Off'}
            </Pill>
            <ToggleSwitch
              id="macos-focus-enabled-toggle"
              checked={macosFocusEnabled}
              onChange={setMacosFocusEnabled}
              size="sm"
            />
          </div>
        </div>

        <datalist id="macos-shortcuts-datalist">
          {(macosShortcutsQuery.data?.shortcuts ?? []).map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="macos-focus-start-input" className="text-[11.5px] text-[#9A9A9A] block">
              Start Focus Shortcut
            </label>
            <div className="flex items-center gap-2">
              <input
                id="macos-focus-start-input"
                type="text"
                list="macos-shortcuts-datalist"
                value={macosFocusStartShortcut}
                onChange={(e) => setMacosFocusStartShortcut(e.target.value)}
                placeholder="Veyra Focus On"
                className="flex-1 min-w-0 h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  testMacOsFocusMutation.mutate({
                    phase: 'start',
                    shortcutName: macosFocusStartShortcut.trim() || undefined,
                  })
                }
                disabled={testMacOsFocusMutation.isPending || !macosFocusStartShortcut.trim()}
              >
                Test
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="macos-focus-end-input" className="text-[11.5px] text-[#9A9A9A] block">
              End Focus Shortcut
            </label>
            <div className="flex items-center gap-2">
              <input
                id="macos-focus-end-input"
                type="text"
                list="macos-shortcuts-datalist"
                value={macosFocusEndShortcut}
                onChange={(e) => setMacosFocusEndShortcut(e.target.value)}
                placeholder="Veyra Focus Off"
                className="flex-1 min-w-0 h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] focus:border-[#5566F2] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  testMacOsFocusMutation.mutate({
                    phase: 'end',
                    shortcutName: macosFocusEndShortcut.trim() || undefined,
                  })
                }
                disabled={testMacOsFocusMutation.isPending || !macosFocusEndShortcut.trim()}
              >
                Test
              </Button>
            </div>
          </div>
        </div>

        <p className="text-[11.5px] text-[#6E6E6E] leading-relaxed">
          Create two 1-action shortcuts in Apple <span className="text-[#9A9A9A]">Shortcuts.app</span>
          : <code className="text-[#9A9A9A]">Set Focus → Turn Do Not Disturb On</code> and{' '}
          <code className="text-[#9A9A9A]">Set Focus → Turn Focus Off</code>. Switching directly
          between focus blocks keeps macOS Focus active without flickering.
        </p>

        <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#2A2A2A] flex-wrap">
          <div className="text-[12px]">
            {macosFocusNotice ? (
              <span className={macosFocusNotice.ok ? 'text-[#7BE0A0]' : 'text-[#FF9EC5]'}>
                {macosFocusNotice.text}
              </span>
            ) : null}
          </div>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={updateSettingsMutation.isPending}
          >
            Save Focus Presence
          </Button>
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
  const [runInMenuBar, setRunInMenuBar] = useState(true);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!settings) return;
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
      await apiClient.updateSettings({ runInMenuBar });
      if (window.veyraDesktop?.syncDesktopPreferences) {
        await window.veyraDesktop.syncDesktopPreferences({
          globalCaptureShortcut: settings?.globalCaptureShortcut ?? DEFAULT_CAPTURE_SHORTCUT,
          runInMenuBar,
          globalHotkeys: globalHotkeyPayload(settings?.hotkeys),
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
            Server, CLI &amp; Shortcuts
          </h1>
          <p className="text-[13px] text-[#9A9A9A]">
            Run zero-config local SQLite or point Veyra Desktop &amp; CLI at your own Docker / VPS
            server, and customize keyboard hotkeys.
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

      {/* Folded Keyboard Shortcuts & Global Hotkeys */}
      <ShortcutsSettingsSection />
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
  binding?: ShortcutBindingSpec;
  control?: ReactNode;
}

/** Shortcuts that stay fixed because they are part of a gesture, not a single action. */
const FIXED_NAVIGATION_HOTKEYS: Record<string, HotkeyRow> = {
  views: {
    label: 'Switch Primary Views',
    description: 'Today, Plan, Calendar, Projects, Goals, Review',
    binding: { chords: [['⌘', '1'], ['⌘', '6']], separator: 'to' },
  },
  close: {
    label: 'Close Overlay or Drawer',
    description: 'Dismiss active modal, palette, or side drawer',
    binding: { chords: [['Esc']] },
  },
};

const FIXED_CAPTURE_HOTKEYS: Record<string, HotkeyRow> = {
  tabs: {
    label: 'Switch Capture Tabs',
    description: 'Cycle Note, Inbox, and Focus Now without leaving the input',
    binding: { chords: [['Tab'], ['⇧', 'Tab']], separator: 'or' },
  },
  createAndFocus: {
    label: 'Create & Focus',
    description: 'Immediately create a block and enter Focus mode from Inbox or Composer',
    binding: { chords: [['⌘', '↵'], ['⌘', '⇧', '↵']], separator: 'or' },
  },
};

function HotkeyListCard({
  heading,
  subtitle,
  icon,
  badge,
  rows,
}: {
  heading: string;
  subtitle: string;
  icon: ReactNode;
  badge?: ReactNode;
  rows: HotkeyRow[];
}) {
  return (
    <section className="veyra-card p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 pb-1">
        <div className="flex items-start gap-3 min-w-0">
          <span className="w-8 h-8 rounded-[8px] bg-[#242424] border border-[#323232] inline-flex items-center justify-center text-[#AEB8FF] shrink-0 mt-0.5">
            {icon}
          </span>
          <div className="space-y-1 min-w-0">
            <h2 className="text-[14px] font-semibold text-[#EDEDED] leading-snug">{heading}</h2>
            <p className="text-[12.5px] text-[#7D7D7D]">{subtitle}</p>
          </div>
        </div>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </div>

      <div className="divide-y divide-[#262626] border-t border-[#2A2A2A]">
        {rows.map((row) => (
          <div key={row.label} className="py-1 first:pt-2 last:pb-0">
            <div className="py-2 -mx-2.5 px-2.5 rounded-[8px] flex items-center justify-between gap-6 hover:bg-white/[0.025] transition-colors">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-[#EDEDED]">{row.label}</div>
                <div className="text-[12px] text-[#8E8E8E] mt-0.5">{row.description}</div>
              </div>
              {row.control ? (
                row.control
              ) : row.binding ? (
                <ShortcutBinding {...row.binding} />
              ) : null}
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
  const resolved = useHotkeys();

  const [savedId, setSavedId] = useState<HotkeyId | 'all' | null>(null);
  const [errors, setErrors] = useState<Partial<Record<HotkeyId, string>>>({});
  const savedTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
    };
  }, []);

  const saveHotkeysMutation = useMutation({
    mutationFn: async (vars: {
      id: HotkeyId | 'all';
      globalCaptureShortcut: string;
      hotkeys: Record<string, string>;
    }) => {
      // The desktop shell registers the global ones first. If macOS or another app already
      // owns the keys, this throws and nothing is saved, so the old binding stays active.
      if (isElectronDesktop() && window.veyraDesktop?.syncDesktopPreferences) {
        const result = await window.veyraDesktop.syncDesktopPreferences({
          globalCaptureShortcut: vars.globalCaptureShortcut,
          runInMenuBar: current?.runInMenuBar ?? true,
          globalHotkeys: globalHotkeyPayload(vars.hotkeys),
        });
        if (result && result.failed.length > 0) {
          throw new Error('macOS or another app already uses these keys');
        }
      }
      await apiClient.updateSettings({
        globalCaptureShortcut: vars.globalCaptureShortcut,
        hotkeys: vars.hotkeys,
      });
      return vars.id;
    },
    onSuccess: (id) => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      setSavedId(id);
      if (savedTimerRef.current !== null) {
        window.clearTimeout(savedTimerRef.current);
      }
      savedTimerRef.current = window.setTimeout(() => setSavedId(null), 1800);
    },
    onError: (err, vars) => {
      if (vars.id === 'all') return;
      setErrors((prev) => ({
        ...prev,
        [vars.id]: err instanceof Error ? err.message : 'Could not save shortcut',
      }));
    },
  });

  const setHotkey = (id: HotkeyId, accelerator: string) => {
    const defaults = HOTKEY_DEFAULTS[id];
    const matchesDefault = normalizeAccelerator(accelerator) === normalizeAccelerator(defaults[0]);

    if (!matchesDefault || defaults.length === 1) {
      const conflict = findHotkeyConflict(id, accelerator, resolved);
      if (conflict) {
        setErrors((prev) => ({
          ...prev,
          [id]: `Already used by ${conflict.label}`,
        }));
        return;
      }
    }
    setErrors((prev) => ({ ...prev, [id]: undefined }));

    const hotkeys = { ...(current?.hotkeys ?? {}) };
    let globalCaptureShortcut = current?.globalCaptureShortcut ?? DEFAULT_CAPTURE_SHORTCUT;
    if (id === 'quickCapture') {
      globalCaptureShortcut = accelerator;
    } else if (matchesDefault) {
      delete hotkeys[id];
    } else {
      hotkeys[id] = accelerator;
    }
    saveHotkeysMutation.mutate({ id, globalCaptureShortcut, hotkeys });
  };

  const resetAll = () => {
    setErrors({});
    saveHotkeysMutation.mutate({
      id: 'all',
      globalCaptureShortcut: DEFAULT_CAPTURE_SHORTCUT,
      hotkeys: {},
    });
  };

  const hasCustom =
    Object.keys(current?.hotkeys ?? {}).length > 0 ||
    (current?.globalCaptureShortcut ?? DEFAULT_CAPTURE_SHORTCUT) !== DEFAULT_CAPTURE_SHORTCUT;

  const rebindRow = (id: HotkeyId): HotkeyRow => {
    const meta = HOTKEY_META[id];
    const defaults = HOTKEY_DEFAULTS[id];
    const accelerators = resolved[id];
    const isDefault = accelerators.length > 1 || normalizeAccelerator(accelerators[0]) === normalizeAccelerator(defaults[0]);
    const extraDefaults = isDefault ? defaults.slice(1) : [];
    return {
      label: meta.label,
      description: meta.description,
      control: (
        <div className="inline-flex items-center gap-2 shrink-0">
          <ShortcutRecorder
            value={accelerators[0]}
            defaultValue={defaults[0]}
            onChange={(next) => setHotkey(id, next)}
            disabled={saveHotkeysMutation.isPending}
            saved={savedId === id}
            error={errors[id] ?? null}
            allowBare={meta.scope === 'focus'}
            ariaLabel={`Customize ${meta.label} shortcut`}
          />
          {extraDefaults.map((accelerator) => (
            <span key={accelerator} className="inline-flex items-center gap-1.5 self-start mt-1.5">
              <span className="text-[11px] text-[#6E6E6E] select-none">or</span>
              <KeyChord keys={parseAcceleratorToKeys(accelerator)} />
            </span>
          ))}
        </div>
      ),
    };
  };

  return (
    <div className="space-y-6 pt-2 border-t border-[#2A2A2A] pb-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h2 className="font-display text-[18px] font-semibold text-[#EDEDED]">
            Keyboard Shortcuts
          </h2>
          <p className="text-[13px] text-[#9A9A9A]">
            Drive Veyra without touching the mouse. Click any shortcut with a pencil to record a
            new one, or press Esc while recording to cancel.
          </p>
        </div>
        <div className="inline-flex items-center gap-2">
          {savedId === 'all' ? (
            <span className="text-[11.5px] text-[#7BE0A0] inline-flex items-center gap-1">
              <Check size={12} /> Reset
            </span>
          ) : null}
          <Button
            variant="secondary"
            size="xs"
            disabled={!hasCustom || saveHotkeysMutation.isPending}
            onClick={resetAll}
          >
            Reset all to defaults
          </Button>
        </div>
      </div>

      <HotkeyListCard
        heading="Global macOS Hotkeys"
        subtitle="Active system-wide while Veyra runs in the menu bar. Click a shortcut to rebind it."
        icon={<Globe size={14} />}
        badge={
          <Pill tone="accent" dot>
            System-wide
          </Pill>
        }
        rows={[
          rebindRow('quickCapture'),
          rebindRow('quickFocus'),
          rebindRow('globalCommandPalette'),
        ]}
      />

      <HotkeyListCard
        heading="Navigation & Overlays"
        subtitle="Available anywhere inside the Veyra window."
        icon={<Compass size={14} />}
        rows={[
          rebindRow('commandPalette'),
          rebindRow('newBlock'),
          FIXED_NAVIGATION_HOTKEYS.views,
          rebindRow('saveDrawer'),
          rebindRow('openSettings'),
          FIXED_NAVIGATION_HOTKEYS.close,
        ]}
      />

      <HotkeyListCard
        heading="Quick Capture"
        subtitle="Keyboard controls inside the floating capture bar and composer."
        icon={<Zap size={14} />}
        rows={[
          FIXED_CAPTURE_HOTKEYS.tabs,
          rebindRow('cycleProject'),
          rebindRow('toggleOps'),
          FIXED_CAPTURE_HOTKEYS.createAndFocus,
        ]}
      />

      <HotkeyListCard
        heading="Focus Mode"
        subtitle="Single-key controls while a focus session is running. ⌘↵ always completes the block."
        icon={<Target size={14} />}
        rows={[rebindRow('pauseFocus'), rebindRow('completeBlock'), rebindRow('toggleNotes')]}
      />
    </div>
  );
}
