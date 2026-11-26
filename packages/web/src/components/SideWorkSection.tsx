import type { BlockSideWorkEntry, Project } from '@veyra/core/types';
import { ProjectBadge } from './ProjectBadge';

const UNMAPPED_PROJECT_COLOR = '#6E6E6E';

export interface SideWorkSectionProps {
  sideWork: BlockSideWorkEntry[] | null | undefined;
  projects: Pick<Project, 'id' | 'name' | 'color' | 'icon'>[];
}

/**
 * Quiet hairline "Also during this block" section under the auto-summary: other
 * projects worked on during the block's window (e.g. T3 Code threads), as written
 * by the post-block summary run. Display only; the block's time is not split.
 * Renders nothing when the block has no side work.
 */
export function SideWorkSection({ sideWork, projects }: SideWorkSectionProps) {
  if (!sideWork || sideWork.length === 0) {
    return null;
  }

  return (
    <section aria-label="Also during this block" className="space-y-2.5 pt-4 border-t border-[#2A2A2A]">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#6E6E6E]">
          Also during this block
        </span>
        <span className="text-[11px] text-[#6E6E6E]">Time stays on this block</span>
      </div>
      <ul className="space-y-2">
        {sideWork.map((entry) => {
          const project = entry.projectId
            ? projects.find((p) => p.id === entry.projectId)
            : undefined;
          return (
            <li key={entry.projectId ?? `name:${entry.projectName}`} className="flex items-start gap-2">
              <ProjectBadge
                name={project?.name ?? entry.projectName}
                color={project?.color ?? UNMAPPED_PROJECT_COLOR}
                icon={project?.icon ?? null}
                size="xs"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5 text-[12.5px] leading-5">
                  <span className="font-medium text-[#C4C4C4] truncate">
                    {project?.name ?? entry.projectName}
                  </span>
                  <span className="text-[#6E6E6E] shrink-0">
                    {entry.messageCount} {entry.messageCount === 1 ? 'message' : 'messages'}
                  </span>
                </div>
                {entry.threads.length > 0 ? (
                  <ul className="mt-0.5 space-y-0.5">
                    {entry.threads.map((thread, idx) => (
                      <li
                        key={`${thread.title}-${idx}`}
                        className="flex items-baseline gap-1.5 text-[12px] leading-[1.45] text-[#9A9A9A]"
                      >
                        <span className="min-w-0 truncate">{thread.title}</span>
                        <span className="text-[#6E6E6E] shrink-0 tabular-nums">
                          {thread.messageCount}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
