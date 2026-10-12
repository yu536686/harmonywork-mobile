export type TaskEventKind = 'queued' | 'claimed' | 'planning' | 'tool_started' | 'tool_finished' |
  'artifact_ready' | 'succeeded' | 'failed' | 'cancelled';

export type TaskEvent = {
  eventId: string;
  seq: number;
  taskId: string;
  turnId: string | null;
  initiatingMessageId?: string | null;
  kind: TaskEventKind;
  summary: string;
  payload: Record<string, string | number>;
  createdAt: string;
};

const terminalKinds = new Set<TaskEventKind>(['succeeded', 'failed', 'cancelled']);

export function mergeTaskEvents(existing: TaskEvent[], incoming: TaskEvent[], afterSeq: number): {
  events: TaskEvent[]; afterSeq: number;
} {
  const byId = new Map(existing.map(event => [event.eventId, event]));
  for (const event of incoming) {
    if (!byId.has(event.eventId)) byId.set(event.eventId, event);
  }
  return {
    events: [...byId.values()].sort((left, right) => left.seq - right.seq || left.eventId.localeCompare(right.eventId)),
    afterSeq: Math.max(afterSeq, ...incoming.map(event => event.seq)),
  };
}

export function taskEventProjection(events: TaskEvent[], taskId: string): {
  taskId: string;
  status: TaskEventKind;
  latest: TaskEvent;
  terminal: TaskEvent | null;
  steps: TaskEvent[];
} | null {
  const related = events.filter(event => event.taskId === taskId).sort((a, b) => a.seq - b.seq);
  if (!related.length) return null;
  const latest = related.at(-1)!;
  return {
    taskId,
    status: latest.kind,
    latest,
    terminal: [...related].reverse().find(event => terminalKinds.has(event.kind)) ?? null,
    steps: related.filter(event => !terminalKinds.has(event.kind)),
  };
}
