import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSessions, saveSessions } from '../src/sessionStore.ts';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

test('local conversations stay isolated by account ID', () => {
  const storage = memoryStorage();
  const sessions = [{ id: 's1', title: '设计讨论', updatedAt: 1, messages: [{ id: 'm1', role: 'user', content: '你好' }] }];
  saveSessions('user-a', sessions, storage);
  assert.deepEqual(loadSessions('user-a', storage), sessions);
  assert.deepEqual(loadSessions('user-b', storage), []);
});

test('corrupt local content does not block signing in', () => {
  const storage = memoryStorage();
  storage.setItem('harmony-work-mobile:sessions:user-a', '{broken');
  assert.deepEqual(loadSessions('user-a', storage), []);
});
