import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeSharedMessages, loadSyncState, saveSyncState, upsertPendingTurn, markTurnAnswered, restartPendingTurn } from '../src/conversationSync.ts';

const session = { id: 's', title: 'test', updatedAt: 1, messages: [
  { id: 'a', role: 'user', content: 'same' },
] };
const remote = [
  { id: 'a', seq: 1, role: 'user', content: 'same' },
  { id: 'b', seq: 2, role: 'assistant', content: 'same' },
  { id: 'c', seq: 3, role: 'assistant', content: 'same' },
];

test('merge preserves distinct IDs with identical content and advances cursor', () => {
  const result = mergeSharedMessages(session, remote, 0);
  assert.deepEqual(result.session.messages.map(message => message.id), ['a', 'b', 'c']);
  assert.equal(result.afterSeq, 3);
  assert.deepEqual(mergeSharedMessages(result.session, remote, result.afterSeq).session.messages.map(message => message.id), ['a', 'b', 'c']);
  const later = mergeSharedMessages(result.session, [{ id: 'd', seq: 4, role: 'user', content: 'next' }], result.afterSeq);
  assert.deepEqual(later.session.messages.map(message => message.id), ['a', 'b', 'c', 'd']);
});

test('pending desktop call survives restart and produces only one final answer', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const initial = loadSyncState('user', storage);
  const pending = { sessionId: 's', turnId: 't', userMessageId: 'a', assistantMessageId: 'answer', taskId: 'task', callId: 'call', goal: 'work', responseItems: [], status: 'working' };
  saveSyncState('user', upsertPendingTurn(initial, pending), storage);
  const restored = loadSyncState('user', storage);
  assert.equal(restored.pendingTurns[0].taskId, 'task');
  const answered = markTurnAnswered(restored, 't');
  assert.equal(markTurnAnswered(answered, 't').pendingTurns.length, 0);
  assert.equal(answered.answeredTurns.includes('t'), true);
});

test('restart replaces a failed lease without duplicating the user message', () => {
  const prior = { sessionId: 's', turnId: 'expired', userMessageId: 'a', assistantMessageId: 'answer', status: 'queued' };
  const state = upsertPendingTurn({ cursors: {}, pendingTurns: [], answeredTurns: [] }, prior);
  const next = restartPendingTurn(state, prior, 'retry');
  assert.deepEqual(next.pendingTurns.map(turn => turn.turnId), ['retry']);
  assert.equal(next.pendingTurns[0].userMessageId, 'a');
  assert.equal(next.pendingTurns[0].assistantMessageId, 'answer');
});
