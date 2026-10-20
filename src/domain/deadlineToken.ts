import { readNaturalDate } from './nlp';
import { isIsoDay } from './deadlines';
import type { DateFormat } from './dates';

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
