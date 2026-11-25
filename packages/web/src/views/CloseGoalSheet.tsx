import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Goal, GoalWithStats } from '@veyra/core/types';
import { Archive, CheckCircle2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { invalidateAllVeyraData, useGoalDetailQuery } from '../api/queries';
import { Button } from '../components/Button';
import { GoalKindIconBadge } from '../components/GoalChip';
import { ModalSheet } from '../components/ModalSheet';

export interface CloseGoalSheetProps {
  open: boolean;
  goal?: Goal | GoalWithStats | null;
  goalId?: string | null;
  initialStatus?: 'achieved' | 'archived';
  onClose: () => void;
  onClosed?: () => void;
}

export function CloseGoalSheet({
  open,
  goal: goalProp = null,
  goalId = null,
  initialStatus = 'achieved',
  onClose,
  onClosed,
}: CloseGoalSheetProps) {
  const queryClient = useQueryClient();
  const detailQuery = useGoalDetailQuery(open && !goalProp && goalId ? goalId : null);
  const goal = goalProp ?? detailQuery.data?.goal ?? null;

  const [status, setStatus] = useState<'achieved' | 'archived'>(initialStatus);
  const [closingNote, setClosingNote] = useState('');

  useEffect(() => {
    if (!open) return;
    setStatus(initialStatus);
    setClosingNote(goal?.closingNote ?? '');
  }, [open, initialStatus, goal?.id, goal?.closingNote]);

  const closeMutation = useMutation({
    mutationFn: () => {
      if (!goal) throw new Error('Goal not found');
      return apiClient.closeGoal(goal.id, {
        status,
        closingNote: closingNote.trim() || null,
      });
    },
    onSuccess: () => {
      void invalidateAllVeyraData(queryClient);
      onClosed?.();
      onClose();
    },
  });

  if (!open) return null;

  return (
    <ModalSheet
      open={open}
      onClose={onClose}
      width={540}
      ariaLabel="Close goal"
      title="Close Goal"
      bodyClassName="!p-6"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            loading={closeMutation.isPending}
            disabled={!goal || closeMutation.isPending}
            onClick={() => closeMutation.mutate()}
          >
            Confirm
          </Button>
        </div>
      }
    >
      {!goal ? (
        <div className="text-[13px] text-[#9A9A9A]">Loading goal…</div>
      ) : (
        <div className="space-y-5">
          {/* Goal Summary Header */}
          <div className="flex items-center gap-3 pb-4 border-b border-[#2A2A2A]">
            <GoalKindIconBadge kind={goal.kind} color={goal.color} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="font-display text-[17px] font-semibold text-[#EDEDED] truncate">
                {goal.name}
              </div>
              <div className="text-[12.5px] text-[#9A9A9A]">
                {goal.kind === 'company' ? 'Company goal' : 'Personal goal'}
              </div>
            </div>
          </div>

          {/* Equal-height choice cards */}
          <div className="grid grid-cols-2 gap-3 items-stretch">
            <button
              type="button"
              aria-pressed={status === 'achieved'}
              onClick={() => setStatus('achieved')}
              className={[
                'h-full p-4 rounded-[10px] border text-left transition-colors flex flex-col gap-1.5',
                status === 'achieved'
                  ? 'bg-[#14331F]/65 border-[#2FB463]/70 text-[#EDEDED]'
                  : 'bg-[#242424] border-[#2A2A2A] text-[#C4C4C4] hover:border-[#3C3C3C]',
              ].join(' ')}
            >
              <span className="inline-flex items-center gap-2 text-[13.5px] font-semibold">
                <CheckCircle2
                  size={15}
                  className={status === 'achieved' ? 'text-[#7BE0A0]' : 'text-[#9A9A9A]'}
                />
                <span>Mark Achieved</span>
              </span>
              <span className="text-[12px] text-[#9A9A9A] leading-snug">
                Outcome reached — keep a clean record in your closed goals history.
              </span>
            </button>

            <button
              type="button"
              aria-pressed={status === 'archived'}
              onClick={() => setStatus('archived')}
              className={[
                'h-full p-4 rounded-[10px] border text-left transition-colors flex flex-col gap-1.5',
                status === 'archived'
                  ? 'bg-[#1F2759]/80 border-[#5566F2] text-[#EDEDED]'
                  : 'bg-[#242424] border-[#2A2A2A] text-[#C4C4C4] hover:border-[#3C3C3C]',
              ].join(' ')}
            >
              <span className="inline-flex items-center gap-2 text-[13.5px] font-semibold">
                <Archive
                  size={15}
                  className={status === 'archived' ? 'text-[#AEB8FF]' : 'text-[#9A9A9A]'}
                />
                <span>Let Go</span>
              </span>
              <span className="text-[12px] text-[#9A9A9A] leading-snug">
                Priorities shifted — set this goal aside deliberately without clutter.
              </span>
            </button>
          </div>

          {/* Optional closing note */}
          <div className="space-y-2">
            <label
              htmlFor="close-goal-note"
              className="block text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]"
            >
              What did this goal bring?
            </label>
            <textarea
              id="close-goal-note"
              rows={3}
              value={closingNote}
              onChange={(e) => setClosingNote(e.target.value)}
              placeholder="Optional takeaway, learning, or reason for closing…"
              className="w-full p-3 rounded-[8px] bg-[#242424] border border-[#2A2A2A] focus:border-[#5566F2] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none resize-none"
            />
          </div>

          {closeMutation.isError ? (
            <div className="text-[12px] text-[#FF9EC5]">
              {closeMutation.error instanceof Error
                ? closeMutation.error.message
                : 'Could not close goal.'}
            </div>
          ) : null}
        </div>
      )}
    </ModalSheet>
  );
}
