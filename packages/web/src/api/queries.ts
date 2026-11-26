import type { QueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import type {
  ListActivityFilter,
  ListBlocksFilter,
  ListDailyNotesFilter,
  ListGoalsFilter,
  ListProjectsFilter,
} from '@veyra/core/types';
import { apiClient, queryKeys } from './client';

export function invalidateAllVeyraData(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries();
}

export function invalidateBlockRelated(queryClient: QueryClient, blockId?: string): void {
  const keys: unknown[][] = [
    ['today'],
    ['plan'],
    ['calendar'],
    ['review'],
    ['blocks'],
    ['projects'],
    ['project'],
    ['goals'],
    ['goal'],
    ['focus'],
  ];
  if (blockId) {
    keys.push(['block', blockId]);
  } else {
    keys.push(['block']);
  }
  for (const queryKey of keys) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

export function invalidateNotesRelated(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['notes'] });
  void queryClient.invalidateQueries({ queryKey: ['today'] });
  void queryClient.invalidateQueries({ queryKey: ['review'] });
}

export function useSettingsQuery() {
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: () => apiClient.getSettings(),
  });
}

export function useTodayQuery() {
  return useQuery({
    queryKey: queryKeys.today,
    queryFn: () => apiClient.getToday(),
  });
}

export function useFocusQuery() {
  return useQuery({
    queryKey: queryKeys.focus,
    queryFn: () => apiClient.getFocus(),
  });
}

export function useProjectsQuery(filter?: ListProjectsFilter) {
  return useQuery({
    queryKey: queryKeys.projects(filter),
    queryFn: () => apiClient.listProjects(filter),
  });
}

export function useGoalsQuery(filter?: ListGoalsFilter) {
  return useQuery({
    queryKey: queryKeys.goals(filter),
    queryFn: () => apiClient.listGoals(filter),
  });
}

export function useGoalDetailQuery(goalId: string | null) {
  return useQuery({
    queryKey: goalId ? queryKeys.goal(goalId) : ['goal', 'none'],
    queryFn: () => apiClient.getGoal(goalId!),
    enabled: Boolean(goalId),
  });
}

export function useBlockDetailQuery(blockId: string | null) {
  return useQuery({
    queryKey: blockId ? queryKeys.block(blockId) : ['block', 'none'],
    queryFn: () => apiClient.getBlock(blockId!),
    enabled: Boolean(blockId),
  });
}

export function useDailyNotesQuery(filter?: ListDailyNotesFilter, enabled = true) {
  return useQuery({
    queryKey: queryKeys.notes(filter),
    queryFn: () => apiClient.listNotes(filter),
    enabled,
  });
}

export function useNoteTagsQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.noteTags,
    queryFn: () => apiClient.listNoteTags(),
    enabled,
    staleTime: 30_000,
  });
}

export function usePlanQuery(weekStart?: string) {
  return useQuery({
    queryKey: queryKeys.plan(weekStart),
    queryFn: () => apiClient.getPlan(weekStart),
  });
}

export function useCalendarQuery(start?: string, end?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.calendar(start, end),
    queryFn: () => apiClient.getCalendar(start, end),
    enabled,
  });
}

export function useProjectDetailQuery(projectId: string | null) {
  return useQuery({
    queryKey: projectId ? queryKeys.project(projectId) : ['project', 'none'],
    queryFn: () => apiClient.getProject(projectId!),
    enabled: Boolean(projectId),
  });
}

export function useReviewQuery(weekOrStart?: string | number) {
  return useQuery({
    queryKey: queryKeys.review(weekOrStart),
    queryFn: () => apiClient.getReview(weekOrStart),
  });
}

export function useBlocksQuery(filter?: ListBlocksFilter, enabled = true) {
  return useQuery({
    queryKey: queryKeys.blocks(filter),
    queryFn: () => apiClient.listBlocks(filter),
    enabled,
  });
}

export function useEventsQuery(start?: string, end?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.events(start, end),
    queryFn: () => apiClient.listEvents(start, end),
    enabled,
  });
}

export function useActivityQuery(filter?: ListActivityFilter, enabled = true) {
  return useQuery({
    queryKey: queryKeys.activity(filter),
    queryFn: () => apiClient.listActivity(filter),
    enabled,
  });
}

export function useNotionSearchQuery(q: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.notionSearch(q),
    queryFn: () => apiClient.searchNotion(q),
    enabled,
    staleTime: 15_000,
  });
}
