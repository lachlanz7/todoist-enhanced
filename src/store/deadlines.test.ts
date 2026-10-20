import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/db/idb', () => ({
  saveSnapshot: vi.fn(async () => {}),
  enqueue: vi.fn(async () => {}),
  dequeue: vi.fn(async () => {}),
  updateQueued: vi.fn(async () => {}),
  readQueue: vi.fn(async () => []),
}));
vi.mock('@/api/commands', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/commands')>()),
  sendCommands: vi.fn(),
}));

import { sendCommands, type Command, type CommandResult } from '@/api/commands';
import { defaultDeadlineSettings } from '@/domain/deadlines';
import { emptySnapshot, type TodoistUser } from '@/domain/types';
import { item } from '@/test/items';
import { useStore } from './store';

/* Deadlines written through the store (fork feature): on a free account they
   go into the description, never into Todoist's paid field. */
const sent = vi.mocked(sendCommands);
const ok = (commands: Command[]): CommandResult => ({
  responses: [], failures: [], mapping: {}, delivered: commands.map((cmd) => cmd.uuid), undelivered: [],
});
const lastArgs = () => (sent.mock.calls.at(-1)![1] as Command[])[0].args;

function account(premium: boolean) {
  const snapshot = emptySnapshot();
  snapshot.user = { id: 'me', inbox_project_id: 'inbox', is_premium: premium } as TodoistUser;
  snapshot.items.essay = item({ id: 'essay', description: 'Two thousand words' });
  const { prefs } = useStore.getState();
  useStore.setState({
    demo: false, snapshot, toasts: [], undoStack: [], pendingCount: 0, syncState: 'idle',
    prefs: { ...prefs, deadlines: defaultDeadlineSettings() },
  });
}

beforeEach(() => {
  vi.stubGlobal('navigator', { onLine: true });
  vi.clearAllMocks();
  sent.mockImplementation(async (_token, commands) => ok(commands));
});
afterEach(() => vi.unstubAllGlobals());

describe('setting a deadline', () => {
  it('writes a description line on a free account', async () => {
    account(false);
    await useStore.getState().updateTask('essay', { deadline: { date: '2026-11-02', lang: 'en' } });
    expect(lastArgs()).toEqual({ id: 'essay', description: 'Two thousand words\n\nDeadline: 2026-11-02' });
    expect(useStore.getState().snapshot.items.essay.description).toBe('Two thousand words\n\nDeadline: 2026-11-02');
  });

  it('clears it again by taking the line out', async () => {
    account(false);
    await useStore.getState().updateTask('essay', { deadline: { date: '2026-11-02', lang: 'en' } });
    await useStore.getState().updateTask('essay', { deadline: null });
    expect(lastArgs()).toEqual({ id: 'essay', description: 'Two thousand words' });
  });

  it('uses Todoist\'s field on a paid account', async () => {
    account(true);
    await useStore.getState().updateTask('essay', { deadline: { date: '2026-11-02', lang: 'en' } });
    expect(lastArgs()).toEqual({ id: 'essay', deadline: { date: '2026-11-02', lang: 'en' } });
  });

  it('creates a task with its deadline in the description on a free account', async () => {
    account(false);
    await useStore.getState().createTask({
      content: 'Lab report', project_id: 'inbox', deadline: { date: '2026-11-02', lang: 'en' },
    });
    const args = lastArgs();
    expect(args).not.toHaveProperty('deadline');
    expect(args.description).toBe('Deadline: 2026-11-02');
  });

  it('leaves other edits alone', async () => {
    account(false);
    await useStore.getState().updateTask('essay', { content: 'Essay' });
    expect(lastArgs()).toEqual({ id: 'essay', content: 'Essay' });
  });
});
