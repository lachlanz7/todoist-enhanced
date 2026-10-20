import { useEffect, useRef, useState } from 'react';
import { updateItem } from '@/api/commands';
import { planRollover, type RolloverChange } from '@/domain/rollover';
import { translate } from '@/i18n';
import { useStore } from '@/store/store';
import { openItems } from '@/store/selectors';
import { patchItem } from '@/store/helpers';
import { useToday } from './useToday';

/** How often the decision is looked at again while the page stays open. */
const RECHECK_MS = 15 * 60 * 1000;

/**
 * Rolls late tasks forward while the app is open (fork feature, domain/rollover).
 *
 * Runs after the app has loaded, after every sync, when the day changes and
 * every quarter of an hour. The writes are ordinary task edits through the
 * same queue as any other, so they survive going offline. Like
 * useParentEstimates it waits for the app to be quiet (nothing waiting to be
 * sent, nothing being dragged), so a poll that brings back an older copy of a
 * task cannot start a second write, and it never asks twice for the same
 * change in one session: a change Todoist refused, or one taken back with
 * Undo, is not sent again on every refresh.
 */
export function useDeadlineRollover() {
  const snapshot = useStore((s) => s.snapshot);
  const settings = useStore((s) => s.prefs.deadlines);
  const quiet = useStore((s) => s.ready && s.pendingCount === 0 && s.syncState !== 'syncing'
    && s.draggingTaskId === null && s.draggingSectionId === null);
  /* Never from the copy kept on the device: a task moved on the phone since
     would be moved back. A real account waits for a sync of this session to
     finish cleanly; the demo has nothing to wait for. */
  const demo = useStore((s) => s.demo);
  const connected = useStore((s) => s.connected);
  const syncState = useStore((s) => s.syncState);
  const syncError = useStore((s) => s.syncError);
  const lastSync = useRef(syncState);
  const [synced, setSynced] = useState(false);
  useEffect(() => {
    if (lastSync.current === 'syncing' && syncState === 'idle' && !syncError) setSynced(true);
    lastSync.current = syncState;
  }, [syncState, syncError]);
  const live = demo || (connected && synced);
  const today = useToday();
  const [tick, setTick] = useState(0);
  const asked = useRef(new Map<string, string>());

  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), RECHECK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!quiet || !live || (!settings.rollover && !settings.escalate)) return;
    const timer = window.setTimeout(() => {
      const changes = planRollover(openItems(snapshot), settings, new Date());
      const key = (change: RolloverChange) => `${change.due?.date ?? ''}|${change.priority ?? ''}`;
      const fresh = changes.filter((change) => asked.current.get(change.id) !== key(change));
      if (fresh.length === 0) return;
      for (const change of fresh) asked.current.set(change.id, key(change));
      void applyRollover(fresh);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [snapshot, settings, quiet, live, today, tick]);
}

/** Sends the changes as one batch, says so once, and offers to take them back. */
async function applyRollover(changes: RolloverChange[]) {
  const state = useStore.getState();
  const fields = (change: RolloverChange) => ({
    ...(change.due ? { due: change.due } : {}),
    ...(change.priority ? { priority: change.priority } : {}),
  });
  const before = changes.map((change) => {
    const item = state.snapshot.items[change.id];
    return {
      id: change.id,
      fields: {
        ...(change.due ? { due: item?.due ?? null } : {}),
        ...(change.priority ? { priority: item?.priority ?? 1 } : {}),
      },
    };
  });

  await state.apply(
    changes.map((change) => updateItem(change.id, fields(change))),
    (snapshot) => changes.reduce((acc, change) => patchItem(acc, change.id, fields(change)), snapshot),
  );

  const moved = changes.filter((change) => change.due).length;
  const raised = changes.filter((change) => change.priority).length;
  const { locale } = useStore.getState().prefs;
  const message = [
    moved > 0 ? translate(locale, 'deadline.rolled', { count: moved }) : null,
    raised > 0 ? translate(locale, 'deadline.escalated', { count: raised }) : null,
  ].filter(Boolean).join(' · ');
  useStore.getState().toast(message, () => void useStore.getState().apply(
    before.map((entry) => updateItem(entry.id, entry.fields)),
    (snapshot) => before.reduce((acc, entry) => patchItem(acc, entry.id, entry.fields), snapshot),
  ));
}
