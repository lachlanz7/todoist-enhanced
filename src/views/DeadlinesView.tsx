import { useMemo } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { SubtasksProvider } from '@/components/TaskRow';
import { TaskGroup } from '@/components/TaskGroup';
import { useData } from '@/hooks/useData';
import { useT } from '@/hooks/useT';
import { useToday } from '@/hooks/useToday';
import { useStore } from '@/store/store';
import { summariseLoad } from '@/domain/load';
import { groupByDeadline } from '@/domain/deadlineGroups';
import type { TranslationKey } from '@/i18n';
import type { Item } from '@/domain/types';

/**
 * Every open task with a deadline, soonest first (fork feature).
 *
 * The page for assessments and exams: what is already late, what is due this
 * week, what is coming in the next few weeks and what is further out. Each row
 * says which project it belongs to and counts down to its deadline. Subtasks
 * with a deadline of their own are listed too, on their own line, since the
 * deadline is what this page is about.
 */
// Listed flat: a subtask here stands for its own deadline, not under its parent.
const noChildren = (): Item[] => [];

export function DeadlinesView({ onOpen }: { onOpen: (id: string) => void }) {
  const { t } = useT();
  const today = useToday();
  const { items } = useData('deadlines');
  const weekStartsOn = useStore((s) => s.snapshot.user?.start_day);
  const listCards = useStore((s) => s.prefs.listCards);
  const groups = useMemo(
    () => groupByDeadline(items, today, weekStartsOn),
    [items, today, weekStartsOn],
  );
  const all = useMemo(() => groups.flatMap((group) => group.items), [groups]);
  const load = useMemo(() => summariseLoad(all, noChildren, null), [all]);

  return (
    <SubtasksProvider value={false}>
      <div className={`page narrow deadlines-page${listCards ? ' cards' : ''}`}>
        <PageHeader title={t('nav.deadlines')} load={load} />
        {all.length === 0 && <p className="empty">{t('deadline.none')}</p>}
        <div className="mode">
          {groups.map((group) => (
            <TaskGroup
              key={group.key}
              title={t(`deadline.group.${group.key}` as TranslationKey)}
              items={group.items}
              childrenOf={noChildren}
              onOpen={onOpen}
              showProject
              accent={group.key === 'overdue' ? 'late' : undefined}
              draggable={false}
            />
          ))}
        </div>
      </div>
    </SubtasksProvider>
  );
}
