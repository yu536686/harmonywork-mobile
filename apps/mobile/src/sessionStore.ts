import type { ChatSession } from './model.ts';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const prefix = 'harmony-work-mobile:sessions:';

function isSession(value: unknown): value is ChatSession {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ChatSession>;
  return typeof item.id === 'string' && typeof item.title === 'string' &&
    typeof item.updatedAt === 'number' && Array.isArray(item.messages) &&
    item.messages.every(message => message && typeof message.id === 'string' &&
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string');
}

export function loadSessions(userId: string, storage: StorageLike = localStorage): ChatSession[] {
  try {
    const raw = storage.getItem(prefix + userId);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isSession).slice(0, 30) : [];
  } catch {
    return [];
  }
}

export function saveSessions(userId: string, sessions: ChatSession[], storage: StorageLike = localStorage): void {
  try {
    const bounded = [...sessions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 30)
      .map(session => ({ ...session, messages: session.messages.slice(-100) }));
    storage.setItem(prefix + userId, JSON.stringify(bounded));
  } catch {
    // The active conversation remains usable even when local storage is unavailable.
  }
}
