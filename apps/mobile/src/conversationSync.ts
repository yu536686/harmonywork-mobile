import type { ChatMessage, ChatSession } from './model.ts';

export type SharedMessage = { id: string; seq: number; role: 'user' | 'assistant'; content: string };
export type PendingTurn = {
  sessionId: string; turnId: string; userMessageId: string; assistantMessageId: string;
  taskId?: string; callId?: string; goal?: string; responseItems?: unknown[];
  taskRequestKey?: string; contextMessages?: ChatMessage[]; finalText?: string;
  status: 'queued' | 'thinking' | 'working' | 'summarizing' | 'failed';
};
export type SyncState = {
  cursors: Record<string, number>;
  taskEventCursors?: Record<string, number>;
  changeCursor?: number;
  pendingTurns: PendingTurn[];
  answeredTurns: string[];
};

export function forgetDeletedSessions(state: SyncState, ids: ReadonlySet<string>): SyncState {
  const cursors = Object.fromEntries(Object.entries(state.cursors).filter(([id]) => !ids.has(id)));
  const taskEventCursors = Object.fromEntries(Object.entries(state.taskEventCursors ?? {}).filter(([id]) => !ids.has(id)));
  return {
    ...state, cursors, taskEventCursors,
    pendingTurns: state.pendingTurns.filter(turn => !ids.has(turn.sessionId)),
  };
}
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const prefix = 'harmony-work-mobile:sync:';
const emptyState = (): SyncState => ({ cursors: {}, taskEventCursors: {}, changeCursor: 0, pendingTurns: [], answeredTurns: [] });

export function mergeSharedMessages(session: ChatSession, messages: SharedMessage[], afterSeq: number): { session: ChatSession; afterSeq: number } {
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);
  const byId = new Map(session.messages.map(message => [message.id, message]));
  for (const { id, role, content, seq } of ordered) byId.set(id, { id, role, content, seq });
  const next = [...byId.values()].sort((a, b) => {
    if (a.seq !== undefined && b.seq !== undefined) return a.seq - b.seq;
    if (a.seq !== undefined) return -1;
    if (b.seq !== undefined) return 1;
    return 0;
  });
  const seen = new Set<string>();
  const unique = next.filter(message => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
  const changed = unique.length !== session.messages.length || unique.some((message, index) =>
    message.id !== session.messages[index]?.id || message.content !== session.messages[index]?.content || message.seq !== session.messages[index]?.seq);
  const cursor = Math.max(afterSeq, ...ordered.map(message => message.seq));
  return { session: changed ? { ...session, updatedAt: Date.now(), messages: unique } : session, afterSeq: cursor };
}

export function loadSyncState(userId: string, storage: StorageLike = localStorage): SyncState {
  try {
    const parsed = JSON.parse(storage.getItem(prefix + userId) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return emptyState();
    return {
      cursors: parsed.cursors && typeof parsed.cursors === 'object' ? parsed.cursors : {},
      taskEventCursors: parsed.taskEventCursors && typeof parsed.taskEventCursors === 'object' ? parsed.taskEventCursors : {},
      changeCursor: typeof parsed.changeCursor === 'number' && Number.isSafeInteger(parsed.changeCursor) && parsed.changeCursor >= 0
        ? parsed.changeCursor : 0,
      pendingTurns: Array.isArray(parsed.pendingTurns) ? parsed.pendingTurns.filter((turn: PendingTurn) =>
        typeof turn?.sessionId === 'string' && typeof turn?.turnId === 'string' && typeof turn?.userMessageId === 'string') : [],
      answeredTurns: Array.isArray(parsed.answeredTurns) ? parsed.answeredTurns.filter((id: unknown) => typeof id === 'string') : [],
    };
  } catch { return emptyState(); }
}

export function saveSyncState(userId: string, state: SyncState, storage: StorageLike = localStorage): void {
  try { storage.setItem(prefix + userId, JSON.stringify({
    cursors: state.cursors,
    taskEventCursors: state.taskEventCursors ?? {},
    changeCursor: state.changeCursor ?? 0,
    pendingTurns: state.pendingTurns.slice(-30),
    answeredTurns: state.answeredTurns.slice(-200),
  })); } catch { /* Keep the current conversation available. */ }
}

export function upsertPendingTurn(state: SyncState, turn: PendingTurn): SyncState {
  return { ...state, pendingTurns: [...state.pendingTurns.filter(item => item.turnId !== turn.turnId), turn] };
}

export function restartPendingTurn(state: SyncState, turn: PendingTurn, nextTurnId: string): SyncState {
  const replacement: PendingTurn = { ...turn, turnId: nextTurnId, status: 'queued' };
  return { ...state, pendingTurns: [...state.pendingTurns.filter(item => item.turnId !== turn.turnId), replacement] };
}

export function markTurnAnswered(state: SyncState, turnId: string): SyncState {
  return {
    ...state,
    pendingTurns: state.pendingTurns.filter(turn => turn.turnId !== turnId),
    answeredTurns: state.answeredTurns.includes(turnId) ? state.answeredTurns : [...state.answeredTurns, turnId],
  };
}
