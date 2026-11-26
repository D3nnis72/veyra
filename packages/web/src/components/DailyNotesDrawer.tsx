import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DailyNote, ProjectWithStats } from '@veyra/core/types';
import { CornerDownLeft, Flame, FolderKanban, NotebookPen, Trash2 } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '../api/client';
import {
  invalidateNotesRelated,
  useDailyNotesQuery,
  useNoteTagsQuery,
  useProjectsQuery,
} from '../api/queries';
import { Button } from './Button';
import { DockedDrawer } from './DockedDrawer';
import { NoteTagChip, NoteTagSuggestions, useNoteTagAutocomplete } from './NoteTags';
import { Pill } from './Pill';
import { ProjectBadge } from './ProjectBadge';
import { SelectPopover } from './SelectPopover';
import { formatDateHeading, formatLocalTime, formatShortDate, getTodayDateString } from './icons';

export interface DailyNotesDrawerProps {
  open: boolean;
  date?: string;
  onClose: () => void;
}

export function DailyNotesDrawer({ open, date, onClose }: DailyNotesDrawerProps) {
  const queryClient = useQueryClient();
  const effectiveDate = date ?? getTodayDateString();
  const inputRef = useRef<HTMLInputElement>(null);

  const [draft, setDraft] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isOps, setIsOps] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');
  /** Active tag filter: shows every note with this tag across all dates instead of one day. */
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const notesQuery = useDailyNotesQuery(
    tagFilter ? { tag: tagFilter } : { date: effectiveDate },
    open,
  );
  const tagsQuery = useNoteTagsQuery(open);
  const projectsQuery = useProjectsQuery({ includeArchived: false });
  const tagAutocomplete = useNoteTagAutocomplete(draft, setDraft, inputRef, tagsQuery.data?.tags);
  const allTags = tagsQuery.data?.tags ?? [];

  const toggleTagFilter = (tag: string) => {
    setTagFilter((current) => (current === tag ? null : tag));
    setEditingNoteId(null);
  };

  const projectsById = useMemo(() => {
    const map = new Map<string, ProjectWithStats>();
    for (const p of projectsQuery.data?.projects ?? []) {
      map.set(p.id, p);
    }
    return map;
  }, [projectsQuery.data]);

  const activeProjects = useMemo(
    () => (projectsQuery.data?.projects ?? []).filter((p) => p.status !== 'archived'),
    [projectsQuery.data],
  );

  useEffect(() => {
    if (open) {
      window.setTimeout(() => inputRef.current?.focus(), 60);
    } else {
      setEditingNoteId(null);
      setTagFilter(null);
    }
  }, [open]);

  const addMutation = useMutation({
    mutationFn: () =>
      apiClient.addNote({
        content: draft.trim(),
        // In the tag view a new note lands today and carries the active tag.
        date: tagFilter ? getTodayDateString() : effectiveDate,
        projectId: selectedProjectId,
        isOps,
        ...(tagFilter ? { tags: [tagFilter] } : {}),
      }),
    onSuccess: () => {
      setDraft('');
      invalidateNotesRelated(queryClient);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      apiClient.updateNote(id, { content }),
    onSuccess: () => {
      setEditingNoteId(null);
      invalidateNotesRelated(queryClient);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.deleteNote(id),
    onSuccess: () => {
      invalidateNotesRelated(queryClient);
    },
  });

  const handleAdd = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim() || addMutation.isPending) return;
    addMutation.mutate();
  };

  const startEditing = (note: DailyNote) => {
    setEditingNoteId(note.id);
    setEditingContent(note.content);
  };

  const commitEdit = (note: DailyNote) => {
    const trimmed = editingContent.trim();
    if (!trimmed || trimmed === note.content) {
      setEditingNoteId(null);
      return;
    }
    updateMutation.mutate({ id: note.id, content: trimmed });
  };

  // Day view reads like a log (oldest first); the tag view is a worklist (newest first).
  const notes = useMemo(() => {
    const list = notesQuery.data?.notes ?? [];
    return tagFilter ? [...list].reverse() : list;
  }, [notesQuery.data, tagFilter]);

  return (
    <DockedDrawer
      open={open}
      onClose={onClose}
      width={520}
      ariaLabel="Notes"
      title={
        <div className="flex items-center gap-2">
          <NotebookPen size={16} className="text-[#AEB8FF] shrink-0" />
          <span className="font-display text-[16px] font-semibold text-[#EDEDED]">
            Notes
          </span>
        </div>
      }
      subtitle={
        tagFilter
          ? `#${tagFilter} · all dates · ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`
          : formatDateHeading(effectiveDate)
      }
      headerActions={
        <Pill tone="accent" title="Global shortcut opens floating capture anywhere">
          ⌘⇧P Global
        </Pill>
      }
      footer={
        <form onSubmit={handleAdd} className="space-y-2.5">
          <NoteTagSuggestions autocomplete={tagAutocomplete} />
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              aria-label="New note"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                tagAutocomplete.syncCaret(e.target);
              }}
              onSelect={(e) => tagAutocomplete.syncCaret(e.currentTarget)}
              onKeyDown={(e) => {
                if (tagAutocomplete.handleKey(e)) {
                  e.nativeEvent.stopPropagation();
                }
              }}
              placeholder={
                tagFilter
                  ? `Add a note to #${tagFilter}… (Enter to save)`
                  : 'Jot down a thought, blocker, or win… #tag (Enter to save)'
              }
              className="flex-1 h-9 px-3 rounded-[8px] bg-[#262626] border border-[#3C3C3C] text-[13px] text-[#EDEDED] placeholder:text-[#6E6E6E] focus:outline-none focus:border-[#5566F2]"
            />
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={!draft.trim() || addMutation.isPending}
              rightIcon={<CornerDownLeft size={13} />}
            >
              Add
            </Button>
          </div>

          <div className="flex items-center flex-wrap gap-2">
            <SelectPopover
              ariaLabel="Optional project tag"
              size="sm"
              placement="top"
              menuTitle="Project tag"
              value={selectedProjectId ?? ''}
              placeholder="No project"
              leading={
                selectedProjectId ? undefined : (
                  <FolderKanban size={12} className="text-[#9A9A9A] shrink-0" />
                )
              }
              onChange={(val) => setSelectedProjectId(val || null)}
              options={[
                { value: '', label: 'No project', muted: true },
                ...activeProjects
                  .filter((p) => !p.isSystem)
                  .map((project) => ({
                    value: project.id,
                    label: project.name,
                    leading: (
                      <ProjectBadge
                        name={project.name}
                        color={project.color}
                        icon={project.icon}
                        size="xs"
                      />
                    ),
                  })),
              ]}
            />

            <button
              type="button"
              onClick={() => setIsOps((prev) => !prev)}
              className={[
                'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-[6px] border text-[12px] font-medium transition-colors',
                isOps
                  ? 'bg-[#3A3110] border-[#E8B417]/40 text-[#F2D06B]'
                  : 'bg-[#262626] border-[#3C3C3C] text-[#9A9A9A] hover:text-[#EDEDED]',
              ].join(' ')}
            >
              <Flame size={12} />
              <span>Ops</span>
            </button>
          </div>
        </form>
      }
    >
      {allTags.length > 0 ? (
        <div
          role="group"
          aria-label="Filter notes by tag"
          className="flex items-center flex-wrap gap-1.5 pb-4 mb-1 border-b border-[#2A2A2A]"
        >
          {allTags.map(({ tag, count }) => (
            <NoteTagChip
              key={tag}
              tag={tag}
              count={count}
              active={tagFilter === tag}
              title={tagFilter === tag ? 'Show today again' : `All notes with #${tag}`}
              onClick={() => toggleTagFilter(tag)}
            />
          ))}
          {tagFilter ? (
            <button
              type="button"
              onClick={() => setTagFilter(null)}
              className="ml-1 text-[12px] font-medium text-[#9A9A9A] hover:text-[#EDEDED]"
            >
              Clear filter
            </button>
          ) : null}
        </div>
      ) : null}
      {notesQuery.isLoading ? (
        <div className="py-10 text-center text-[13px] text-[#6E6E6E]">Loading notes…</div>
      ) : notes.length === 0 ? (
        <div className="py-12 px-4 text-center space-y-2">
          <div className="text-[14px] font-medium text-[#C4C4C4]">
            {tagFilter ? `No notes with #${tagFilter}` : 'No notes captured yet'}
          </div>
          <p className="text-[12.5px] text-[#6E6E6E] max-w-[320px] mx-auto">
            Capture timestamped bullets here or from anywhere on macOS with{' '}
            <span className="text-[#9A9A9A] font-medium">⌘⇧P</span>. They show up in your Weekly
            Review automatically.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-[#2A2A2A]">
          {notes.map((note) => {
            const project = note.projectId ? projectsById.get(note.projectId) : undefined;
            const isEditing = editingNoteId === note.id;

            return (
              <li key={note.id} className="group py-3 first:pt-1 flex items-start gap-3">
                <span
                  className={`mt-0.5 text-[11.5px] font-medium text-[#6E6E6E] tabular-nums shrink-0 ${
                    tagFilter ? 'w-[72px]' : 'w-11'
                  }`}
                >
                  {tagFilter ? (
                    <>
                      <span className="block text-[#9A9A9A]">{formatShortDate(note.date)}</span>
                      <span className="block">{formatLocalTime(note.createdAt)}</span>
                    </>
                  ) : (
                    formatLocalTime(note.createdAt)
                  )}
                </span>

                <div className="flex-1 min-w-0 space-y-1.5">
                  {isEditing ? (
                    <input
                      autoFocus
                      type="text"
                      value={editingContent}
                      onChange={(e) => setEditingContent(e.target.value)}
                      onBlur={() => commitEdit(note)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitEdit(note);
                        } else if (e.key === 'Escape') {
                          e.stopPropagation();
                          setEditingNoteId(null);
                        }
                      }}
                      className="w-full h-8 px-2.5 rounded-[6px] bg-[#262626] border border-[#5566F2] text-[13.5px] text-[#EDEDED] focus:outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEditing(note)}
                      className="text-left text-[13.5px] leading-[1.45] text-[#EDEDED] hover:text-white break-words w-full"
                    >
                      {note.content}
                    </button>
                  )}

                  {(project || note.isOps || (note.tags?.length ?? 0) > 0) ? (
                    <div className="flex items-center flex-wrap gap-1.5">
                      {project ? (
                        <span className="inline-flex items-center gap-1.5 h-[22px] pl-1 pr-2 rounded-[6px] bg-[#262626] border border-[#3C3C3C] text-[11.5px] text-[#C4C4C4]">
                          <ProjectBadge
                            name={project.name}
                            color={project.color}
                            icon={project.icon}
                            size="xs"
                          />
                          <span className="truncate max-w-[140px]">{project.name}</span>
                        </span>
                      ) : null}
                      {note.isOps ? (
                        <Pill tone="ops" dot>
                          Ops
                        </Pill>
                      ) : null}
                      {(note.tags ?? []).map((tag) => (
                        <NoteTagChip
                          key={tag}
                          tag={tag}
                          active={tagFilter === tag}
                          title={`All notes with #${tag}`}
                          onClick={() => toggleTagFilter(tag)}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={() => deleteMutation.mutate(note.id)}
                  aria-label="Delete note"
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 h-7 w-7 rounded-[6px] inline-flex items-center justify-center text-[#6E6E6E] hover:text-[#FF9EC5] hover:bg-[#3D1A2B]/60 transition-all shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </DockedDrawer>
  );
}
