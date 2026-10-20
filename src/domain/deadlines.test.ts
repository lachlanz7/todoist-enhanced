import { describe, expect, it } from 'vitest';
import {
  deadlineFields, deadlineOf, deadlineStatus, deadlineStorage, descriptionDeadline, isIsoDay,
  joinDeadlineTail, readDeadlineSettings, routeDeadline, splitDeadlineTail,
  withDeadlineLine,
} from './deadlines';
import { readDeadlineToken } from './deadlineToken';
import { item } from '@/test/items';

describe('reading a deadline line', () => {
  it('reads the line in any case and with loose spacing', () => {
    expect(descriptionDeadline('Deadline: 2026-11-02')).toBe('2026-11-02');
    expect(descriptionDeadline('notes\n\n  deadline :2026-11-02  ')).toBe('2026-11-02');
    expect(descriptionDeadline('DEADLINE: 2026-11-02\r\nmore')).toBe('2026-11-02');
  });

  it('ignores prose, impossible days and other formats', () => {
    expect(descriptionDeadline('The deadline: 2026-11-02 is close')).toBeNull();
    expect(descriptionDeadline('Deadline: 2026-02-30')).toBeNull();
    expect(descriptionDeadline('Deadline: 2/11/2026')).toBeNull();
    expect(descriptionDeadline('')).toBeNull();
    expect(isIsoDay('2028-02-29')).toBe(true);
    expect(isIsoDay('2027-02-29')).toBe(false);
  });

  it('takes the last of several lines', () => {
    expect(descriptionDeadline('Deadline: 2026-11-02\nDeadline: 2026-11-09')).toBe('2026-11-09');
  });

  it('prefers Todoist\'s own field over the description', () => {
    expect(deadlineOf(item({ deadline: { date: '2026-12-01', lang: 'en' }, description: 'Deadline: 2026-11-02' })))
      .toEqual({ date: '2026-12-01', source: 'native' });
    expect(deadlineOf(item({ description: 'Deadline: 2026-11-02' })))
      .toEqual({ date: '2026-11-02', source: 'description' });
    expect(deadlineOf(item())).toBeNull();
  });
});

describe('writing a deadline line', () => {
  it('adds the line after a blank line, or alone', () => {
    expect(withDeadlineLine('Read chapter 4', '2026-11-02')).toBe('Read chapter 4\n\nDeadline: 2026-11-02');
    expect(withDeadlineLine('', '2026-11-02')).toBe('Deadline: 2026-11-02');
    expect(withDeadlineLine('Notes\n\n', '2026-11-02')).toBe('Notes\n\nDeadline: 2026-11-02');
  });

  it('replaces an existing line wherever it is, and keeps one only', () => {
    expect(withDeadlineLine('Deadline: 2026-10-01\n- [ ] draft\n- [x] outline', '2026-11-02'))
      .toBe('- [ ] draft\n- [x] outline\n\nDeadline: 2026-11-02');
  });

  it('removes the line and the blank lines it leaves at the end', () => {
    expect(withDeadlineLine('Notes\n\nDeadline: 2026-11-02', null)).toBe('Notes');
    expect(withDeadlineLine('Deadline: 2026-11-02', null)).toBe('');
  });

  it('leaves a description without a line exactly as it was when clearing', () => {
    expect(withDeadlineLine('Notes  \n\n', null)).toBe('Notes  \n\n');
  });

  it('round-trips: what is written is read back', () => {
    const written = withDeadlineLine('- [ ] item', '2026-11-02');
    expect(descriptionDeadline(written)).toBe('2026-11-02');
    expect(withDeadlineLine(written, '2026-11-02')).toBe(written);
  });
});

describe('hiding the trailing line', () => {
  it('splits it off exactly, so body + tail is the original', () => {
    const text = 'Notes\r\n- [ ] one\r\n\r\nDeadline: 2026-11-02\n';
    const { body, tail } = splitDeadlineTail(text);
    expect(body).toBe('Notes\r\n- [ ] one');
    expect(body + tail).toBe(text);
  });

  it('leaves a line in the middle visible', () => {
    expect(splitDeadlineTail('Deadline: 2026-11-02\nmore').tail).toBe('');
    expect(splitDeadlineTail('Deadline: 2026-11-02')).toEqual({ body: '', tail: 'Deadline: 2026-11-02' });
  });

  it('puts the tail back after an edit', () => {
    expect(joinDeadlineTail('Edited', '\n\nDeadline: 2026-11-02')).toBe('Edited\n\nDeadline: 2026-11-02');
    expect(joinDeadlineTail('', 'Deadline: 2026-11-02')).toBe('Deadline: 2026-11-02');
    expect(joinDeadlineTail('Typed into empty', 'Deadline: 2026-11-02')).toBe('Typed into empty\n\nDeadline: 2026-11-02');
    expect(joinDeadlineTail('No tail', '')).toBe('No tail');
  });
});

describe('where a deadline is written', () => {
  it('auto uses the description unless the account says it is paid', () => {
    expect(deadlineStorage({ storage: 'auto' }, { is_premium: false })).toBe('description');
    expect(deadlineStorage({ storage: 'auto' }, { premium_status: 'not_premium', is_premium: true })).toBe('description');
    expect(deadlineStorage({ storage: 'auto' }, null)).toBe('description');
    expect(deadlineStorage({ storage: 'auto' }, { is_premium: true })).toBe('native');
    expect(deadlineStorage({ storage: 'auto' }, { premium_status: 'current_personal_plan' })).toBe('native');
    expect(deadlineStorage({ storage: 'description' }, { is_premium: true })).toBe('description');
  });

  it('writes the description on Free and clears a native one', () => {
    expect(deadlineFields(item({ description: 'x' }), '2026-11-02', 'description'))
      .toEqual({ description: 'x\n\nDeadline: 2026-11-02' });
    expect(deadlineFields(item({ deadline: { date: '2026-10-01', lang: 'en' } }), '2026-11-02', 'description'))
      .toEqual({ description: 'Deadline: 2026-11-02', deadline: null });
    expect(deadlineFields(item({ description: 'x\n\nDeadline: 2026-11-02' }), null, 'description'))
      .toEqual({ description: 'x' });
  });

  it('writes the native field on a paid plan and removes the line', () => {
    expect(deadlineFields(item({ description: 'x\n\nDeadline: 2026-10-01' }), '2026-11-02', 'native', 'fr'))
      .toEqual({ deadline: { date: '2026-11-02', lang: 'fr' }, description: 'x' });
    expect(deadlineFields(item(), null, 'native')).toEqual({ deadline: null });
  });

  it('routes a deadline among other fields, on top of a description sent with it', () => {
    const fields = routeDeadline(item({ description: 'old' }),
      { content: 'Essay', description: 'new', deadline: { date: '2026-11-02', lang: 'en' } }, 'description');
    expect(fields).toEqual({ content: 'Essay', description: 'new\n\nDeadline: 2026-11-02' });
    const untouched = { content: 'Essay' };
    expect(routeDeadline(item(), untouched, 'description')).toBe(untouched);
    expect(routeDeadline(item(), { deadline: undefined }, 'description')).toEqual({ deadline: undefined });
  });
});

describe('how close a deadline is', () => {
  const now = new Date(2026, 9, 20, 23, 30);
  const at = (date: string) => deadlineStatus(item({ description: `Deadline: ${date}` }), now, 3);

  it('counts calendar days, not hours', () => {
    expect(at('2026-10-21')).toEqual({ date: '2026-10-21', days: 1, tone: 'soon' });
    expect(at('2026-10-20')?.tone).toBe('today');
    expect(at('2026-10-19')).toEqual({ date: '2026-10-19', days: -1, tone: 'overdue' });
    expect(at('2026-10-23')?.tone).toBe('soon');
    expect(at('2026-10-24')?.tone).toBe('later');
    expect(deadlineStatus(item(), now)).toBeNull();
  });
});

describe('settings', () => {
  it('fills anything missing or malformed with its default', () => {
    expect(readDeadlineSettings(undefined)).toEqual({
      storage: 'auto', rollover: true, rollUndated: false, excludedProjects: [], soonDays: 3, escalate: false,
    });
    expect(readDeadlineSettings({ storage: 'nope', rollover: false, excludedProjects: ['a', 3], soonDays: 99 }))
      .toMatchObject({ storage: 'auto', rollover: false, excludedProjects: ['a'], soonDays: 3 });
  });
});

describe('typing a deadline in braces', () => {
  const now = new Date(2026, 9, 20, 10);

  it('reads an ISO day, a month and day, or a weekday', () => {
    expect(readDeadlineToken('Essay {2026-11-02}', now)).toEqual({ start: 6, length: 12, date: '2026-11-02' });
    expect(readDeadlineToken('Essay {Nov 2}', now)?.date).toBe('2026-11-02');
    expect(readDeadlineToken('Essay {tomorrow}', now)?.date).toBe('2026-10-21');
  });

  it('leaves braces that do not hold only a date', () => {
    expect(readDeadlineToken('Essay {draft}', now)).toBeNull();
    expect(readDeadlineToken('Essay {draft tomorrow}', now)).toBeNull();
    expect(readDeadlineToken('Essay', now)).toBeNull();
  });
});

describe('a multi-line description ending in the deadline line', () => {
  const text = 'Week 9 tutorial\nTopics: Fourier series\nDeadline: 2026-10-25';
  it('reads it, hides it, and shows the topic lines', () => {
    expect(descriptionDeadline(text)).toBe('2026-10-25');
    expect(splitDeadlineTail(text)).toEqual({ body: 'Week 9 tutorial\nTopics: Fourier series', tail: '\nDeadline: 2026-10-25' });
  });
  it('keeps the topic lines when the deadline changes', () => {
    expect(withDeadlineLine(text, '2026-11-01')).toBe('Week 9 tutorial\nTopics: Fourier series\n\nDeadline: 2026-11-01');
  });
});
