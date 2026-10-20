/**
 * Deadline rollover without a browser (fork feature).
 *
 * The app rolls late tasks forward only while it is open. This script makes
 * the same decision (src/domain/rollover.ts) for a scheduled GitHub Action, so
 * tasks move even on days the app is never opened. It reads the deadline
 * settings the app keeps in the Inbox comment, so per-project switches and
 * "roll tasks without a deadline" apply here too.
 *
 *   TODOIST_API_TOKEN   required; a repository secret, never committed
 *   DRY_RUN=true        decide and report, send nothing
 *   TZ                  optional; defaults to the time zone of the Todoist account
 *
 * Built and run by .github/workflows/deadline-rollover.yml:
 *   npx esbuild scripts/rollover.ts --bundle --platform=node --format=esm \
 *     --tsconfig=tsconfig.app.json --outfile=.rollover/rollover.mjs
 *   node .rollover/rollover.mjs
 *
 * The log says how many tasks moved and nothing else: Action logs of a public
 * repository are public, so no task name, project name or token is printed.
 */
import { planRollover } from '@/domain/rollover';
import { readDeadlineSettings } from '@/domain/deadlines';
import { readSettingsComment, SETTINGS_COMMENT_MARKER } from '@/store/prefs';
import type { Item, Note, Project, Section, TodoistUser } from '@/domain/types';

// Overridable only so the script can be tried against a local stand-in.
const API = process.env.TODOIST_SYNC_URL || 'https://api.todoist.com/api/v1/sync';

interface SyncAnswer {
  items?: Item[];
  projects?: Project[];
  sections?: Section[];
  project_notes?: Note[];
  user?: TodoistUser;
  sync_token?: string;
  sync_status?: Record<string, 'ok' | { error: string }>;
}

async function sync(token: string, form: Record<string, string>): Promise<SyncAnswer> {
  const response = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  });
  if (!response.ok) throw new Error(`Todoist answered ${response.status}`);
  return response.json() as Promise<SyncAnswer>;
}

async function main() {
  const token = process.env.TODOIST_API_TOKEN?.trim();
  if (!token) {
    console.error('TODOIST_API_TOKEN is not set: add it as a repository secret.');
    process.exit(1);
  }
  const dryRun = /^(1|true|yes)$/i.test(process.env.DRY_RUN ?? '');

  const data = await sync(token, {
    sync_token: '*',
    resource_types: JSON.stringify(['items', 'projects', 'sections', 'project_notes', 'user']),
  });

  /* "Today" is the account's today, not the runner's (UTC). Node reads TZ
     again when it changes, so setting it before any date is made is enough. */
  const zone = data.user?.tz_info?.timezone;
  if (!process.env.TZ && zone) process.env.TZ = zone;

  // The newest settings comment on the Inbox, as the app picks it.
  const inbox = data.user?.inbox_project_id;
  const comments = (data.project_notes ?? [])
    .filter((note) => !note.is_deleted && note.project_id === inbox && note.content.startsWith(SETTINGS_COMMENT_MARKER))
    .map((note) => ({ note, stored: readSettingsComment(note.content) }))
    .sort((a, b) => (b.stored?.savedAt ?? 0) - (a.stored?.savedAt ?? 0) || b.note.posted_at.localeCompare(a.note.posted_at));
  const stored = comments[0]?.stored as { deadlines?: unknown } | null | undefined;
  const settings = readDeadlineSettings(stored?.deadlines);
  if (!settings.rollover && !settings.escalate) {
    console.log('Rollover is switched off in the app settings; nothing to do.');
    return;
  }

  // Open tasks, as the app counts them: not in an archived project or section.
  const projects = new Map((data.projects ?? []).map((project) => [project.id, project]));
  const sections = new Map((data.sections ?? []).map((section) => [section.id, section]));
  const open = (data.items ?? []).filter((item) => {
    if (item.checked || item.is_deleted) return false;
    const project = projects.get(item.project_id);
    if (project && (project.is_archived || project.is_deleted)) return false;
    const section = item.section_id ? sections.get(item.section_id) : undefined;
    return !section?.is_archived;
  });

  const changes = planRollover(open, settings, new Date());
  const rolled = changes.filter((change) => change.reason === 'rolled').length;
  const capped = changes.filter((change) => change.reason === 'capped').length;
  const raised = changes.filter((change) => change.priority).length;
  console.log(`${open.length} open tasks; ${rolled} to roll to today, ${capped} held at their deadline, ${raised} to raise to P1.`);
  if (changes.length === 0 || dryRun) {
    if (dryRun) console.log('Dry run: nothing was sent.');
    return;
  }

  const commands = changes.map((change) => ({
    type: 'item_update',
    uuid: crypto.randomUUID(),
    args: {
      id: change.id,
      ...(change.due ? { due: change.due } : {}),
      ...(change.priority ? { priority: change.priority } : {}),
    },
  }));
  let failed = 0;
  for (let at = 0; at < commands.length; at += 100) {
    const batch = commands.slice(at, at + 100);
    const answer = await sync(token, { sync_token: data.sync_token ?? '*', commands: JSON.stringify(batch) });
    failed += Object.values(answer.sync_status ?? {}).filter((status) => status !== 'ok').length;
  }
  console.log(`Sent ${commands.length} changes; ${failed} refused.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  // The message only: a request error never carries the token, but its headers might.
  console.error(`Rollover failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
});
