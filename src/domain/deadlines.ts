import { differenceInCalendarDays, format, isValid, parseISO, startOfDay } from 'date-fns';
import { readNaturalDate } from './nlp';
import type { DateFormat } from './dates';
import type { Item, TodoistUser } from './types';

/**
 * Deadlines that work on every Todoist plan (fork feature).
 *
 * Todoist's own deadline field is a paid feature: on a Free account it is
 * refused. A deadline is a single calendar day, so it can just as well live in
 * the task as text, the way a checklist does (domain/checklist): a line of the
 * description that reads
 *
 *     Deadline: 2026-11-02
 *
 * Why a description line rather than a label or a comment:
 *  - a label per date would fill the account's label list with one-off tags;
 *  - a comment is a separate object, fetched separately, and noisy to edit;
 *  - the description travels with the task through every sync and every
 *    Todoist client, reads plainly in the official apps, and can be typed or
 *    corrected by hand anywhere. ISO dates sort and parse the same in every
 *    language.
 *
 * Every reader in the app goes through `deadlineOf`, which prefers Todoist's
 * native field when there is one, so the two kinds can coexist on a paid
 * account. The line is written last in the description, after a blank line,
 * and the app hides it there — the detail panel shows the deadline as a field
 * instead. A line typed anywhere else is still read, and simply stays visible.
 */

/** A deadline line, on its own: `Deadline: 2026-11-02`, any case, spaces allowed. */
const LINE = /^[ \t]*deadline[ \t]*:[ \t]*(\d{4}-\d{2}-\d{2})[ \t]*$/i;
/** The same line as the very end of a description, with the blank lines before it. */
const TAIL = /(?:^|\r\n|\n|\r)(?:[ \t]*(?:\r\n|\n|\r))*[ \t]*deadline[ \t]*:[ \t]*(\d{4}-\d{2}-\d{2})[ \t]*\s*$/i;

/** True for a real calendar day written `yyyy-MM-dd`: 2026-02-30 is not one. */
export function isIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = parseISO(value);
  return isValid(parsed) && format(parsed, 'yyyy-MM-dd') === value;
}

/** The line written for a deadline. */
export const deadlineLine = (date: string): string => `Deadline: ${date}`;

/** The deadline a description carries: its last valid deadline line, or null. */
export function descriptionDeadline(description: string | null | undefined): string | null {
  if (!description) return null;
  let found: string | null = null;
  for (const line of description.split(/\r\n|\n|\r/)) {
    const match = LINE.exec(line);
    if (match && isIsoDay(match[1])) found = match[1];
  }
  return found;
}

/**
 * The description as shown, and the deadline line it ends with.
 *
 * `body + tail` is exactly the description that was read, byte for byte, so
 * hiding the tail never changes what is saved. Only a trailing line is split
 * off: the lines above it keep their numbers, which is what a checklist tick
 * relies on.
 */
export function splitDeadlineTail(description: string): { body: string; tail: string } {
  const match = TAIL.exec(description);
  if (!match || !isIsoDay(match[1])) return { body: description, tail: '' };
  return { body: description.slice(0, match.index), tail: description.slice(match.index) };
}

/** A description edited without its hidden tail, with the tail put back. */
export function joinDeadlineTail(body: string, tail: string): string {
  if (!tail) return body;
  const line = tail.trim();
  const text = body.trimEnd();
  return text ? `${text}\n\n${line}` : line;
}

/**
 * The description with its deadline set to `date`, or taken out for null.
 *
 * Every deadline line goes, wherever it was, and one is written at the end;
 * the rest of the text is left as it was apart from blank lines at its end.
 */
export function withDeadlineLine(description: string, date: string | null): string {
  const kept = description
    .split(/(\r\n|\n|\r)/)
    .reduce<string[]>((out, part, at, parts) => {
      // Lines sit at even positions, each followed by its own line ending.
      if (at % 2 === 1) return out;
      const match = LINE.exec(part);
      if (match && isIsoDay(match[1])) return out;
      out.push(part + (parts[at + 1] ?? ''));
      return out;
    }, [])
    .join('');
  // Nothing to take out and nothing to add: the text stays exactly as it was.
  if (!date) return kept === description ? description : kept.trimEnd();
  const base = kept.trimEnd();
  return base ? `${base}\n\n${deadlineLine(date)}` : deadlineLine(date);
}

/** Where a task's deadline comes from. */
export type DeadlineSource = 'native' | 'description';

/** A task's deadline as `yyyy-MM-dd`, from Todoist's field first, then from its description. */
export function deadlineOf(item: Pick<Item, 'deadline' | 'description'>): { date: string; source: DeadlineSource } | null {
  if (item.deadline?.date) return { date: item.deadline.date.slice(0, 10), source: 'native' };
  const date = descriptionDeadline(item.description);
  return date ? { date, source: 'description' } : null;
}

/** Just the day, for sorting and display. */
export const deadlineDay = (item: Pick<Item, 'deadline' | 'description'>): string | null =>
  deadlineOf(item)?.date ?? null;

/* ---------- How close it is ---------- */

/** overdue: the day has passed; today; soon: within the warning window; later. */
export type DeadlineTone = 'overdue' | 'today' | 'soon' | 'later';

export interface DeadlineStatus {
  date: string;
  /** Calendar days from today to the deadline: negative once it has passed. */
  days: number;
  tone: DeadlineTone;
}

export function deadlineStatus(
  item: Pick<Item, 'deadline' | 'description'>, now = new Date(), soonDays = 3,
): DeadlineStatus | null {
  const found = deadlineOf(item);
  if (!found) return null;
  const days = differenceInCalendarDays(startOfDay(parseISO(found.date)), startOfDay(now));
  const tone: DeadlineTone = days < 0 ? 'overdue' : days === 0 ? 'today' : days <= soonDays ? 'soon' : 'later';
  return { date: found.date, days, tone };
}

/* ---------- Settings ---------- */

export const DEADLINE_STORAGES = ['auto', 'native', 'description'] as const;
export type DeadlineStorageChoice = (typeof DEADLINE_STORAGES)[number];

/** Kept with the account's other settings (the Inbox comment), so every device agrees. */
export interface DeadlineSettings {
  /** auto: Todoist's field on a paid plan, the description on Free. */
  storage: DeadlineStorageChoice;
  /** Moves an unfinished task whose date has passed to today, never past its deadline. */
  rollover: boolean;
  /** Also rolls tasks that have no deadline. */
  rollUndated: boolean;
  /** Projects whose tasks are never rolled. */
  excludedProjects: string[];
  /** How many days before a deadline it is flagged as close. */
  soonDays: number;
  /** Raises a task to P1 once its deadline is today or has passed. */
  escalate: boolean;
}

export const defaultDeadlineSettings = (): DeadlineSettings => ({
  storage: 'auto',
  rollover: true,
  rollUndated: false,
  excludedProjects: [],
  soonDays: 3,
  escalate: false,
});

/** Settings as stored, made whole: anything missing or malformed takes its default. */
export function readDeadlineSettings(stored: unknown): DeadlineSettings {
  const base = defaultDeadlineSettings();
  if (!stored || typeof stored !== 'object') return base;
  const s = stored as Partial<Record<keyof DeadlineSettings, unknown>>;
  const soon = Number(s.soonDays);
  return {
    storage: (DEADLINE_STORAGES as readonly unknown[]).includes(s.storage) ? s.storage as DeadlineStorageChoice : base.storage,
    rollover: typeof s.rollover === 'boolean' ? s.rollover : base.rollover,
    rollUndated: s.rollUndated === true,
    excludedProjects: Array.isArray(s.excludedProjects)
      ? s.excludedProjects.filter((id): id is string => typeof id === 'string')
      : [],
    soonDays: Number.isInteger(soon) && soon >= 0 && soon <= 30 ? soon : base.soonDays,
    escalate: s.escalate === true,
  };
}

/**
 * Where a deadline is written for this account.
 *
 * `auto` uses Todoist's field only when the account says it is on a paid
 * plan; an account that says nothing gets the description, which works
 * everywhere.
 */
export function deadlineStorage(
  settings: Pick<DeadlineSettings, 'storage'>,
  user: Pick<TodoistUser, 'is_premium' | 'premium_status'> | null | undefined,
): 'native' | 'description' {
  if (settings.storage !== 'auto') return settings.storage;
  const paid = user?.premium_status ? user.premium_status !== 'not_premium' : user?.is_premium === true;
  return paid ? 'native' : 'description';
}

/**
 * The fields to send to give a task this deadline (null clears it).
 *
 * The other place is always cleared, so a task never carries two deadlines
 * that disagree: setting one in the description takes Todoist's away, and the
 * other way round.
 */
export function deadlineFields(
  item: Pick<Item, 'deadline' | 'description'>,
  date: string | null,
  storage: 'native' | 'description',
  lang = 'en',
): { deadline?: Item['deadline']; description?: string } {
  const out: { deadline?: Item['deadline']; description?: string } = {};
  const description = item.description ?? '';
  if (storage === 'native') {
    out.deadline = date ? { date, lang } : null;
    const cleaned = withDeadlineLine(description, null);
    if (cleaned !== description) out.description = cleaned;
  } else {
    const next = withDeadlineLine(description, date);
    if (next !== description) out.description = next;
    if (item.deadline) out.deadline = null;
  }
  return out;
}

/**
 * Task fields on their way to Todoist, with any `deadline` in them written
 * where this account keeps deadlines. A description sent alongside is the base
 * the line is added to. Fields without a deadline pass through untouched.
 */
export function routeDeadline<T extends Record<string, unknown>>(
  item: Pick<Item, 'deadline' | 'description'>,
  fields: T,
  storage: 'native' | 'description',
): T {
  if (!('deadline' in fields) || fields.deadline === undefined) return fields;
  const { deadline, ...rest } = fields;
  const value = deadline as Item['deadline'];
  const base = { deadline: item.deadline, description: typeof rest.description === 'string' ? rest.description : item.description };
  const routed = deadlineFields(base, value?.date?.slice(0, 10) ?? null, storage, value?.lang);
  return { ...rest, ...routed } as unknown as T;
}

/* ---------- Typing one ---------- */

/**
 * A deadline typed in a task's name, in Todoist's own syntax: `{Nov 2}`,
 * `{friday}`, `{2026-11-02}`. The braces hold a date and nothing else; one
 * that is not a date is left as text.
 */
export function readDeadlineToken(
  raw: string, now = new Date(), dateFormat: DateFormat = 'dmy',
): { start: number; length: number; date: string } | null {
  let last: { start: number; length: number; date: string } | null = null;
  for (const match of raw.matchAll(/\{([^{}\n]{1,40})\}/g)) {
    const inner = match[1].trim();
    let date: string | null = null;
    if (isIsoDay(inner)) {
      date = inner;
    } else {
      const reading = readNaturalDate(inner, now, { dateFormat, bareTime: false });
      // The whole of what is in the braces has to be the date.
      if (reading && reading.index === 0 && reading.matched.trim().length === inner.length) {
        date = reading.date.slice(0, 10);
      }
    }
    if (date) last = { start: match.index!, length: match[0].length, date };
  }
  return last;
}
