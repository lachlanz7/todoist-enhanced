import { addWeeks, endOfWeek, parseISO, startOfDay } from 'date-fns';
import { deadlineDay } from './deadlines';
import { weekStartsOnOf } from './dates';
import type { Item } from './types';

/** The groups of the Deadlines page, in the order they are drawn (fork feature). */
export const DEADLINE_GROUPS = ['overdue', 'thisWeek', 'nextWeek', 'later'] as const;
export type DeadlineGroupKey = (typeof DEADLINE_GROUPS)[number];

/**
 * Open tasks with a deadline, by how soon it is: already passed, this week
 * (today included), next week, and later. Soonest deadline first in each, then
 * by date, then in Todoist's order. Empty groups are left out.
 *
 * `startDay` is Todoist's own (1 = Monday … 7 = Sunday), so "this week" ends
 * where the rest of the app says it does.
 */
export function groupByDeadline(
  items: readonly Item[], today: Date, startDay?: number,
): Array<{ key: DeadlineGroupKey; items: Item[] }> {
  const day = startOfDay(today);
  const weekStartsOn = weekStartsOnOf(startDay);
  const thisWeekEnd = endOfWeek(day, { weekStartsOn });
  const nextWeekEnd = endOfWeek(addWeeks(day, 1), { weekStartsOn });

  const dated = items
    .filter((item) => !item.checked && !item.is_deleted && !item.projection)
    .map((item) => ({ item, deadline: deadlineDay(item) }))
    .filter((entry): entry is { item: Item; deadline: string } => entry.deadline !== null)
    .sort((a, b) => a.deadline.localeCompare(b.deadline)
      || (a.item.due?.date ?? '9999').localeCompare(b.item.due?.date ?? '9999')
      || a.item.child_order - b.item.child_order);

  const buckets = new Map<DeadlineGroupKey, Item[]>(DEADLINE_GROUPS.map((key) => [key, []]));
  for (const { item, deadline } of dated) {
    const at = parseISO(deadline);
    const key: DeadlineGroupKey = at < day ? 'overdue'
      : at <= thisWeekEnd ? 'thisWeek'
        : at <= nextWeekEnd ? 'nextWeek' : 'later';
    buckets.get(key)!.push(item);
  }
  return DEADLINE_GROUPS
    .map((key) => ({ key, items: buckets.get(key)! }))
    .filter((group) => group.items.length > 0);
}
