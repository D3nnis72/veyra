import { useMutation, useQueryClient } from '@tanstack/react-query';
import { COLOR_PICKER_PRESETS, type Goal, type GoalKind } from '@veyra/core/types';
import { Briefcase, User } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { invalidateAllVeyraData, useGoalDetailQuery } from '../api/queries';
import { Button } from '../components/Button';
import { ColorPicker } from '../components/ColorPicker';
import { DockedDrawer } from '../components/DockedDrawer';
import { GoalKindIconBadge } from '../components/GoalChip';

export interface GoalFormDrawerProps {
  open: boolean;
  mode: 'create' | 'edit';
  goalId?: string | null;
  defaultKind?: GoalKind;
  onClose: () => void;
  onSaved?: (goal: Goal) => void;
  dismissOnEscape?: boolean;
}

const DEFAULT_COLOR = COLOR_PICKER_PRESETS[0].hex;

export function GoalFormDrawer({
  open,
  mode,
  goalId = null,
  defaultKind = 'personal',
  onClose,
  onSaved,
  dismissOnEscape = true,
}: GoalFormDrawerProps) {
  const queryClient = useQueryClient();
  const detailQuery = useGoalDetailQuery(open && mode === 'edit' ? goalId : null);
  const existing = mode === 'edit' ? (detailQuery.data?.goal ?? null) : null;

  const [name, setName] = useState('');
  const [kind, setKind] = useState<GoalKind>(defaultKind);
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [description, setDescription] = useState('');
  const [doneWhen, setDoneWhen] = useState('');
  const [checkInDate, setCheckInDate] = useState('');
  const [measure, setMeasure] = useState('');
  const [ifItStalls, setIfItStalls] = useState('');

  useEffect(() => {
    if (!open) return;
    if (mode === 'edit') {
      if (!existing) return;
      setName(existing.name);
      setKind(existing.kind);
      setColor(existing.color);
      setDescription(existing.description);
      setDoneWhen(existing.doneWhen);
      setCheckInDate(existing.checkInDate ?? '');
      setMeasure(existing.measure ?? '');
      setIfItStalls(existing.ifItStalls);
    } else {
      setName('');
      setKind(defaultKind);
      setColor(DEFAULT_COLOR);
      setDescription('');
      setDoneWhen('');
      setCheckInDate('');
      setMeasure('');
      setIfItStalls('');
    }
  }, [open, mode, defaultKind, existing?.id, existing?.updatedAt]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        kind,
        color,
        description: description.trim(),
        doneWhen: doneWhen.trim(),
        checkInDate: checkInDate.trim() ? checkInDate.trim() : null,
        measure: measure.trim() ? measure.trim() : null,
        ifItStalls: ifItStalls.trim(),
      };
      if (mode === 'edit' && goalId) {
        return apiClient.updateGoal(goalId, payload);
      }
      return apiClient.createGoal(payload);
    },
    onSuccess: (res) => {
      void invalidateAllVeyraData(queryClient);
      onSaved?.(res.goal);
      onClose();
    },
  });

  const isEditPending = mode === 'edit' && (detailQuery.isLoading || !existing);
  const canSubmit =
    name.trim().length > 0 &&
    !saveMutation.isPending &&
    (mode === 'create' || (Boolean(existing) && !detailQuery.isLoading));

  const handleSubmit = (e?: FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;
    saveMutation.mutate();
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (canSubmit) {
          saveMutation.mutate();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, canSubmit, saveMutation]);

  const kindTitle = kind === 'company' ? 'Company' : 'Personal';
  const drawerTitle =
    mode === 'edit'
      ? isEditPending
        ? 'Edit Goal'
        : `Edit Goal · ${kindTitle}`
      : 'New Goal';

  return (
    <DockedDrawer
      open={open}
      onClose={onClose}
      dismissOnEscape={dismissOnEscape}
      width={520}
      ariaLabel={mode === 'edit' ? 'Edit goal' : 'Create goal'}
      title={drawerTitle}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            loading={saveMutation.isPending}
            disabled={!canSubmit}
            onClick={() => handleSubmit()}
          >
            {mode === 'edit' ? 'Save Changes' : 'Create Goal'}
          </Button>
        </div>
      }
    >
      {isEditPending ? (
        <div className="text-[13px] text-[#9A9A9A]">
          {detailQuery.isError ? 'Could not load goal details.' : 'Loading goal…'}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Hero Identity Preview */}
          <div className="flex items-center gap-3 pb-5 border-b border-[#2A2A2A]">
            <GoalKindIconBadge kind={kind} color={color} size="lg" />
            <div className="flex-1 min-w-0">
              <input
                type="text"
                aria-label="Goal name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Goal name…"
                autoFocus
                className="w-full h-10 px-3 rounded-[8px] bg-[#242424] border border-[#2A2A2A] focus:border-[#5566F2] font-display text-[17px] font-semibold text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
              />
            </div>
          </div>

          {/* KIND: Equal-height Personal / Company cards */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
              Kind
            </div>
            <div className="grid grid-cols-2 gap-3 items-stretch">
              <button
                type="button"
                aria-pressed={kind === 'personal'}
                onClick={() => setKind('personal')}
                className={[
                  'h-full p-4 rounded-[8px] border text-left transition-colors flex flex-col gap-1',
                  kind === 'personal'
                    ? 'bg-[#1F2759] border-[#5566F2] text-[#EDEDED]'
                    : 'bg-[#242424] border-[#2A2A2A] text-[#C4C4C4] hover:border-[#3C3C3C]',
                ].join(' ')}
              >
                <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
                  <User size={14} className={kind === 'personal' ? 'text-[#AEB8FF]' : 'text-[#9A9A9A]'} />
                  <span>Personal</span>
                </span>
                <span className="text-[11.5px] text-[#9A9A9A] leading-snug">
                  Craft, energy, health, or individual growth
                </span>
              </button>

              <button
                type="button"
                aria-pressed={kind === 'company'}
                onClick={() => setKind('company')}
                className={[
                  'h-full p-4 rounded-[8px] border text-left transition-colors flex flex-col gap-1',
                  kind === 'company'
                    ? 'bg-[#1F2759] border-[#5566F2] text-[#EDEDED]'
                    : 'bg-[#242424] border-[#2A2A2A] text-[#C4C4C4] hover:border-[#3C3C3C]',
                ].join(' ')}
              >
                <span className="inline-flex items-center gap-2 text-[13px] font-semibold">
                  <Briefcase size={14} className={kind === 'company' ? 'text-[#AEB8FF]' : 'text-[#9A9A9A]'} />
                  <span>Company</span>
                </span>
                <span className="text-[11.5px] text-[#9A9A9A] leading-snug">
                  Product, customer, or strategic team outcomes
                </span>
              </button>
            </div>
          </div>

          {/* COLOR strictly below KIND */}
          <div className="pb-5 border-b border-[#2A2A2A]">
            <ColorPicker value={color} onChange={setColor} label="Color" />
          </div>

          {/* WHY IT MATTERS */}
          <div className="space-y-2">
            <label
              htmlFor="goal-form-why"
              className="block text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]"
            >
              Why it matters
            </label>
            <textarea
              id="goal-form-why"
              aria-label="Why it matters"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why does this goal deserve focus right now?"
              className="w-full p-3 rounded-[8px] bg-[#242424] border border-[#2A2A2A] focus:border-[#5566F2] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none resize-none"
            />
          </div>

          {/* DONE WHEN */}
          <div className="space-y-2">
            <label
              htmlFor="goal-form-done-when"
              className="block text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]"
            >
              Done when
            </label>
            <textarea
              id="goal-form-done-when"
              aria-label="Done when"
              rows={2}
              value={doneWhen}
              onChange={(e) => setDoneWhen(e.target.value)}
              placeholder="Concrete outcome that marks this goal complete…"
              className="w-full p-3 rounded-[8px] bg-[#242424] border border-[#2A2A2A] focus:border-[#5566F2] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none resize-none"
            />
          </div>

          {/* CHECK IN DATE & MEASURE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <label
                htmlFor="goal-form-checkin"
                className="block text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]"
              >
                Check in date (optional)
              </label>
              <input
                id="goal-form-checkin"
                type="date"
                aria-label="Check in date"
                value={checkInDate}
                onChange={(e) => setCheckInDate(e.target.value)}
                className="w-full h-9 px-3 rounded-[8px] bg-[#242424] border border-[#2A2A2A] focus:border-[#5566F2] text-[13px] text-[#EDEDED] focus:outline-none"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="goal-form-measure"
                className="block text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]"
              >
                Measure (optional)
              </label>
              <input
                id="goal-form-measure"
                type="text"
                aria-label="Measure"
                value={measure}
                onChange={(e) => setMeasure(e.target.value)}
                placeholder="e.g. 6 / 10 customers live"
                className="w-full h-9 px-3 rounded-[8px] bg-[#242424] border border-[#2A2A2A] focus:border-[#5566F2] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none"
              />
            </div>
          </div>

          {/* IF IT STALLS */}
          <div className="space-y-2">
            <label
              htmlFor="goal-form-stalls"
              className="block text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]"
            >
              If it stalls (optional)
            </label>
            <textarea
              id="goal-form-stalls"
              aria-label="If it stalls"
              rows={2}
              value={ifItStalls}
              onChange={(e) => setIfItStalls(e.target.value)}
              placeholder="First concrete fallback move if momentum slows…"
              className="w-full p-3 rounded-[8px] bg-[#242424] border border-[#2A2A2A] focus:border-[#5566F2] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none resize-none"
            />
          </div>

          {saveMutation.isError ? (
            <div className="text-[12px] text-[#FF9EC5]">
              {saveMutation.error instanceof Error
                ? saveMutation.error.message
                : 'Could not save goal.'}
            </div>
          ) : null}
        </form>
      )}
    </DockedDrawer>
  );
}
