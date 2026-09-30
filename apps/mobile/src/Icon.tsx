import type { ReactNode } from 'react';

export type IconName = 'home' | 'chat' | 'tasks' | 'user' | 'spark' | 'image' | 'puzzle' | 'memory' | 'monitor' | 'arrow' | 'plus' | 'send' | 'close' | 'back' | 'lock' | 'trash' | 'check';

const paths: Record<IconName, ReactNode> = {
  home: <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  chat: <><path d="M20 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.7-4.2A8.5 8.5 0 1 1 20 11.5Z" /><path d="M8 11h8M8 14h5" /></>,
  tasks: <><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  spark: <path d="m12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z" />,
  image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1" /><path d="m3 17 5-5 4 4 3-3 6 6" /></>,
  puzzle: <path d="M4 4h6a2 2 0 1 1 4 0h6v6a2 2 0 1 1 0 4v6h-6a2 2 0 1 1-4 0H4v-6a2 2 0 1 1 0-4z" />,
  memory: <><path d="M12 21c-5 0-8-3.5-8-8V8a4 4 0 0 1 6-3.5A4 4 0 0 1 18 8v5c0 4.5-2 8-6 8Z" /><path d="M12 5v15M7 10h5m0 4h5" /></>,
  monitor: <><rect x="2" y="3" width="20" height="15" rx="2" /><path d="M8 22h8m-4-4v4" /></>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  plus: <path d="M12 4v16M4 12h16" />,
  send: <path d="M12 20V4m-6 6 6-6 6 6" />,
  close: <path d="M5 5 19 19M19 5 5 19" />,
  back: <path d="m15 5-7 7 7 7" />,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  trash: <><path d="M4 7h16M10 3h4m-8 4 1 14h10l1-14M10 11v6m4-6v6" /></>,
  check: <path d="m5 12 4 4L19 6" />,
};

export function Icon({ name, size = 21 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
