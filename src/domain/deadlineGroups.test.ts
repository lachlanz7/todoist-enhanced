import { describe, expect, it } from 'vitest';
import { groupByDeadline } from './deadlineGroups';
import { due, item } from '@/test/items';

describe('the Deadlines page', () => {
  // Tuesday 20 October 2026; weeks start on Monday (Todoist's start_day 1).
  const today = new Date(2026, 9, 20, 15);
  const task = (id: string, deadline: string, extra = {}) =>
    item({ id, description: `Deadline: ${deadline}`, ...extra });

  it('groups by how soon the deadline is, soonest first', () => {
    const groups = groupByDeadline([
      task('later', '2026-11-20'),
      task('next', '2026-10-27'),
      task('sunday', '2026-10-25'),
      task('today', '2026-10-20'),
      task('late', '2026-10-19'),
      item({ id: 'none' }),
      task('done', '2026-10-21', { checked: true }),
    ], today, 1);
    expect(groups.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([
      ['overdue', ['late']],
      ['thisWeek', ['today', 'sunday']],
      ['nextWeek', ['next']],
      ['later', ['later']],
    ]);
  });

  it('follows the week start and breaks ties by date', () => {
    const groups = groupByDeadline([
      task('b', '2026-10-25', { due: due('2026-10-23') }),
      task('a', '2026-10-25', { due: due('2026-10-21') }),
    ], today, 7);
    // Weeks starting on Sunday: Sunday the 25th is next week.
    expect(groups.map((g) => [g.key, g.items.map((i) => i.id)])).toEqual([['nextWeek', ['a', 'b']]]);
  });

  it('reads Todoist\'s own deadline too', () => {
    const groups = groupByDeadline([item({ id: 'n', deadline: { date: '2026-10-22', lang: 'en' } })], today, 1);
    expect(groups[0]).toMatchObject({ key: 'thisWeek' });
  });
});
