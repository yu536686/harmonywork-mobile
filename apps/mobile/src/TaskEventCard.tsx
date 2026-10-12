import { Icon } from './Icon.tsx';
import type { RemoteTask } from './bridge.ts';
import type { TaskEvent } from './taskEvents.ts';
import { taskEventProjection } from './taskEvents.ts';

export function TaskEventCard({ taskId, events, task }: {
  taskId: string; events: TaskEvent[]; task?: RemoteTask;
}) {
  const projection = taskEventProjection(events, taskId);
  if (!projection) return null;
  const done = !!projection.terminal;
  const failed = projection.status === 'failed' || projection.status === 'cancelled';
  const latestStep = [...projection.steps].reverse().find(event =>
    event.kind === 'tool_started' || event.kind === 'planning' || event.kind === 'artifact_ready');
  return <section className={`task-event-card ${done ? 'is-finished' : 'is-working'}`} role="status" aria-live="polite">
    <div className="task-event-heading">
      <span className="task-event-icon"><Icon name="monitor" size={17} /></span>
      <strong>Windows 电脑{done ? failed ? '未能完成任务' : '已完成任务' : '正在执行'}</strong>
      {!done && <span className="task-event-spinner" aria-label="执行中" />}
    </div>
    <p>{projection.terminal?.summary ?? latestStep?.summary ?? projection.latest.summary}</p>
    {done && !failed && task?.result && <details className="task-event-result">
      <summary>查看电脑成果</summary>
      <div>{task.result}</div>
    </details>}
    {done && !failed && <small>小亨会在此会话继续整理最终答复。</small>}
  </section>;
}
