import { describe, expect, it } from 'vitest';
import { format, parseISO } from 'date-fns';
import { planRollover, rolledDue } from './rollover';
import { defaultDeadlineSettings } from './deadlines';
import { due, item } from '@/test/items';
import type { Item } from './types';

/* Every date here is built from local parts, so the expectations hold in any
   time zone the tests run in (CI runs in UTC; run with TZ=Australia/Sydney or
   TZ=America/Los_Angeles to check the day boundaries by hand). */
const now = new Date(2026, 9, 20, 10, 0); // Tuesday 20 October 2026, 10:00 local
const settings = defaultDeadlineSettings();
const withDeadline = (date: string, overrides: Partial<Item> = {}) =>
  item({ description: `Deadline: ${date}`, ...overrides });

describe('which tasks roll', () => {
  it('moves a late task with a deadline to today', () => {
    const changes = planRollover([withDeadline('2026-10-30', { due: due('2026-10-17') })], settings, now);
    expect(changes).toEqual([{
      id: 'task', reason: 'rolled', from: '2026-10-17', to: '2026-10-20',
      due: { date: '2026-10-20', timezone: null, string: '2026-10-20', lang: 'en', is_recurring: false },
    }]);
  });

  it('leaves tasks on today or later, and undated ones, alone', () => {
    expect(planRollover([
      withDeadline('2026-10-30', { due: due('2026-10-20') }),
      withDeadline('2026-10-30', { due: due('2026-10-22') }),
      withDeadline('2026-10-30', { due: null }),
    ], settings, now)).toEqual([]);
  });

  it('never touches a repeating task', () => {
    const repeating = withDeadline('2026-10-30', {
      due: due('2026-10-17', { string: 'every sat', is_recurring: true }),
    });
    expect(planRollover([repeating], settings, now)).toEqual([]);
  });

  it('leaves done, deleted and projected tasks alone', () => {
    const late = { due: due('2026-10-17') };
    expect(planRollover([
      withDeadline('2026-10-30', { ...late, checked: true }),
      withDeadline('2026-10-30', { ...late, is_deleted: true }),
      withDeadline('2026-10-30', { ...late, projection: { sourceId: 'x', date: '2026-10-17' } }),
    ], settings, now)).toEqual([]);
  });

  it('rolls a task without a deadline only when asked to', () => {
    const plain = item({ due: due('2026-10-17') });
    expect(planRollover([plain], settings, now)).toEqual([]);
    expect(planRollover([plain], { ...settings, rollUndated: true }, now)).toHaveLength(1);
  });

  it('skips excluded projects and does nothing when switched off', () => {
    const late = withDeadline('2026-10-30', { due: due('2026-10-17'), project_id: 'work' });
    expect(planRollover([late], { ...settings, excludedProjects: ['work'] }, now)).toEqual([]);
    expect(planRollover([late], { ...settings, rollover: false }, now)).toEqual([]);
  });

  it('reads Todoist\'s own deadline as well as the description line', () => {
    const native = item({ due: due('2026-10-17'), deadline: { date: '2026-10-30', lang: 'en' } });
    expect(planRollover([native], settings, now)[0]?.to).toBe('2026-10-20');
  });
});

describe('the deadline is a ceiling', () => {
  it('stops at the deadline when it has already passed', () => {
    const changes = planRollover([withDeadline('2026-10-18', { due: due('2026-10-15') })], settings, now);
    expect(changes[0]).toMatchObject({ reason: 'capped', from: '2026-10-15', to: '2026-10-18' });
  });

  it('moves to a deadline that is today', () => {
    expect(planRollover([withDeadline('2026-10-20', { due: due('2026-10-15') })], settings, now)[0])
      .toMatchObject({ reason: 'rolled', to: '2026-10-20' });
  });

  it('leaves a task already on its deadline, or past it, where it is', () => {
    expect(planRollover([
      withDeadline('2026-10-18', { due: due('2026-10-18') }),
      withDeadline('2026-10-16', { due: due('2026-10-18') }),
    ], settings, now)).toEqual([]);
  });
});

describe('idempotence', () => {
  it('asks for nothing once its own answer is applied', () => {
    const tasks = [
      withDeadline('2026-10-30', { id: 'a', due: due('2026-10-17T09:30:00') }),
      withDeadline('2026-10-18', { id: 'b', due: due('2026-10-12') }),
      item({ id: 'c', due: due('2026-10-01') }),
    ];
    const opts = { ...settings, rollUndated: true, escalate: true };
    const first = planRollover(tasks, opts, now);
    expect(first.map((c) => c.id)).toEqual(['a', 'b', 'c']);
    const applied = tasks.map((task) => {
      const change = first.find((c) => c.id === task.id);
      return change ? { ...task, ...(change.due ? { due: change.due } : {}), ...(change.priority ? { priority: change.priority } : {}) } : task;
    });
    expect(planRollover(applied, opts, now)).toEqual([]);
    // Later the same day, still nothing.
    expect(planRollover(applied, opts, new Date(2026, 9, 20, 23, 59))).toEqual([]);
  });

  it('rolls again the next day, up to the deadline and no further', () => {
    const task = withDeadline('2026-10-21', { due: due('2026-10-20T08:00:00') });
    const tomorrow = planRollover([task], settings, new Date(2026, 9, 21, 0, 0, 1));
    expect(tomorrow[0]?.due?.date).toBe('2026-10-21T08:00:00');
    const after = { ...task, due: tomorrow[0].due! };
    expect(planRollover([after], settings, new Date(2026, 9, 25, 12))).toEqual([]);
  });
});

describe('the time of day', () => {
  it('keeps a floating time', () => {
    const [change] = planRollover([withDeadline('2026-10-30', { due: due('2026-10-17T14:45:00') })], settings, now);
    expect(change.due).toMatchObject({ date: '2026-10-20T14:45:00', string: '2026-10-20T14:45:00', is_recurring: false });
  });

  it('keeps the local time of a time pinned to a zone', () => {
    // 07:15 local on the 17th, written in UTC as Todoist sends it.
    const local = new Date(2026, 9, 17, 7, 15);
    const utc = local.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const [change] = planRollover(
      [withDeadline('2026-10-30', { due: due(utc, { timezone: 'Australia/Sydney' }) })], settings, now,
    );
    const moved = parseISO(change.due!.date);
    expect(format(moved, 'yyyy-MM-dd HH:mm')).toBe('2026-10-20 07:15');
    expect(change.due!.date.endsWith('Z')).toBe(true);
    expect(change.due!.timezone).toBe('Australia/Sydney');
  });

  it('keeps the local time across a change of clocks', () => {
    // Sydney moves its clocks on 4 Oct 2026, Los Angeles on 1 Nov 2026.
    for (const [from, to] of [[new Date(2026, 9, 3, 9), new Date(2026, 9, 5, 12)], [new Date(2026, 9, 31, 9), new Date(2026, 10, 2, 12)]]) {
      const utc = from.toISOString().replace(/\.\d{3}Z$/, 'Z');
      const [change] = planRollover([withDeadline('2026-12-01', { due: due(utc, { timezone: 'X' }) })], settings, to);
      expect(format(parseISO(change.due!.date), 'HH:mm')).toBe('09:00');
    }
  });

  it('reads the day of a pinned time locally, not from its UTC date', () => {
    // 23:30 local on the 19th is late. Today, at 00:30 local, is not.
    const lateLast = new Date(2026, 9, 19, 23, 30).toISOString();
    const earlyToday = new Date(2026, 9, 20, 0, 30).toISOString();
    const tasks = [
      withDeadline('2026-10-30', { id: 'late', due: due(lateLast, { timezone: 'X' }) }),
      withDeadline('2026-10-30', { id: 'today', due: due(earlyToday, { timezone: 'X' }) }),
    ];
    expect(planRollover(tasks, settings, now).map((c) => c.id)).toEqual(['late']);
  });

  it('treats a late time earlier today as today, not as late', () => {
    expect(planRollover([withDeadline('2026-10-30', { due: due('2026-10-20T07:00:00') })], settings, now)).toEqual([]);
  });

  it('turns the due of a moved task into a one-off, never a rule', () => {
    expect(rolledDue(due('2026-10-17'), new Date(2026, 9, 20)).is_recurring).toBe(false);
  });
});

describe('escalation', () => {
  it('raises a task to P1 once its deadline is today or past, if asked', () => {
    const opts = { ...settings, escalate: true };
    const tasks = [
      withDeadline('2026-10-20', { id: 'today' }),
      withDeadline('2026-10-19', { id: 'past', priority: 2 }),
      withDeadline('2026-10-21', { id: 'tomorrow' }),
      withDeadline('2026-10-19', { id: 'already', priority: 4 }),
    ];
    expect(planRollover(tasks, opts, now)).toEqual([
      { id: 'today', priority: 4, reason: 'escalated' },
      { id: 'past', priority: 4, reason: 'escalated' },
    ]);
    expect(planRollover(tasks, settings, now)).toEqual([]);
  });

  it('escalates and caps in one change', () => {
    const [change] = planRollover([withDeadline('2026-10-18', { due: due('2026-10-15') })], { ...settings, escalate: true }, now);
    expect(change).toMatchObject({ reason: 'capped', to: '2026-10-18', priority: 4 });
  });
});
