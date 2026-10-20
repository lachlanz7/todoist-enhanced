import { Icon } from './Icon';
import { DateField } from './DateField';
import { EstimateField } from './EstimateField';
import { MultiSelect } from './MultiSelect';
import { Select } from './Select';
import { useStore } from '@/store/store';
import { useT } from '@/hooks/useT';
import { effectiveEstimate, formatDuration } from '@/domain/estimates';
import { dateTone, isOverdue } from '@/domain/dates';
import { deadlineDay } from '@/domain/deadlines';
import { toDisplayPriority, toTodoistPriority, type Item, type TableColumn, type DisplayPriority } from '@/domain/types';
import { tableColumnLabel } from '@/domain/table';
import { markerStyle } from '@/domain/colors';

/** Inline values use the same controls and store commands as task details. */
export function TableCells({ item, columns, childrenOf }: { item: Item; columns: TableColumn[]; childrenOf: (id: string) => Item[] }) {
  const { t, locale } = useT();
  const snapshot = useStore((s) => s.snapshot);
  const updateTask = useStore((s) => s.updateTask);
  const setEstimates = useStore((s) => s.setEstimates);
  const setTaskLabels = useStore((s) => s.setTaskLabels);
  const setRecurrence = useStore((s) => s.setRecurrence);
  const { minutes, computed } = effectiveEstimate(item, childrenOf);
  return <>{columns.filter((column) => column !== 'title').map((column) => {
    let content;
    if (column === 'date' || column === 'deadline') {
      const due = column === 'date';
      content = <DateField value={(due ? item.due?.date : deadlineDay(item)) ?? ''}
        label={t(tableColumnLabel[column])} withTime={due}
        recurrence={due && item.due?.is_recurring ? { string: item.due.string, lang: item.due.lang } : null}
        onRecurrence={due ? (rule) => void setRecurrence(item.id, rule) : undefined}
        onClearRecurrence={due ? () => void updateTask(item.id, { due: item.due ? { ...item.due, is_recurring: false, string: item.due.date } : null }) : undefined}
        onChange={(date) => void updateTask(item.id, due ? {
          due: date ? { date, timezone: item.due?.timezone ?? null, string: item.due?.is_recurring ? item.due.string : date,
            lang: item.due?.lang ?? 'en', is_recurring: item.due?.is_recurring ?? false } : null,
        } : { deadline: date ? { date, lang: 'en' } : null })} />;
    } else if (column === 'priority') content = <Select ariaLabel={t('detail.priority')} value={String(toDisplayPriority(item.priority))}
      options={[1, 2, 3, 4].map((priority) => ({ value: String(priority), label: `P${priority}`,
        visual: <span className={`table-priority-mark p${priority}`}><Icon name="flag" size="sm" /></span> }))}
      onChange={(value) => void updateTask(item.id, { priority: toTodoistPriority(Number(value) as DisplayPriority) })} />;
    else if (column === 'estimate') content = computed ? <span>{formatDuration(minutes ?? 0, locale)} *</span>
      : <EstimateField minutes={minutes} onCommit={async (value) => { await setEstimates([{ id: item.id, minutes: value }]); }} />;
    else if (column === 'labels') content = <MultiSelect label={t('detail.labels')} value={item.labels.filter((label) => !label.startsWith('est-'))}
      face={item.labels.some((label) => !label.startsWith('est-'))
        ? <span className="cell-tags">{(() => {
          const names = item.labels.filter((label) => !label.startsWith('est-'));
          return <>{names.slice(0, 2).map((label) => <span className="tag" key={label}
            style={markerStyle(Object.values(snapshot.labels).find((entry) => entry.name === label)?.color)}><Icon name="tag" size="sm" />{label}</span>)}
          {names.length > 2 && <span className="tag-more">+{names.length - 2}</span>}</>;
        })()}</span>
        : <span className="cell-tags is-none"><Icon name="plus" size="sm" /></span>}
      options={Object.values(snapshot.labels).filter((label) => !label.is_deleted && !label.name.startsWith('est-')).map((label) => ({ value: label.name, label: label.name }))}
      onChange={(labels) => void setTaskLabels(item.id, [...item.labels.filter((label) => label.startsWith('est-')),
        ...(labels ?? Object.values(snapshot.labels).filter((label) => !label.is_deleted && !label.name.startsWith('est-')).map((label) => label.name))])} />;
    else if (column === 'project') content = snapshot.projects[item.project_id]?.name ?? '';
    else content = item.description;
    return <div key={column} className={`table-cell table-${column}${column === 'date' ? ` tone-${isOverdue(item) ? 'late' : dateTone(item) ?? 'later'}` : ''}`}
      onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>{content}</div>;
  })}</>;
}
