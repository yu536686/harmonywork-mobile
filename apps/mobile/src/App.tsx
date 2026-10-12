import { Fragment, useEffect, useRef, useState, type FocusEvent, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Icon, type IconName } from './Icon.tsx';
import { parsePairingCode, selectPreferredDesktop, type LinkedDevice, type RemoteTask } from './bridge.ts';
import { BridgePeer, type BridgeSignal } from './bridgePeer.ts';
import { TaskEventCard } from './TaskEventCard.tsx';
import { mergeTaskEvents, type TaskEvent } from './taskEvents.ts';
import { loadSyncState, markTurnAnswered, mergeSharedMessages, restartPendingTurn, saveSyncState, upsertPendingTurn, type PendingTurn, type SharedMessage, type SyncState } from './conversationSync.ts';
import type { AccountView, ChatMessage, ChatSession } from './model.ts';
import { loadSessions, saveSessions } from './sessionStore.ts';
import './App.css';

type View = 'home' | 'conversations' | 'chat' | 'tasks' | 'mine';
type Sheet = 'harvis' | 'skills' | 'memory' | 'device' | null;
const features: Record<Exclude<Sheet, null>, { title: string; intro: string; detail: string; icon: IconName }> = {
  harvis: { title: 'Harvis 图片生成', intro: '将创作想法变成图片。', detail: '生图接口和积分状态将在下个闭环接入；当前版本暂不发送生成请求。', icon: 'image' },
  skills: { title: '技能远程管理', intro: '在手机上查看与管理电脑技能。', detail: '需要先完成设备绑定、权限与技能状态协议；当前没有连接桌面设备。', icon: 'puzzle' },
  memory: { title: '小亨的记忆', intro: '查看与管理个人记忆。', detail: '跨端记忆接口将在后续接入。当前只保存本机对话，不将其冒充账户记忆。', icon: 'memory' },
  device: { title: '连接电脑', intro: '扫码绑定你的 Windows 桌面端。', detail: '配对码 5 分钟内有效，仅同一账户可绑定。跨端会话和任务内容会存储在自建 11.29 服务器；手机轻量对话仍可独立使用。', icon: 'monitor' },
};
const errorText = (error: unknown) => typeof error === 'string' ? error : error instanceof Error ? error.message : '操作失败，请稍后重试';
const dateLabel = (time: number) => new Date(time).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
const deviceKey = (accountId: string) => `harmony-work-mobile:device:${accountId}`;
const deviceTokenKey = (accountId: string) => `harmony-work-mobile:device-token:${accountId}`;
const preferredDesktopKey = (accountId: string) => `harmony-work-mobile:preferred-desktop:${accountId}`;
type ChatDecision = { kind: 'text'; text: string } | { kind: 'desktop'; call_id: string; goal: string; response_items: unknown[] };

function App() {
  const [booting, setBooting] = useState(true);
  const [account, setAccount] = useState<AccountView | null>(null);
  const accountId = useRef<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [view, setView] = useState<View>('home');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState<{ id: string; text: string } | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [devices, setDevices] = useState<LinkedDevice[]>([]);
  const [mobileDeviceId, setMobileDeviceId] = useState('');
  const [tasks, setTasks] = useState<RemoteTask[]>([]);
  const [taskEvents, setTaskEvents] = useState<Record<string, TaskEvent[]>>({});
  const [turns, setTurns] = useState<PendingTurn[]>([]);
  const [pairingText, setPairingText] = useState('');
  const [pairingError, setPairingError] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [unlinkingDesktopId, setUnlinkingDesktopId] = useState('');
  const [scanning, setScanning] = useState(false);
  const [selectedDesktopId, setSelectedDesktopId] = useState('');
  const [peerState, setPeerState] = useState<'connecting' | 'direct' | 'fallback'>('fallback');
  const peerRef = useRef<BridgePeer | null>(null);
  const syncState = useRef<SyncState>({ cursors: {}, pendingTurns: [], answeredTurns: [] });
  const processingTurns = useRef(new Set<string>());
  const queuingTasks = useRef(new Set<string>());
  const syncing = useRef(false);
  const taskEventsRef = useRef<Record<string, TaskEvent[]>>({});
  const syncingTaskEvents = useRef(new Set<string>());
  const syncingChanges = useRef(false);
  const sessionsRef = useRef<ChatSession[]>([]);
  const tasksRef = useRef<RemoteTask[]>([]);
  sessionsRef.current = sessions;
  tasksRef.current = tasks;
  const chatEnd = useRef<HTMLDivElement | null>(null);
  const active = sessions.find(session => session.id === activeId) ?? null;
  const activePending = turns.find(turn => turn.sessionId === activeId);
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => document.documentElement.style.setProperty('--app-height', `${Math.round(viewport?.height ?? window.innerHeight)}px`);
    resize();
    viewport?.addEventListener('resize', resize);
    window.addEventListener('resize', resize);
    return () => { viewport?.removeEventListener('resize', resize); window.removeEventListener('resize', resize); };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('scanner-active', scanning);
    return () => document.documentElement.classList.remove('scanner-active');
  }, [scanning]);

  useEffect(() => {
    invoke<AccountView | null>('mobile_account').then(async current => {
      if (current) {
        accountId.current = current.id;
        const deviceId = localStorage.getItem(deviceKey(current.id)) ?? '';
        const deviceToken = localStorage.getItem(deviceTokenKey(current.id)) ?? '';
        if (deviceId && deviceToken) await invoke('bridge_set_device', { deviceId, deviceToken });
        setMobileDeviceId(localStorage.getItem(deviceKey(current.id)) ?? '');
        syncState.current = loadSyncState(current.id);
        setTurns(syncState.current.pendingTurns);
        setSessions(loadSessions(current.id));
        setAccount(current);
      }
    }).catch(() => undefined).finally(() => setBooting(false));
  }, []);
  useEffect(() => { if (account) saveSessions(account.id, sessions); }, [account, sessions]);
  useEffect(() => {
    if (!account) return;
    void refreshDevices();
    void refreshTasks();
    if (mobileDeviceId && devices.length) void refreshSharedSessions();
    const timer = window.setInterval(() => {
      void refreshDevices();
      void refreshTasks();
      if (mobileDeviceId && devices.length) void refreshSharedSessions();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [account?.id, mobileDeviceId, devices.length]);
  useEffect(() => {
    if (!account || !mobileDeviceId || !devices.length || !activeId) return;
    const refresh = () => {
      void refreshTaskEvents(activeId);
      void refreshActiveMessages(activeId);
    };
    refresh();
    const timer = window.setInterval(refresh, 3_000);
    const onForeground = () => { if (!document.hidden) { refresh(); void refreshTasks(); void refreshSharedSessions(); } };
    window.addEventListener('focus', onForeground);
    document.addEventListener('visibilitychange', onForeground);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onForeground);
      document.removeEventListener('visibilitychange', onForeground);
    };
  }, [account?.id, mobileDeviceId, devices.length, activeId]);
  useEffect(() => {
    if (!account || !mobileDeviceId || !devices.length) return;
    let closed = false;
    let unlisten: (() => void) | undefined;
    void listen<number>('mobile_bridge_change_hint', () => { void refreshChanges(); })
      .then(stop => {
        if (closed) stop(); else unlisten = stop;
      });
    void refreshChanges();
    void invoke('bridge_start_change_stream', { afterSeq: syncState.current.changeCursor ?? 0 })
      .catch(() => undefined);
    const onForeground = () => { if (!document.hidden) void refreshChanges(); };
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);
    const fallback = window.setInterval(() => { void refreshChanges(); }, 10_000);
    return () => {
      closed = true;
      unlisten?.();
      void invoke('bridge_stop_change_stream');
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
      window.clearInterval(fallback);
    };
  }, [account?.id, mobileDeviceId, devices.length]);
  useEffect(() => {
    const device = devices.find(item => item.desktopDeviceId === selectedDesktopId);
    if (!account || !device || typeof RTCPeerConnection === 'undefined') return;
    const peer = new BridgePeer({
      desktopDeviceId: device.desktopDeviceId, mobileDeviceId: device.mobileDeviceId,
      localDeviceId: device.mobileDeviceId, remoteDeviceId: device.desktopDeviceId, initiator: true,
      sendSignal: (kind, payload) => invoke('bridge_send_signal', { desktopDeviceId: device.desktopDeviceId, mobileDeviceId: device.mobileDeviceId, senderDeviceId: device.mobileDeviceId, recipientDeviceId: device.desktopDeviceId, kind, payload }),
      pollSignals: after => invoke<{ signals: BridgeSignal[] }>('bridge_signals', { deviceId: device.mobileDeviceId, after }).then(result => result.signals),
      onHint: () => { void refreshTasks(); },
      onState: setPeerState,
    });
    peerRef.current = peer;
    void peer.start().catch(() => setPeerState('fallback'));
    return () => { peer.stop(); peerRef.current = null; };
  }, [account?.id, selectedDesktopId, devices]);
  useEffect(() => {
    if (view === 'chat') chatEnd.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'end',
    });
  }, [view, sessions, sending]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoggingIn(true);
    setLoginError('');
    try {
      const current = await invoke<AccountView>('mobile_login', { email: email.trim(), password });
      accountId.current = current.id;
      const deviceId = localStorage.getItem(deviceKey(current.id)) ?? '';
      const deviceToken = localStorage.getItem(deviceTokenKey(current.id)) ?? '';
      if (deviceId && deviceToken) await invoke('bridge_set_device', { deviceId, deviceToken });
      setMobileDeviceId(localStorage.getItem(deviceKey(current.id)) ?? '');
      syncState.current = loadSyncState(current.id);
      setTurns(syncState.current.pendingTurns);
      setSessions(loadSessions(current.id));
      setAccount(current);
      setView('home');
      setSending(false);
    } catch (error) { setLoginError(errorText(error)); }
    finally { setPassword(''); setLoggingIn(false); }
  }

  async function signOut() {
    await invoke('bridge_stop_change_stream').catch(() => undefined);
    await invoke('mobile_logout').catch(() => undefined);
    await invoke('bridge_set_device', { deviceId: '', deviceToken: '' }).catch(() => undefined);
    accountId.current = null;
    setAccount(null);
    setSessions([]);
    setActiveId(null);
    setDraft('');
    setSending(false);
    setChatError(null);
    setDevices([]);
    setMobileDeviceId('');
    setTasks([]);
    setTaskEvents({});
    taskEventsRef.current = {};
    setSheet(null);
    setPairingText('');
    setUnlinkingDesktopId('');
    setSelectedDesktopId('');
    syncState.current = { cursors: {}, pendingTurns: [], answeredTurns: [] };
    setTurns([]);
    setView('home');
  }

  async function refreshDevices(preferLatest = false) {
    const owner = accountId.current;
    try {
      const result = await invoke<{ devices: LinkedDevice[] }>('bridge_devices');
      if (!owner || owner !== accountId.current) return;
      const ownId = localStorage.getItem(deviceKey(owner)) ?? '';
      const own = result.devices.filter(device => device.mobileDeviceId === ownId);
      const accessible = new Set(own.map(device => device.desktopDeviceId));
      const inaccessibleTasks = new Set(tasksRef.current
        .filter(task => !accessible.has(task.desktopDeviceId)).map(task => task.id));
      if (inaccessibleTasks.size) persistSync({
        ...syncState.current,
        pendingTurns: syncState.current.pendingTurns.filter(turn => !turn.taskId || !inaccessibleTasks.has(turn.taskId)),
      });
      setMobileDeviceId(ownId);
      setDevices(current => JSON.stringify(current) === JSON.stringify(own) ? current : own);
      setTasks(current => current.filter(task => accessible.has(task.desktopDeviceId)));
      setSelectedDesktopId(current => {
        const selected = selectPreferredDesktop(own, current, localStorage.getItem(preferredDesktopKey(owner)) ?? '', preferLatest);
        if (selected) localStorage.setItem(preferredDesktopKey(owner), selected);
        return selected;
      });
    } catch { /* Keep the last verified link list during a coordinator outage. */ }
  }

  async function refreshTasks() {
    const owner = accountId.current;
    try {
      if (!mobileDeviceId || !devices.length) { setTasks([]); return; }
      const result = await invoke<{ tasks: RemoteTask[] }>('bridge_tasks', { mobileDeviceId });
      if (!owner || owner !== accountId.current) return;
      setTasks(result.tasks);
      for (const pending of syncState.current.pendingTurns) {
        const task = result.tasks.find(item => item.id === pending.taskId && (item.status === 'succeeded' || item.status === 'failed'));
        if (task && pending.status !== 'failed') void resumeTask(pending, task);
      }
    } catch { /* The local conversation remains available while the bridge is offline. */ }
  }

  async function refreshChanges() {
    const owner = accountId.current;
    if (!owner || !mobileDeviceId || syncingChanges.current) return;
    syncingChanges.current = true;
    try {
      let cursor = syncState.current.changeCursor ?? 0;
      for (;;) {
        const page = await invoke<{ changes: { seq: number; kind: string; sessionId: string | null }[]; nextSeq: number; resetRequired: boolean }>(
          'bridge_changes', { afterSeq: cursor });
        if (owner !== accountId.current) return;
        if (page.resetRequired) {
          taskEventsRef.current = {};
          setTaskEvents({});
          persistSync({ ...syncState.current, taskEventCursors: {}, changeCursor: page.nextSeq });
          if (activeId) void refreshTaskEvents(activeId);
          void refreshSharedSessions();
          void refreshTasks();
        }
        if (!page.changes.length) break;
        cursor = page.nextSeq;
        persistSync({ ...syncState.current, changeCursor: cursor });
        if (page.changes.some(change => change.kind === 'device')) void refreshDevices();
        if (page.changes.some(change => change.kind === 'session')) void refreshSharedSessions();
        if (page.changes.some(change => change.kind === 'task')) {
          void refreshTasks();
          for (const sessionId of new Set(page.changes.map(change => change.sessionId).filter((id): id is string => !!id))) {
            if (sessionId === activeId) void refreshTaskEvents(sessionId);
          }
        }
        if (page.changes.length < 100) break;
      }
    } catch (error) {
      if (errorText(error).includes('403')) void refreshDevices();
      /* Periodic refresh resumes when the coordinator is available. */
    }
    finally { syncingChanges.current = false; }
  }

  async function refreshTaskEvents(sessionId: string) {
    const owner = accountId.current;
    if (!owner || !mobileDeviceId || syncingTaskEvents.current.has(sessionId)) return;
    syncingTaskEvents.current.add(sessionId);
    try {
      let cursor = taskEventsRef.current[sessionId]?.length
        ? syncState.current.taskEventCursors?.[sessionId] ?? 0 : 0;
      for (;;) {
        const page = await invoke<{ events: TaskEvent[] }>('bridge_task_events', { sessionId, afterSeq: cursor });
        if (owner !== accountId.current) return;
        const merged = mergeTaskEvents(taskEventsRef.current[sessionId] ?? [], page.events, cursor);
        taskEventsRef.current = { ...taskEventsRef.current, [sessionId]: merged.events };
        setTaskEvents(taskEventsRef.current);
        cursor = merged.afterSeq;
        persistSync({ ...syncState.current, taskEventCursors: {
          ...syncState.current.taskEventCursors, [sessionId]: cursor,
        } });
        if (page.events.length < 100) {
          if (page.events.some(event => event.kind === 'succeeded' || event.kind === 'failed')) void refreshTasks();
          break;
        }
      }
    } catch { /* Keep the last known task progress until the coordinator returns. */ }
    finally { syncingTaskEvents.current.delete(sessionId); }
  }

  async function refreshActiveMessages(sessionId: string) {
    const owner = accountId.current;
    if (!owner || !mobileDeviceId) return;
    try {
      let cursor = sessionsRef.current.some(session => session.id === sessionId)
        ? syncState.current.cursors[sessionId] ?? 0 : 0;
      for (;;) {
        const page = await invoke<{ messages: SharedMessage[] }>('bridge_messages', { sessionId, afterSeq: cursor });
        if (owner !== accountId.current) return;
        if (!page.messages.length) return;
        const nextCursor = Math.max(cursor, syncState.current.cursors[sessionId] ?? 0,
          ...page.messages.map(message => message.seq));
        setSessions(current => {
          const existing = current.find(session => session.id === sessionId);
          if (!existing) return current;
          const merged = mergeSharedMessages(existing, page.messages, syncState.current.cursors[sessionId] ?? 0).session;
          return current.map(session => session.id === sessionId ? merged : session);
        });
        persistSync({ ...syncState.current, cursors: { ...syncState.current.cursors, [sessionId]: nextCursor } });
        cursor = nextCursor;
        if (page.messages.length < 100) return;
      }
    } catch { /* The existing conversation remains readable while offline. */ }
  }

  async function claimPairing(raw: string) {
    setPairingBusy(true);
    setPairingError('');
    try {
      const { pairingId, secret } = parsePairingCode(raw);
      const bound = await invoke<{ desktopDeviceId: string; mobileDeviceId: string; deviceToken: string }>('bridge_claim_pairing', { pairingId, secret, mobileName: 'Harmony Work Android' });
      if (!accountId.current) return;
      localStorage.setItem(deviceKey(accountId.current), bound.mobileDeviceId);
      localStorage.setItem(deviceTokenKey(accountId.current), bound.deviceToken);
      localStorage.setItem(preferredDesktopKey(accountId.current), bound.desktopDeviceId);
      setSelectedDesktopId(bound.desktopDeviceId);
      await invoke('bridge_set_device', { deviceId: bound.mobileDeviceId, deviceToken: bound.deviceToken });
      setMobileDeviceId(bound.mobileDeviceId);
      setPairingText('');
      await refreshDevices();
      setSheet(null);
    } catch (error) { setPairingError(errorText(error)); }
    finally { setPairingBusy(false); }
  }

  async function unlinkDesktop(device: LinkedDevice) {
    if (!window.confirm(`解除与“${device.desktopName}”的绑定？该电脑将不能继续执行此手机的任务。历史会话仍保存在手机。`)) return;
    setUnlinkingDesktopId(device.desktopDeviceId);
    setPairingError('');
    try {
      await invoke('bridge_unlink', {
        desktopDeviceId: device.desktopDeviceId, mobileDeviceId: device.mobileDeviceId,
      });
      await refreshDevices();
      await refreshTasks();
    } catch (error) { setPairingError(errorText(error)); }
    finally { setUnlinkingDesktopId(''); }
  }

  async function scanPairing() {
    setPairingError('');
    try {
      const { scan, Format, requestPermissions } = await import('@tauri-apps/plugin-barcode-scanner');
      const permission = await requestPermissions();
      if (permission !== 'granted') throw new Error('请允许相机权限后重试扫码');
      setScanning(true);
      await new Promise(resolve => window.setTimeout(resolve, 80));
      const scanned = await scan({ windowed: true });
      setScanning(false);
      if (scanned.format !== Format.QRCode) throw new Error('请对准桌面端的配对二维码');
      await claimPairing(scanned.content);
    } catch (error) {
      if (!errorText(error).toLowerCase().includes('cancelled')) setPairingError(errorText(error));
    } finally { setScanning(false); }
  }

  async function closeScanner() {
    try {
      const { cancel } = await import('@tauri-apps/plugin-barcode-scanner');
      await cancel();
    } catch { /* The scanner may already have finished. */ }
    setScanning(false);
  }

  function revealLoginField(event: FocusEvent<HTMLInputElement>) {
    const field = event.currentTarget;
    window.setTimeout(() => field.scrollIntoView({ block: 'center', behavior: 'smooth' }), 220);
  }

  function startChat() {
    const session: ChatSession = { id: crypto.randomUUID(), title: '新对话', updatedAt: Date.now(), messages: [] };
    setSessions(current => [session, ...current]);
    setActiveId(session.id);
    setDraft('');
    setChatError(null);
    setView('chat');
  }
  function openChat(id: string) { setActiveId(id); setDraft(''); setChatError(null); setView('chat'); }
  function deleteChat(id: string) {
    if (!window.confirm('删除这段保存在手机上的对话？')) return;
    setSessions(current => current.filter(session => session.id !== id));
    if (activeId === id) { setActiveId(null); setView('conversations'); }
  }

  function persistSync(next: SyncState) {
    syncState.current = next;
    setTurns(next.pendingTurns);
    if (accountId.current) saveSyncState(accountId.current, next);
  }

  function rememberTurn(turn: PendingTurn) {
    persistSync(upsertPendingTurn(syncState.current, turn));
  }

  function markLocalSeq(sessionId: string, messageId: string, seq: number) {
    setSessions(current => current.map(session => session.id === sessionId ? {
      ...session, messages: session.messages.map(message => message.id === messageId ? { ...message, seq } : message),
    } : session));
  }

  async function refreshSharedSessions() {
    const owner = accountId.current;
    const deviceId = localStorage.getItem(deviceKey(owner ?? ''));
    if (!owner || !deviceId || syncing.current) return;
    syncing.current = true;
    try {
      type ListedSession = { id: string; title: string; latestSeq: number; cursor: string };
      const allSessions: ListedSession[] = [];
      let beforeCursor: string | undefined;
      let beforeId: string | undefined;
      for (;;) {
        const page = await invoke<{ sessions: ListedSession[] }>('bridge_list_sessions', {
          mobileDeviceId: deviceId, beforeCursor, beforeId,
        });
        if (owner !== accountId.current) return;
        allSessions.push(...page.sessions);
        if (page.sessions.length < 100) break;
        const last = page.sessions.at(-1)!;
        if (last.cursor === beforeCursor && last.id === beforeId) break;
        beforeCursor = last.cursor;
        beforeId = last.id;
      }
      if (owner !== accountId.current) return;
      const known = new Map(allSessions.map(item => [item.id, item.title]));
      const pendingMessageIds = new Set(syncState.current.pendingTurns.map(turn => turn.userMessageId));
      for (const local of sessionsRef.current) {
        const sharedTitle = known.get(local.id);
        if (sharedTitle === undefined) {
          await invoke('bridge_create_session', { sessionId: local.id, title: local.title });
          known.set(local.id, local.title);
        } else if (sharedTitle !== local.title) {
          setSessions(current => current.map(session => session.id === local.id ? { ...session, title: sharedTitle } : session));
        }
        for (const message of local.messages.filter(item => item.seq === undefined && !pendingMessageIds.has(item.id))) {
          const ack = await invoke<{ message: { seq: number } }>('bridge_append_message', { sessionId: local.id, messageId: message.id, role: message.role, content: message.content });
          markLocalSeq(local.id, message.id, ack.message.seq);
        }
      }
      for (const item of allSessions) {
        let cursor = syncState.current.cursors[item.id] ?? 0;
        while (cursor < item.latestSeq) {
          const page = await invoke<{ messages: SharedMessage[] }>('bridge_messages', { sessionId: item.id, afterSeq: cursor });
          if (!page.messages.length) break;
          const local = sessionsRef.current.find(session => session.id === item.id) ?? { id: item.id, title: item.title, updatedAt: Date.now(), messages: [] };
          const merged = mergeSharedMessages(local, page.messages, cursor);
          cursor = merged.afterSeq;
          setSessions(current => {
            const existing = current.find(session => session.id === item.id);
            const next = mergeSharedMessages(existing ?? local, page.messages, syncState.current.cursors[item.id] ?? 0).session;
            return existing ? current.map(session => session.id === item.id ? next : session) : [next, ...current];
          });
          persistSync({ ...syncState.current, cursors: { ...syncState.current.cursors, [item.id]: cursor } });
          if (page.messages.length < 100) break;
        }
      }
      for (const turn of syncState.current.pendingTurns.filter(item => item.status !== 'failed' && !item.taskId && item.contextMessages?.length)) {
        void runChat(turn.sessionId, turn.contextMessages ?? []);
      }
    } catch { /* A bound conversation waits for the coordinator to return. */ }
    finally { syncing.current = false; }
  }

  async function finishTurn(turn: PendingTurn, text: string) {
    if (syncState.current.answeredTurns.includes(turn.turnId)) return;
    const owner = accountId.current;
    if (!owner) return;
    rememberTurn({ ...turn, finalText: text, status: 'summarizing' });
    const ack = await invoke<{ message: { seq: number } }>('bridge_append_message', { sessionId: turn.sessionId, messageId: turn.assistantMessageId, role: 'assistant', content: text });
    if (owner !== accountId.current) return;
    setSessions(current => current.map(session => session.id === turn.sessionId ? {
      ...session, updatedAt: Date.now(), messages: session.messages.some(message => message.id === turn.assistantMessageId) ?
        session.messages.map(message => message.id === turn.assistantMessageId ? { ...message, seq: ack.message.seq } : message) :
        [...session.messages, { id: turn.assistantMessageId, role: 'assistant' as const, content: text, seq: ack.message.seq }],
    } : session));
    await invoke('bridge_complete_turn', { sessionId: turn.sessionId, turnId: turn.turnId, status: 'completed' });
    persistSync(markTurnAnswered(syncState.current, turn.turnId));
  }

  async function resumeTask(turn: PendingTurn, task: RemoteTask) {
    if (processingTurns.current.has(turn.turnId) || syncState.current.answeredTurns.includes(turn.turnId)) return;
    if (!turn.callId || !turn.responseItems || !turn.contextMessages) return;
    processingTurns.current.add(turn.turnId);
    rememberTurn({ ...turn, status: 'summarizing' });
    try {
      const result = task.status === 'failed' ? `电脑执行失败：${task.result ?? '未知错误'}` : task.result ?? '';
      const text = turn.finalText ?? await invoke<string>('mobile_chat_continue', {
        messages: turn.contextMessages.slice(-24).map(({ role, content }) => ({ role, content })),
        callId: turn.callId, responseItems: turn.responseItems, desktopResult: result,
      });
      await finishTurn(turn, text);
    } catch (error) {
      const current = syncState.current.pendingTurns.find(item => item.turnId === turn.turnId) ?? turn;
      rememberTurn({ ...current, status: 'failed' });
      if (activeId === turn.sessionId) setChatError({ id: turn.sessionId, text: errorText(error) });
    } finally { processingTurns.current.delete(turn.turnId); }
  }

  async function runChat(id: string, messages: ChatMessage[]) {
    const owner = accountId.current;
    if (!owner || !messages.length) return;
    const bound = devices.length > 0;
    let turn = syncState.current.pendingTurns.find(item => item.sessionId === id && item.userMessageId === messages.at(-1)?.id);
    if (turn && processingTurns.current.has(turn.turnId)) return;
    if (turn?.finalText) { await finishTurn(turn, turn.finalText); return; }
    if (turn?.taskId) {
      const done = tasks.find(task => task.id === turn?.taskId && (task.status === 'succeeded' || task.status === 'failed'));
      if (done) await resumeTask(turn, done);
      return;
    }
    if (turn?.callId && turn.goal) {
      void queueDesktopTask(turn);
      return;
    }
    setSending(true);
    setChatError(null);
    if (bound && !turn) {
      turn = { sessionId: id, turnId: crypto.randomUUID(), userMessageId: messages.at(-1)!.id,
        assistantMessageId: crypto.randomUUID(), contextMessages: messages, status: 'queued' };
      rememberTurn(turn);
    }
    let processingTurnId = turn?.turnId;
    if (processingTurnId) processingTurns.current.add(processingTurnId);
    let heartbeat: number | undefined;
    try {
      if (turn) {
        const session = sessionsRef.current.find(item => item.id === id);
        await invoke('bridge_create_session', { sessionId: id, title: session?.title ?? messages[0].content.slice(0, 22) });
        let started = await invoke<{ message: { seq: number }; turn: { status: string } }>('bridge_start_turn', {
          sessionId: id, turnId: turn.turnId, messageId: turn.userMessageId, content: messages.at(-1)!.content,
        });
        if (started.turn.status === 'completed') {
          persistSync(markTurnAnswered(syncState.current, turn.turnId));
          void refreshSharedSessions();
          return;
        }
        if (started.turn.status === 'failed') {
          const nextTurnId = crypto.randomUUID();
          persistSync(restartPendingTurn(syncState.current, turn, nextTurnId));
          processingTurns.current.delete(turn.turnId);
          processingTurns.current.add(nextTurnId);
          processingTurnId = nextTurnId;
          turn = { ...turn, turnId: nextTurnId, status: 'queued' };
          started = await invoke<{ message: { seq: number }; turn: { status: string } }>('bridge_start_turn', {
            sessionId: id, turnId: nextTurnId, messageId: turn.userMessageId, content: messages.at(-1)!.content,
          });
        }
        if (started.turn.status !== 'active') throw new Error('会话轮次已结束，请重试');
        markLocalSeq(id, turn.userMessageId, started.message.seq);
        rememberTurn({ ...turn, status: 'thinking' });
        heartbeat = window.setInterval(() => { void invoke('bridge_turn_heartbeat', { sessionId: id, turnId: turn!.turnId }).catch(() => undefined); }, 60_000);
      }
      const device = devices.find(item => item.desktopDeviceId === selectedDesktopId) ?? devices[0];
      const decision = await invoke<ChatDecision>('mobile_chat', {
        messages: messages.slice(-24).map(({ role, content }) => ({ role, content })), desktopAvailable: !!turn && !!device,
      });
      if (owner !== accountId.current) return;
      if (decision.kind === 'text') {
        if (turn) await finishTurn(turn, decision.text);
        else setSessions(current => current.map(session => session.id === id ? {
          ...session, updatedAt: Date.now(), messages: [...session.messages, { id: crypto.randomUUID(), role: 'assistant', content: decision.text }],
        } : session));
      } else if (turn && device) {
        const next = { ...turn, callId: decision.call_id, goal: decision.goal,
          responseItems: decision.response_items, taskRequestKey: turn.taskRequestKey ?? crypto.randomUUID(), status: 'working' as const };
        rememberTurn(next);
        peerRef.current?.hint();
        void queueDesktopTask(next);
      } else { throw new Error('请先绑定 Windows 电脑再执行此任务'); }
    } catch (error) {
      if (turn) {
        const current = syncState.current.pendingTurns.find(item => item.turnId === turn!.turnId) ?? turn;
        rememberTurn({ ...current, status: current.finalText || current.callId ? 'failed' : 'queued' });
      }
      if (owner === accountId.current) setChatError({ id, text: errorText(error) });
    } finally {
      if (heartbeat !== undefined) window.clearInterval(heartbeat);
      if (processingTurnId) processingTurns.current.delete(processingTurnId);
      if (owner === accountId.current) setSending(false);
    }
  }

  async function queueDesktopTask(turn: PendingTurn) {
    if (!turn.callId || !turn.goal || queuingTasks.current.has(turn.turnId)) return;
    const device = devices.find(item => item.desktopDeviceId === selectedDesktopId) ?? devices[0];
    if (!device) return;
    queuingTasks.current.add(turn.turnId);
    const key = turn.taskRequestKey ?? crypto.randomUUID();
    try {
      rememberTurn({ ...turn, taskRequestKey: key, status: 'working' });
      const result = await invoke<{ task: { id: string } }>('bridge_create_task', {
        sessionId: turn.sessionId, desktopDeviceId: device.desktopDeviceId,
        mobileDeviceId: device.mobileDeviceId, idempotencyKey: key, prompt: turn.goal,
        turnId: turn.turnId, toolCallId: turn.callId,
      });
      rememberTurn({ ...turn, taskRequestKey: key, taskId: result.task.id, status: 'working' });
      peerRef.current?.hint();
      await refreshTasks();
    } catch (error) {
      rememberTurn({ ...turn, taskRequestKey: key, status: errorText(error).includes('409') ? 'failed' : 'queued' });
      setChatError({ id: turn.sessionId, text: errorText(error) });
    } finally { queuingTasks.current.delete(turn.turnId); }
  }

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || sending || activePending || !draft.trim()) return;
    const text = draft.trim();
    const messages: ChatMessage[] = [...active.messages, { id: crypto.randomUUID(), role: 'user', content: text }];
    setSessions(current => current.map(session => session.id === active.id ? {
      ...session, title: session.messages.length ? session.title : text.slice(0, 22), updatedAt: Date.now(), messages,
    } : session));
    setDraft('');
    void runChat(active.id, messages);
  }

  function renderChatMessages(session: ChatSession) {
    const events = taskEvents[session.id] ?? [];
    const cardsAfter = (messageId: string) => [...new Set(events
      .filter(event => event.initiatingMessageId === messageId).map(event => event.taskId))]
      .map(taskId => <TaskEventCard key={taskId} taskId={taskId} events={events}
        task={tasks.find(task => task.id === taskId)} />);
    const knownMessages = new Set(session.messages.map(message => message.id));
    const orphanCards = [...new Set(events
      .filter(event => !event.initiatingMessageId || !knownMessages.has(event.initiatingMessageId))
      .map(event => event.taskId))]
      .map(taskId => <TaskEventCard key={taskId} taskId={taskId} events={events}
        task={tasks.find(task => task.id === taskId)} />);
    return <>{session.messages.map(message => <Fragment key={message.id}>
      {message.role === 'user'
        ? <div className="message user-message">{message.content}</div>
        : <div className="agent-message"><div className="agent-label"><Icon name="spark" size={14} /> 小亨</div><div className="message assistant-message">{message.content}</div></div>}
      {message.role === 'user' && cardsAfter(message.id)}
    </Fragment>)}{orphanCards}</>;
  }

  if (booting) return <div className="launch"><span className="brand-mark">H</span><b>Harmony Work</b></div>;
  if (!account) return <main className="login-page"><div className="login-aura" /><div className="login-brand"><span className="brand-mark">H</span><b>Harmony Work</b></div><div className="login-copy"><span>WORK FROM ANYWHERE</span><h1>带上小亨，<br />工作随时继续。</h1><p>手机直接开始对话；需要电脑环境时，小亨会在同一会话中调用已授权桌面端。</p></div><form className="login-card" onSubmit={signIn}><div className="login-card-heading"><span className="icon-tile purple"><Icon name="lock" /></span><div><h2>登录个人账户</h2><p>同步你的加密模型配置</p></div></div><label htmlFor="email">邮箱</label><input id="email" type="email" value={email} onFocus={revealLoginField} onChange={event => setEmail(event.target.value)} autoComplete="username" placeholder="你的账户邮箱" required /><label htmlFor="password">密码</label><input id="password" type="password" value={password} onFocus={revealLoginField} onChange={event => setPassword(event.target.value)} autoComplete="current-password" placeholder="输入账户密码" required />{loginError && <p className="form-error" role="alert">{loginError}</p>}<button className="primary-button" type="submit" disabled={loggingIn}>{loggingIn ? '正在登录并解锁…' : '登录并解锁设置'} <Icon name="arrow" size={18} /></button><p className="privacy-note">API Key 仅在本机解密，并由 Android 安全存储加密保存。</p></form></main>;

  if (scanning) return <div className="scanner-screen" role="dialog" aria-modal="true" aria-label="扫描配对二维码"><div className="scanner-top"><button className="scanner-close" onClick={() => void closeScanner()} aria-label="返回连接电脑">← 返回</button><b>扫描电脑配对码</b></div><div className="scanner-guide"><div className="scanner-frame"><span /><span /><span /><span /></div><p>将桌面端的二维码放入框内，识别后自动连接</p></div><div className="scanner-bottom"><button onClick={() => void closeScanner()}>取消扫码</button><span>无法识别？返回后可粘贴配对内容</span></div></div>;

  return <div className="app-shell"><main className={`app-content ${view === 'chat' ? 'chat-content' : ''}`}>
    {view === 'home' && <div className="page-enter"><header className="home-header"><div className="top-row"><div className="app-brand"><span className="brand-mark">H</span><b>Harmony Work</b></div><button className="avatar-button" onClick={() => setView('mine')} aria-label="我的账户">{account.name.slice(0, 1)}</button></div><div className="greeting"><span>欢迎回来，{account.name}</span><h1>今天想和<span>小亨</span>做什么？</h1></div></header><div className="home-body"><section className="hero-card"><div className="hero-top"><span>YOUR WORKSPACE</span><span className="hero-status">手机已就绪</span></div><h2>一个会话开始，<br />手机电脑协作完成。</h2><p>小亨在手机上理解需求，按需调用已绑定电脑执行，并在同一会话里给出答复。</p><button onClick={startChat}>开始对话 <Icon name="arrow" size={17} /></button></section><div className="section-heading"><h2>快捷开始</h2><span>按需进入</span></div><div className="quick-grid"><button className="quick-card" onClick={() => setSheet('harvis')}><span className="icon-tile peach"><Icon name="image" /></span><b>Harvis 生图</b><small>图片创作入口</small></button><button className="quick-card" onClick={() => setView('tasks')}><span className="icon-tile blue"><Icon name="tasks" /></span><b>我的任务</b><small>查看远端接入进度</small></button><button className="quick-card" onClick={() => setSheet('skills')}><span className="icon-tile purple"><Icon name="puzzle" /></span><b>技能管理</b><small>远程技能入口</small></button><button className="quick-card" onClick={() => setSheet('memory')}><span className="icon-tile green"><Icon name="memory" /></span><b>记忆</b><small>个人记忆入口</small></button></div><div className="section-heading"><h2>最近对话</h2><button onClick={() => setView('conversations')}>查看全部 <Icon name="arrow" size={15} /></button></div>{sorted.length ? <button className="recent-card" onClick={() => openChat(sorted[0].id)}><span className="icon-tile purple"><Icon name="chat" /></span><span><b>{sorted[0].title}</b><small>{sorted[0].messages.at(-1)?.content.slice(0, 35) || '刚创建的对话'}</small></span><Icon name="arrow" size={17} /></button> : <button className="recent-empty" onClick={startChat}>还没有对话。和小亨说第一句话 <Icon name="arrow" size={16} /></button>}<div className="section-heading"><h2>我的设备</h2></div><button className="device-card" onClick={() => setSheet('device')}><span className="icon-tile gray"><Icon name="monitor" /></span><span><b>{devices.length ? devices[0].desktopName : "电脑尚未连接"}</b><small>{devices.length ? `已绑定 · ${peerState === 'direct' ? 'P2P 直连' : '服务器保障'}` : "手机对话可独立使用"}</small></span><Icon name="arrow" size={17} /></button></div></div>}
    {view === 'conversations' && <div className="page-enter"><header className="page-header"><h1>对话</h1><button className="icon-button" onClick={startChat} aria-label="新建对话"><Icon name="plus" /></button></header><div className="page-body"><p className="section-caption">最近对话</p>{sorted.length ? sorted.map(session => <div className="conversation-row" key={session.id}><button onClick={() => openChat(session.id)}><span className="icon-tile purple"><Icon name="chat" /></span><span className="conversation-text"><b>{session.title}</b><small>{session.messages.at(-1)?.content.slice(0, 45) || '开始和小亨交流'}</small></span><time>{dateLabel(session.updatedAt)}</time></button><button className="row-delete" onClick={() => deleteChat(session.id)} aria-label={`删除${session.title}`}><Icon name="trash" size={17} /></button></div>) : <div className="empty-state"><span className="icon-tile purple"><Icon name="chat" /></span><h2>从一个想法开始</h2><p>和小亨讨论、整理、规划。手机不连接电脑也能使用。</p><button className="primary-button" onClick={startChat}>开始新对话 <Icon name="arrow" size={17} /></button></div>}</div></div>}
    {view === 'chat' && active && <div className="chat-page page-enter"><header className="chat-header"><button className="icon-button plain" onClick={() => setView('conversations')} aria-label="返回对话列表"><Icon name="back" /></button><div><h1>{active.title}</h1><span><i className="green-dot" />小亨 · {devices.length ? "双端共享" : "手机对话"}</span></div><button className="icon-button plain" onClick={() => deleteChat(active.id)} aria-label="删除对话"><Icon name="trash" size={19} /></button></header><div className="messages"><div className="chat-date">{devices.length ? "双端共享会话" : "手机本地会话"}</div>{active.messages.length === 0 && <div className="chat-welcome"><span className="agent-symbol"><Icon name="spark" size={22} /></span><h2>你好，我是小亨。</h2><p>可以聊想法、整理资料、拟定计划。需要电脑环境时，我会在这个会话中调用已绑定的 Windows 电脑，并回来给你答复。</p></div>}{renderChatMessages(active)}{sending && <div className="agent-message"><div className="agent-label"><Icon name="spark" size={14} /> 小亨</div><div className="message assistant-message typing" aria-label="小亨正在回复"><span /><span /><span /></div></div>}{activePending && <div className="retry-panel" role="status"><span>{chatError?.id === active.id ? chatError.text : activePending.status === "queued" ? "等待同步并开始处理…" : activePending.status === "working" ? "电脑正在执行，完成后小亨会在这里回复。" : activePending.status === "summarizing" ? "电脑已返回，小亨正在整理答复…" : activePending.status === "failed" ? "处理暂停，可重试。" : "小亨正在思考…"}</span>{activePending.status === "failed" || activePending.status === "queued" ? <button onClick={() => void runChat(active.id, activePending.contextMessages ?? active.messages)}>重试</button> : null}</div>}{!activePending && !sending && active.messages.at(-1)?.role === "user" && <div className="retry-panel" role="status"><span>{chatError?.id === active.id ? chatError.text : "这条消息尚未收到回复。"}</span><button onClick={() => void runChat(active.id, active.messages)}>重试</button></div>}<div ref={chatEnd} /></div><form className="composer" onSubmit={sendMessage}><textarea aria-label="给小亨发送消息" value={draft} onChange={event => setDraft(event.target.value)} placeholder={activePending ? "等待上一轮完成后继续对话…" : "给小亨发送消息…"} maxLength={8000} rows={2} disabled={sending || !!activePending} /><div className="composer-bottom"><span><Icon name="spark" size={14} /> 小亨按需调用电脑</span><button type="submit" disabled={sending || !!activePending || !draft.trim()} aria-label="发送消息"><Icon name="send" size={19} /></button></div></form></div>}
    {view === 'tasks' && <div className="page-enter"><header className="page-header"><h1>任务</h1></header><div className="page-body"><section className="remote-panel"><span className="section-caption">会话中的电脑工作</span><h2>在同一个会话中完成</h2><p>向小亨正常发送消息。需要电脑环境时，小亨会调用已绑定的 Windows 电脑，并把结果整理回原会话。</p>{!devices.length && <button className="secondary-button" onClick={() => setSheet('device')}>连接 Windows 电脑 <Icon name="arrow" size={17} /></button>}</section><div className="section-heading"><h2>执行进度</h2><button onClick={() => void refreshTasks()}>刷新</button></div>{tasks.length ? tasks.map(task => <button className="remote-task-card task-link" key={task.id} onClick={() => openChat(task.sessionId)}><div><b>{task.prompt}</b><span className={`task-status status-${task.status}`}>{task.status === 'succeeded' ? '已完成' : task.status === 'failed' ? '执行失败' : task.status === 'cancelled' ? '已取消' : task.status === 'claimed' ? '执行中' : '等待电脑'}</span></div><small>查看原会话 →</small></button>) : <p className="muted-note">暂无电脑任务。直接开始对话，小亨会判断何时需要电脑。</p>}</div></div>}
    {view === 'mine' && <div className="page-enter"><header className="page-header"><h1>我的</h1></header><div className="profile-card"><span className="profile-avatar">{account.name.slice(0, 1)}</span><div><b>{account.name}</b><small>{account.email}</small></div></div><div className="page-body"><p className="section-caption">账户与配置</p><div className="setting-card"><span className="icon-tile purple"><Icon name="lock" /></span><div><b>加密模型配置</b><small>Harmony Responses · {account.model}</small></div><span className="configured"><Icon name="check" size={14} /> 已解锁</span></div><button className="setting-card" onClick={() => setSheet('device')}><span className="icon-tile gray"><Icon name="monitor" /></span><div><b>已连接设备</b><small>{devices.length ? `已绑定 ${devices.length} 台电脑` : "当前未连接电脑"}</small></div><Icon name="arrow" size={17} /></button><p className="section-caption spaced">小亨能力</p><button className="setting-card" onClick={() => setSheet('skills')}><span className="icon-tile purple"><Icon name="puzzle" /></span><div><b>技能管理</b><small>远程管理尚未接入</small></div><Icon name="arrow" size={17} /></button><button className="setting-card" onClick={() => setSheet('memory')}><span className="icon-tile green"><Icon name="memory" /></span><div><b>记忆</b><small>跨端记忆尚未接入</small></div><Icon name="arrow" size={17} /></button><button className="logout-button" onClick={() => void signOut()}>退出登录</button></div></div>}
  </main><nav className="bottom-nav" aria-label="主导航"><button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}><Icon name="home" />首页</button><button className={view === 'conversations' || view === 'chat' ? 'active' : ''} onClick={() => setView('conversations')}><Icon name="chat" />对话</button><button className={view === 'tasks' ? 'active' : ''} onClick={() => setView('tasks')}><Icon name="tasks" />任务</button><button className={view === 'mine' ? 'active' : ''} onClick={() => setView('mine')}><Icon name="user" />我的</button></nav>
  {sheet && <div className="sheet-backdrop" onClick={event => { if (event.target === event.currentTarget) setSheet(null); }}><section className="feature-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div className="sheet-handle" /><button className="icon-button sheet-close" onClick={() => setSheet(null)} aria-label="关闭"><Icon name="close" size={19} /></button><span className="icon-tile purple"><Icon name={features[sheet].icon} size={23} /></span><h2 id="sheet-title">{features[sheet].title}</h2><p>{features[sheet].intro}</p>{sheet === 'device' ? <div className="pairing-panel"><p className="muted-note">{features.device.detail}</p><button className="secondary-button" onClick={() => void scanPairing()} disabled={pairingBusy}>扫描桌面二维码</button><label htmlFor="pairing-code">或粘贴桌面端复制的完整配对内容</label><textarea id="pairing-code" value={pairingText} onChange={event => setPairingText(event.target.value)} placeholder="harmonywork://pair?id=…&secret=…" rows={2} /><button className="primary-button" onClick={() => void claimPairing(pairingText)} disabled={pairingBusy || !pairingText.trim()}>{pairingBusy ? '正在绑定…' : '绑定电脑'}</button>{pairingError && <p className="form-error" role="alert">{pairingError}</p>}{devices.length > 0 && <div className="linked-devices"><b>已绑定设备</b>{devices.map(device => <div className="linked-device-row" key={device.desktopDeviceId}><span><Icon name="monitor" size={17} /> {device.desktopName}</span><button type="button" className="linked-device-remove" onClick={() => void unlinkDesktop(device)} disabled={unlinkingDesktopId === device.desktopDeviceId} aria-label={`解除与${device.desktopName}的绑定`}>{unlinkingDesktopId === device.desktopDeviceId ? "解除中…" : "解除绑定"}</button></div>)}<label htmlFor="preferred-desktop">默认执行电脑</label><select id="preferred-desktop" value={selectedDesktopId} onChange={event => { setSelectedDesktopId(event.target.value); if (accountId.current) localStorage.setItem(preferredDesktopKey(accountId.current), event.target.value); }}>{devices.map(device => <option key={device.desktopDeviceId} value={device.desktopDeviceId}>{device.desktopName} · {device.desktopDeviceId.slice(0, 6)}</option>)}</select></div>}</div> : <><div className="availability"><b>接入状态</b><span>{features[sheet].detail}</span></div><button className="primary-button" onClick={() => setSheet(null)}>知道了</button></>}</section></div>}
  </div>;
}

export default App;
