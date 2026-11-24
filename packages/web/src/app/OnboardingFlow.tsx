import { useQueryClient } from '@tanstack/react-query';
import {
  PROJECT_ACCENT_COLORS,
  PROJECT_ICON_KEYS,
  type ProjectIconKey,
} from '@veyra/core/types';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  FolderKanban,
  Pin,
  Plus,
  Server,
  Target,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { apiClient, isElectronDesktop, refreshClientConfig } from '../api/client';
import { invalidateAllVeyraData } from '../api/queries';
import { Button } from '../components/Button';
import { ModalSheet } from '../components/ModalSheet';
import { ProjectBadge } from '../components/ProjectBadge';
import { ProjectIcon } from '../components/icons';

export interface OnboardingFlowProps {
  open: boolean;
  onComplete: () => void;
}

interface DraftGoal {
  tempId: string;
  name: string;
  description: string;
  color: string;
}

interface DraftProject {
  tempId: string;
  name: string;
  color: string;
  icon: ProjectIconKey | null;
  goalTempId: string;
  isPinned: boolean;
}

const DEFAULT_GOALS: DraftGoal[] = [
  {
    tempId: 'g-1',
    name: 'Ship core product milestones',
    description: 'Focus weekly build hours on high-leverage product work',
    color: '#3B4BD8',
  },
  {
    tempId: 'g-2',
    name: 'Grow customer adoption',
    description: 'Unblock key rollouts, demos, and customer feedback loops',
    color: '#2E9E6F',
  },
];

const DEFAULT_PROJECTS: DraftProject[] = [
  {
    tempId: 'p-1',
    name: 'Core App',
    color: '#3B4BD8',
    icon: 'Rocket',
    goalTempId: 'g-1',
    isPinned: true,
  },
  {
    tempId: 'p-2',
    name: 'Customer Rollouts',
    color: '#2E9E6F',
    icon: 'Briefcase',
    goalTempId: 'g-2',
    isPinned: true,
  },
];

export function OnboardingFlow({ open, onComplete }: OnboardingFlowProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [goals, setGoals] = useState<DraftGoal[]>(DEFAULT_GOALS);
  const [projects, setProjects] = useState<DraftProject[]>(DEFAULT_PROJECTS);
  const [serverMode, setServerMode] = useState<'local' | 'remote'>('local');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteToken, setRemoteToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [copiedCli, setCopiedCli] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addGoal = () => {
    const color = PROJECT_ACCENT_COLORS[goals.length % PROJECT_ACCENT_COLORS.length];
    setGoals((prev) => [
      ...prev,
      { tempId: `g-${Date.now()}`, name: '', description: '', color },
    ]);
  };

  const addProject = () => {
    const color = PROJECT_ACCENT_COLORS[projects.length % PROJECT_ACCENT_COLORS.length];
    const icon = PROJECT_ICON_KEYS[projects.length % PROJECT_ICON_KEYS.length];
    setProjects((prev) => [
      ...prev,
      {
        tempId: `p-${Date.now()}`,
        name: '',
        color,
        icon,
        goalTempId: goals[0]?.tempId ?? '',
        isPinned: true,
      },
    ]);
  };

  const cliSnippet =
    serverMode === 'remote' && remoteUrl.trim()
      ? `veyra config set --url ${remoteUrl.trim()}${remoteToken.trim() ? ` --token ${remoteToken.trim()}` : ''}\nveyra today --json`
      : `veyra config set --url http://127.0.0.1:4173\nveyra today --json`;

  const handleCopyCli = () => {
    void navigator.clipboard?.writeText(cliSnippet);
    setCopiedCli(true);
    window.setTimeout(() => setCopiedCli(false), 1600);
  };

  const handleSkip = async () => {
    setSaving(true);
    setError(null);
    try {
      await apiClient.updateSettings({ onboardingCompleted: true });
      await invalidateAllVeyraData(queryClient);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete onboarding');
    } finally {
      setSaving(false);
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    setError(null);
    try {
      if (serverMode === 'remote' && remoteUrl.trim()) {
        if (isElectronDesktop() && window.veyraDesktop?.saveClientConfig) {
          await window.veyraDesktop.saveClientConfig({
            mode: 'remote',
            remoteUrl: remoteUrl.trim(),
            remoteToken: remoteToken.trim() || undefined,
          });
          await refreshClientConfig();
        }
      }

      const goalIdByTemp = new Map<string, string>();
      for (const g of goals) {
        const trimmed = g.name.trim();
        if (!trimmed) continue;
        const created = await apiClient.createGoal({
          name: trimmed,
          description: g.description.trim(),
          color: g.color,
        });
        goalIdByTemp.set(g.tempId, created.goal.id);
      }

      for (const p of projects) {
        const trimmed = p.name.trim();
        if (!trimmed) continue;
        await apiClient.createProject({
          name: trimmed,
          color: p.color,
          icon: p.icon,
          defaultGoalId: p.goalTempId ? (goalIdByTemp.get(p.goalTempId) ?? null) : null,
          isPinned: p.isPinned,
        });
      }

      await apiClient.updateSettings({
        onboardingCompleted: true,
        serverUrl: serverMode === 'remote' && remoteUrl.trim() ? remoteUrl.trim() : null,
      });

      if (serverMode === 'local' && isElectronDesktop() && window.veyraDesktop?.saveClientConfig) {
        await window.veyraDesktop.saveClientConfig({ mode: 'local' });
        await refreshClientConfig();
      }

      await invalidateAllVeyraData(queryClient);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save workspace setup');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalSheet
      open={open}
      dismissible={false}
      width={660}
      ariaLabel="Welcome to Veyra"
      title={
        <div className="flex items-center gap-2.5">
          <span className="w-6 h-6 rounded-[7px] bg-[#3B4BD8] text-white inline-flex items-center justify-center font-display text-[13px] font-semibold">
            V
          </span>
          <span className="font-display text-[17px] font-semibold text-[#EDEDED]">
            Set up your Veyra workspace
          </span>
        </div>
      }
      subtitle={`Step ${step} of 3 — ${
        step === 1
          ? 'Define your active goals'
          : step === 2
            ? 'Create & pin your starting projects'
            : 'Choose local or self-hosted server & CLI'
      }`}
      headerRight={
        <button
          type="button"
          onClick={handleSkip}
          disabled={saving}
          className="text-[12px] text-[#9A9A9A] hover:text-[#EDEDED] transition-colors"
        >
          Skip setup
        </button>
      }
      footer={
        <div className="flex items-center justify-between">
          {/* Step indicators */}
          <div className="flex items-center gap-1.5">
            {([1, 2, 3] as const).map((s) => (
              <span
                key={s}
                className={`h-1.5 rounded-full transition-all ${
                  s === step
                    ? 'w-6 bg-[#3B4BD8]'
                    : s < step
                      ? 'w-3 bg-[#7BE0A0]'
                      : 'w-3 bg-[#2A2A2A]'
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {step > 1 ? (
              <Button
                variant="secondary"
                size="md"
                leftIcon={<ArrowLeft size={14} />}
                onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                disabled={saving}
              >
                Back
              </Button>
            ) : null}

            {step < 3 ? (
              <Button
                variant="primary"
                size="md"
                rightIcon={<ArrowRight size={14} />}
                onClick={() => setStep((s) => (s === 1 ? 2 : 3))}
              >
                Continue
              </Button>
            ) : (
              <Button
                variant="primary"
                size="md"
                leftIcon={<Check size={14} />}
                loading={saving}
                onClick={handleFinish}
              >
                Launch Veyra
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {step === 1 ? (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[13px] text-[#C4C4C4]">
                <Target size={15} className="text-[#4DA3FF]" />
                <span>What 1–3 outcomes matter most this quarter?</span>
              </div>
              <Button variant="secondary" size="xs" leftIcon={<Plus size={12} />} onClick={addGoal}>
                Add goal
              </Button>
            </div>

            <div className="divide-y divide-[#2A2A2A] border-y border-[#2A2A2A]">
              {goals.map((goal, idx) => (
                <div key={goal.tempId} className="py-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={goal.name}
                      onChange={(e) =>
                        setGoals((prev) =>
                          prev.map((g, i) => (i === idx ? { ...g, name: e.target.value } : g)),
                        )
                      }
                      placeholder="Goal name (e.g. Ship v1.0)"
                      className="flex-1 h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] text-[13.5px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none focus:border-[#5566F2]"
                    />
                    {goals.length > 1 ? (
                      <button
                        type="button"
                        aria-label="Remove goal"
                        onClick={() => setGoals((prev) => prev.filter((_, i) => i !== idx))}
                        className="h-9 w-9 rounded-[8px] inline-flex items-center justify-center text-[#6E6E6E] hover:text-[#FF9EC5] hover:bg-[#3D1A2B]/60"
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <input
                      type="text"
                      value={goal.description}
                      onChange={(e) =>
                        setGoals((prev) =>
                          prev.map((g, i) =>
                            i === idx ? { ...g, description: e.target.value } : g,
                          ),
                        )
                      }
                      placeholder="Short description (optional)"
                      className="flex-1 min-w-[220px] h-8 px-2.5 rounded-[6px] bg-[#171717] border border-[#2A2A2A] text-[12px] text-[#C4C4C4] placeholder:text-[#6E6E6E] focus:outline-none focus:border-[#5566F2]"
                    />
                    <div className="flex items-center gap-1.5">
                      {PROJECT_ACCENT_COLORS.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          aria-label={`Goal color ${hex}`}
                          onClick={() =>
                            setGoals((prev) =>
                              prev.map((g, i) => (i === idx ? { ...g, color: hex } : g)),
                            )
                          }
                          style={{ backgroundColor: hex }}
                          className={`w-4 h-4 rounded-full transition-transform ${
                            goal.color === hex
                              ? 'ring-2 ring-white ring-offset-2 ring-offset-[#1C1C1C] scale-110'
                              : 'opacity-70 hover:opacity-100'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[13px] text-[#C4C4C4]">
                <FolderKanban size={15} className="text-[#AEB8FF]" />
                <span>Add your active projects &amp; pin favorites to the sidebar.</span>
              </div>
              <Button
                variant="secondary"
                size="xs"
                leftIcon={<Plus size={12} />}
                onClick={addProject}
              >
                Add project
              </Button>
            </div>

            <div className="divide-y divide-[#2A2A2A] border-y border-[#2A2A2A]">
              {projects.map((proj, idx) => (
                <div key={proj.tempId} className="py-3 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <ProjectBadge
                      name={proj.name || 'PR'}
                      color={proj.color}
                      icon={proj.icon}
                      size="md"
                    />
                    <input
                      type="text"
                      value={proj.name}
                      onChange={(e) =>
                        setProjects((prev) =>
                          prev.map((p, i) => (i === idx ? { ...p, name: e.target.value } : p)),
                        )
                      }
                      placeholder="Project name"
                      className="flex-1 h-8 px-2.5 rounded-[7px] bg-[#262626] border border-[#3C3C3C] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none focus:border-[#5566F2]"
                    />
                    <select
                      aria-label="Default goal"
                      value={proj.goalTempId}
                      onChange={(e) =>
                        setProjects((prev) =>
                          prev.map((p, i) =>
                            i === idx ? { ...p, goalTempId: e.target.value } : p,
                          ),
                        )
                      }
                      className="h-8 px-2 rounded-[7px] bg-[#262626] border border-[#3C3C3C] text-[12px] text-[#C4C4C4] focus:outline-none max-w-[160px]"
                    >
                      <option value="" className="bg-[#1C1C1C]">
                        No default goal
                      </option>
                      {goals
                        .filter((g) => g.name.trim())
                        .map((g) => (
                          <option key={g.tempId} value={g.tempId} className="bg-[#1C1C1C]">
                            {g.name}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      title={proj.isPinned ? 'Pinned to sidebar' : 'Pin to sidebar'}
                      onClick={() =>
                        setProjects((prev) =>
                          prev.map((p, i) => (i === idx ? { ...p, isPinned: !p.isPinned } : p)),
                        )
                      }
                      className={`h-8 px-2 rounded-[7px] border text-[11.5px] inline-flex items-center gap-1 ${
                        proj.isPinned
                          ? 'bg-[#1F2759] border-[#5566F2]/50 text-[#AEB8FF]'
                          : 'bg-[#262626] border-[#3C3C3C] text-[#9A9A9A]'
                      }`}
                    >
                      <Pin size={12} />
                    </button>
                    {projects.length > 1 ? (
                      <button
                        type="button"
                        aria-label="Remove project"
                        onClick={() => setProjects((prev) => prev.filter((_, i) => i !== idx))}
                        className="h-8 w-8 rounded-[7px] inline-flex items-center justify-center text-[#6E6E6E] hover:text-[#FF9EC5]"
                      >
                        <Trash2 size={13} />
                      </button>
                    ) : null}
                  </div>

                  <div className="flex items-center justify-between gap-2 flex-wrap pl-8">
                    {/* Color swatches */}
                    <div className="flex items-center gap-1.5">
                      {PROJECT_ACCENT_COLORS.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          aria-label={`Project color ${hex}`}
                          onClick={() =>
                            setProjects((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, color: hex } : p)),
                            )
                          }
                          style={{ backgroundColor: hex }}
                          className={`w-4 h-4 rounded-full ${
                            proj.color === hex
                              ? 'ring-2 ring-white ring-offset-2 ring-offset-[#1C1C1C]'
                              : 'opacity-70 hover:opacity-100'
                          }`}
                        />
                      ))}
                    </div>

                    {/* Icon picker (monogram or 8 Lucide vector icons) */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          setProjects((prev) =>
                            prev.map((p, i) => (i === idx ? { ...p, icon: null } : p)),
                          )
                        }
                        className={`h-6 px-1.5 rounded-[5px] text-[10px] font-semibold border ${
                          proj.icon === null
                            ? 'bg-[#262626] border-[#5566F2] text-[#EDEDED]'
                            : 'border-transparent text-[#6E6E6E] hover:text-[#C4C4C4]'
                        }`}
                      >
                        AA
                      </button>
                      {PROJECT_ICON_KEYS.map((iconKey) => (
                        <button
                          key={iconKey}
                          type="button"
                          aria-label={`Icon ${iconKey}`}
                          onClick={() =>
                            setProjects((prev) =>
                              prev.map((p, i) => (i === idx ? { ...p, icon: iconKey } : p)),
                            )
                          }
                          className={`h-6 w-6 rounded-[5px] inline-flex items-center justify-center border ${
                            proj.icon === iconKey
                              ? 'bg-[#262626] border-[#5566F2] text-[#EDEDED]'
                              : 'border-transparent text-[#6E6E6E] hover:text-[#C4C4C4]'
                          }`}
                        >
                          <ProjectIcon icon={iconKey} size={12} />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-[13px] text-[#C4C4C4]">
              <Server size={15} className="text-[#7EE3F0]" />
              <span>Choose where your SQLite database lives and connect the CLI.</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setServerMode('local')}
                className={`p-4 rounded-[10px] border text-left transition-colors ${
                  serverMode === 'local'
                    ? 'bg-[#1C1F33] border-[#5566F2]/70'
                    : 'bg-[#171717] border-[#2A2A2A] hover:border-[#3C3C3C]'
                }`}
              >
                <div className="text-[13.5px] font-semibold text-[#EDEDED]">
                  Local Embedded Server
                </div>
                <p className="mt-1 text-[12px] text-[#9A9A9A]">
                  Zero-config SQLite stored locally on this Mac at <code className="text-[#C4C4C4]">127.0.0.1:4173</code>.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setServerMode('remote')}
                className={`p-4 rounded-[10px] border text-left transition-colors ${
                  serverMode === 'remote'
                    ? 'bg-[#1C1F33] border-[#5566F2]/70'
                    : 'bg-[#171717] border-[#2A2A2A] hover:border-[#3C3C3C]'
                }`}
              >
                <div className="text-[13.5px] font-semibold text-[#EDEDED]">
                  Self-Hosted Server
                </div>
                <p className="mt-1 text-[12px] text-[#9A9A9A]">
                  Connect to your Docker / VPS instance over HTTPS with Bearer token auth.
                </p>
              </button>
            </div>

            {serverMode === 'remote' ? (
              <div className="space-y-2.5 pt-1">
                <label className="block space-y-1">
                  <span className="text-[12px] text-[#9A9A9A]">Server URL</span>
                  <input
                    type="url"
                    value={remoteUrl}
                    onChange={(e) => setRemoteUrl(e.target.value)}
                    placeholder="https://veyra.yourdomain.com"
                    className="w-full h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none focus:border-[#5566F2]"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[12px] text-[#9A9A9A]">Bearer Token</span>
                  <input
                    type="password"
                    value={remoteToken}
                    onChange={(e) => setRemoteToken(e.target.value)}
                    placeholder="VEYRA_TOKEN"
                    className="w-full h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none focus:border-[#5566F2]"
                  />
                </label>
              </div>
            ) : null}

            <div className="space-y-1.5 pt-2 border-t border-[#2A2A2A]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
                  CLI &amp; Agent Quickstart
                </span>
                <button
                  type="button"
                  onClick={handleCopyCli}
                  className="text-[11.5px] text-[#AEB8FF] hover:text-[#D6DCFF] inline-flex items-center gap-1"
                >
                  {copiedCli ? <Check size={12} /> : <Copy size={12} />}
                  {copiedCli ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre className="p-3 rounded-[8px] bg-[#131313] border border-[#2A2A2A] font-mono text-[12px] text-[#C4C4C4] overflow-x-auto">
                {cliSnippet}
              </pre>
            </div>
          </div>
        ) : null}

        {error ? <div className="text-[12px] text-[#FF9EC5]">{error}</div> : null}
      </div>
    </ModalSheet>
  );
}
