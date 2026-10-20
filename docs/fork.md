# Fork notes: deadlines on the free plan, and rollover

This fork (`lachlanz7/todoist-enhanced`) adds deadlines that work on Todoist's
**free** plan, rolls late tasks forward, and adds a few things for a student
with assessments and exams. Everything else is the original project,
[julesvbertolino/todoist-enhanced](https://github.com/julesvbertolino/todoist-enhanced),
kept in step with it.

- `main` is an exact mirror of upstream. Nothing of the fork lives there.
- `feat/deadlines` is the fork: upstream plus the features below.

## What it adds

### Deadlines on every plan

Todoist's own deadline field is a paid feature. Here a task's deadline can also
be kept as the last line of its description:

```
Read chapters 4–6 and write the summary.

Deadline: 2026-11-02
```

Why a description line: it is part of the task, so it survives every sync and
shows in every Todoist app; it needs no extra objects (a label per date would
fill the label list, a comment is a separate thing to fetch and edit); and it
can be typed or fixed by hand anywhere. It works like the checklist lines
(`- [ ] item`) the app already reads from descriptions.

- **Reading:** Todoist's own field first, then the last valid
  `Deadline: YYYY-MM-DD` line (any case). One function, `deadlineOf` in
  `src/domain/deadlines.ts`, is what every part of the app reads, so the row
  chip, the task panel, the table column, the deadline sort and the new
  Deadlines page all work with either kind.
- **Writing:** Settings → Deadlines → *Where deadlines are kept*. *Automatic*
  uses Todoist's field on a paid plan and the description line on Free;
  either can be forced. Setting a deadline in one place clears the other, so a
  task never carries two.
- **Showing:** the trailing line is hidden from the description in the app
  (the Deadline field shows it instead) and from the one-line preview on rows.
  A line typed in the middle of a description is still read, and stays
  visible.
- **Flags:** the chip on a row turns amber within *Flag a deadline as close*
  days (3 by default) and counts down (`3d left`), and red with `2d over` once
  it has passed. The task panel says the same beside the field.
- **Typing one:** in the composer or a task's title, put the date in braces,
  as in Todoist: `Lab report {Nov 2}`, `Essay {friday}`, `Exam revision {2026-11-20}`.
  It fills the Deadline field and leaves the task's own date alone, so
  `Essay tomorrow {Nov 2}` starts tomorrow and is due on the 2nd.

### Rollover

An unfinished task whose date has passed moves to today, keeping its time of
day, and keeps moving every day until it is done, **never past its deadline**.
Once the deadline is reached the task stays on it and shows as late, which is
the signal that matters.

- Only tasks with a deadline roll, unless *Also roll tasks without a deadline*
  is on.
- **Repeating tasks are never touched.** Their date belongs to their rule, and
  Todoist's own overdue state is clearer than a moved occurrence.
- Each project can be switched off (Settings → Deadlines → *Projects that roll*).
- Optional: *Raise to P1 at the deadline*.
- It runs while the app is open: after the first sync of the session (never
  from the copy cached on the device, which could move back a task you
  rescheduled on your phone), after every sync, when the day changes and every
  15 minutes. The changes go through the app's normal queue, so they survive
  going offline, and a toast offers Undo.
- It is idempotent: the decision depends only on the tasks and today's date,
  so running it twice, or on two devices, asks for the same thing.
- A time pinned to a time zone is moved by local days, so 09:00 stays 09:00,
  including across a change of clocks.

Settings are kept with the app's other settings (a comment on the Inbox), so
they follow you to every device and are what the scheduled Action reads too.

### When the browser is closed: the scheduled Action (opt-in)

`.github/workflows/deadline-rollover.yml` runs the same decision every three
hours with `scripts/rollover.ts`. It is off until you switch it on:

1. Repository **Settings → Secrets and variables → Actions → Secrets**:
   add `TODOIST_API_TOKEN` (Todoist → Settings → Integrations → Developer).
   The token is only read from the secret. Never put it in a file or commit it.
2. **Variables**: add `ROLLOVER_ENABLED` = `true`. Optionally `ROLLOVER_TZ`
   (e.g. `Australia/Sydney`); by default the Todoist account's time zone is used.
3. **Actions → Deadline rollover → Run workflow** with *dry run* ticked, and
   read the log. Then let the schedule run it.

The log prints counts only: Action logs of a public repository are public.
Revoke the token in Todoist at any time to stop it.

### The Deadlines page

A page in the sidebar (and in search, `⌘K` → Deadlines) listing every open task
with a deadline, soonest first, in four groups: *Deadline passed*, *This week*,
*Next week*, *Later*. Subtasks with their own deadline are listed too. This is
the weekly "what is coming" list for assessments and exams.

## Using it

### Deploying your copy

The build is a static site (see [deploying.md](deploying.md)). Two options:

- **GitHub Pages (built in):** Settings → Pages → Source: *GitHub Actions*;
  then Variables → `DEPLOY_PAGES` = `true`. Every push to `feat/deadlines`
  publishes `https://lachlanz7.github.io/todoist-enhanced/`. By default Pages
  only deploys from the default branch, so set `feat/deadlines` as the
  default branch (below), or allow it under Settings → Environments →
  github-pages.
- **Any static host:** `PUBLIC_URL=https://your.host/ npm run build` and
  upload `dist/`.

Sign in with **Use an API token instead**: it works on any address with no
setup. "Continue with Todoist" (OAuth) needs an OAuth app registered for your
address. The token stays in your browser.

### Make `feat/deadlines` the default branch

Scheduled workflows (upstream sync, rollover) only run from the default
branch, and Pages only deploys from it by default. Settings → General →
Default branch → `feat/deadlines`. `main` stays a plain mirror.

### Keeping up with upstream

`.github/workflows/sync-upstream.yml` fast-forwards `main` from upstream every
day (or press **Sync fork** on GitHub). Then bring it into the fork's branch:

```bash
git fetch origin
git checkout feat/deadlines
git merge origin/main          # or: git rebase origin/main, then push --force-with-lease
npm ci && npm run typecheck && npm run lint && npm test
git push
```

Merging is the safer default (no force-push). The fork keeps its changes in
new files where it can (`src/domain/deadlines.ts`, `deadlineToken.ts`,
`deadlineGroups.ts`, `rollover.ts`, `src/hooks/useDeadlineRollover.ts`,
`src/views/DeadlinesView.tsx`, `src/styles/deadlines.css`,
`scripts/rollover.ts`) and only small hooks into upstream files, so conflicts
should be rare and short. The upstream files it touches: `domain/dates.ts`
(`deadlineDate`), `domain/shorthand.ts` (`{…}`), `domain/types.ts` and
`domain/sidebar.ts` (the page), `store/prefs.ts` (settings), `store/tasks.ts`
and `store/selectors.ts`, `App.tsx`, `TaskRow`, `TaskDetail`, `Composer`,
`TableCells`, `TaskActions`, `Sidebar`, `SidebarNavEditor`, `Search`,
`SettingsView`, `hooks/useRoute.ts`, `main.tsx`, the two i18n files, and two
sidebar tests. If upstream ever ships its own free-plan deadlines, prefer
theirs.

## Limitations

- Nothing here was run against a real Todoist account: the app's write path,
  the rollover and the script were checked with unit tests, a mocked Sync API
  and the demo account. Try the Action with *dry run* first.
- Rollover only runs while the app is open, unless the Action is switched on.
- A deadline in the description is a day, not a time (as in Todoist).
- Todoist's own apps show the line as text; they do not treat it as a deadline.
- The French interface has the strings; the `Deadline:` line itself is always
  written in English so every device reads it the same.
- On a paid plan with *Automatic*, the app writes Todoist's field. A
  description line on the same task is ignored while the native one exists.

## Ideas not built

- A countdown badge in the sidebar (count of deadlines this week).
- Deadlines on the Calendar view and the Week page as markers on their day.
- An "exam mode" that spreads study sessions before a deadline.
- Weekly email or push digest of upcoming deadlines (would need a server or the
  Action plus a mail service).
- Group the Deadlines page by project (course) as an option.
- Import assessment dates from a unit outline (CSV/ICS) into tasks with deadlines.
- Show a deadline's progress (subtasks/checklist done vs. days left).
