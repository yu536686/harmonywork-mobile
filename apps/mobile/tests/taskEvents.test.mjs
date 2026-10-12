import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeTaskEvents, taskEventProjection } from '../src/taskEvents.ts';
import { loadSyncState, saveSyncState } from '../src/conversationSync.ts';

const event = (eventId, seq, kind, taskId = 'task') => ({
  eventId, seq, kind, taskId, turnId: 'turn', summary: kind,
  payload: {}, createdAt: '2026-10-11T00:00:00.000Z',
});

test('task events merge out-of-order pages, retries and stale responses without cursor regression', () => {
  const first = mergeTaskEvents([], [event('b', 4, 'claimed'), event('a', 2, 'queued')], 0);
  assert.deepEqual(first.events.map(item => item.eventId), ['a', 'b']);
  assert.equal(first.afterSeq, 4);
  const stale = mergeTaskEvents(first.events, [event('a', 2, 'queued')], first.afterSeq);
  assert.deepEqual(stale.events.map(item => item.eventId), ['a', 'b']);
  assert.equal(stale.afterSeq, 4);
  const latest = mergeTaskEvents(stale.events, [event('c', 5, 'succeeded')], stale.afterSeq);
  assert.deepEqual(latest.events.map(item => item.eventId), ['a', 'b', 'c']);
  assert.equal(taskEventProjection(latest.events, 'task').status, 'succeeded');
});

test('terminal task event remains one card when the final assistant message is mirrored', () => {
  const merged = mergeTaskEvents([event('done', 8, 'succeeded')], [event('done', 8, 'succeeded')], 8);
  assert.equal(merged.events.length, 1);
  assert.equal(taskEventProjection(merged.events, 'task').terminal?.eventId, 'done');
  assert.equal(taskEventProjection(merged.events, 'other'), null);
});

test('task-event cursors survive restart while older sync data remains readable', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const old = loadSyncState('account', storage);
  assert.deepEqual(old.taskEventCursors, {});
  saveSyncState('account', { ...old, taskEventCursors: { session: 17 } }, storage);
  assert.equal(loadSyncState('account', storage).taskEventCursors.session, 17);
  assert.equal(loadSyncState('account', storage).changeCursor, 0);
  values.set('harmony-work-mobile:sync:old', JSON.stringify({ cursors: { session: 2 }, pendingTurns: [], answeredTurns: [] }));
  assert.deepEqual(loadSyncState('old', storage).taskEventCursors, {});
});
