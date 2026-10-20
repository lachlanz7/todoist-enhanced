import { addDays, differenceInCalendarDays, format, parseISO, startOfDay } from 'date-fns';
import { dueForDate } from './recurrence';
import { deadlineOf, type DeadlineSettings } from './deadlines';
import type { Item, TodoistDue, TodoistPriority } from './types';

/**
 * Rolling unfinished tasks forward (fork feature).
 *
 * A task whose day has passed and is not done moves to today, keeping its time
 * of day, and keeps moving each day until it is ticked off — but never past
 * its deadline. Once the deadline is reached the task stays on it and shows as
 * late instead, which is the signal that matters.
 *
 * This file only decides; it sends nothing. The app applies the answer through
 * its ordinary queue (hooks/useDeadlineRollover) and the scheduled GitHub
 * Action through the same Sync commands (scripts/rollover.ts). Both read the
 * same decision, and the decision is a function of the tasks and the date
 * alone, so running it twice, or on two devices at once, asks for the same
 * thing: a task already on today is left alone.
 *
 * A repeating task is never touched. Its date is its rule's business, and the
 * one way to move it without ending the series (keeping `due.string`) would
 * still hide the missed occurrence; Todoist's own overdue state is clearer.
 */

export type RolloverReason = 'rolled' | 'capped' | 'escalated';

export interface RolloverChange {
  id: string;
  /** The new due, when the date moves. */
  due?: TodoistDue;
  /** P1 in Todoist's inverted numbering, when the task is escalated. */
  priority?: TodoistPriority;
  reason: RolloverReason;
  /** The day it moved from and to, for the summary. */
  from?: string;
  to?: string;
}

const dayOf = (value: string): Date => startOfDay(parseISO(value.slice(0, 10)));

/** The local calendar day a due falls on. A UTC time is read in local time. */
function dueDay(due: TodoistDue): Date {
  return due.date.includes('T') && /(?:Z|[+-]\d{2}:?\d{2})$/.test(due.date)
    ? startOfDay(parseISO(due.date))
    : dayOf(due.date);
}

/**
 * The due moved to another day, the time of day kept.
 *
 * A floating time ("09:00 wherever I am") keeps its text. A time pinned to a
 * zone is stored in UTC, whose date can be the day before the local one: it is
 * moved by whole local days, so 09:00 in Sydney stays 09:00 in Sydney, and
 * written back in UTC with its zone.
 */
export function rolledDue(due: TodoistDue, day: Date): TodoistDue {
  const pinned = due.date.includes('T') && /(?:Z|[+-]\d{2}:?\d{2})$/.test(due.date);
  if (!pinned) return { ...dueForDate(due, format(day, 'yyyy-MM-dd')), is_recurring: false };
  const at = parseISO(due.date);
  const moved = addDays(at, differenceInCalendarDays(day, startOfDay(at)));
  const iso = moved.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { date: iso, timezone: due.timezone, string: iso, lang: due.lang, is_recurring: false };
}

/** Todoist's number for P1. */
const P1: TodoistPriority = 4;

/**
 * What should change, for the open tasks given, on the day `now` falls on.
 *
 * - done, deleted, projected or repeating tasks, and tasks in an excluded
 *   project, are left alone;
 * - a task without a deadline rolls only when `rollUndated` is on;
 * - a task rolls to today, or to its deadline when that is earlier, and never
 *   backwards: one already on or past its deadline stays where it is;
 * - with `escalate`, a task whose deadline is today or past becomes P1.
 */
export function planRollover(
  items: readonly Item[],
  settings: Pick<DeadlineSettings, 'rollover' | 'rollUndated' | 'excludedProjects' | 'escalate'>,
  now = new Date(),
): RolloverChange[] {
  const today = startOfDay(now);
  const excluded = new Set(settings.excludedProjects);
  const changes: RolloverChange[] = [];

  for (const item of items) {
    if (item.checked || item.is_deleted || item.projection) continue;
    if (excluded.has(item.project_id)) continue;
    const found = deadlineOf(item);
    const deadline = found ? dayOf(found.date) : null;

    let change: RolloverChange | null = null;
    if (settings.rollover && item.due && !item.due.is_recurring && (deadline || settings.rollUndated)) {
      const from = dueDay(item.due);
      const target = deadline && deadline < today ? deadline : today;
      if (from < target) {
        change = {
          id: item.id,
          due: rolledDue(item.due, target),
          reason: target < today ? 'capped' : 'rolled',
          from: format(from, 'yyyy-MM-dd'),
          to: format(target, 'yyyy-MM-dd'),
        };
      }
    }

    if (settings.escalate && deadline && deadline <= today && item.priority !== P1) {
      change = change ? { ...change, priority: P1 } : { id: item.id, priority: P1, reason: 'escalated' };
    }
    if (change) changes.push(change);
  }
  return changes;
}
