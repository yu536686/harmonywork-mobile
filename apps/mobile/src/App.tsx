import { useEffect, useRef, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icon, type IconName } from './Icon.tsx';
import { parsePairingCode, type LinkedDevice, type RemoteTask } from './bridge.ts';
import { BridgePeer, type BridgeSignal } from './bridgePeer.ts';
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
  const [tasks, setTasks] = useState<RemoteTask[]>([]);
  const [pairingText, setPairingText] = useState('');
  const [pairingError, setPairingError] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [taskPrompt, setTaskPrompt] = useState('');
  const [taskSessionId, setTaskSessionId] = useState<string | null>(null);
  const [taskError, setTaskError] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
  const [selectedDesktopId, setSelectedDesktopId] = useState('');
  const [peerState, setPeerState] = useState<'connecting' | 'direct' | 'fallback'>('fallback');
  const peerRef = useRef<BridgePeer | null>(null);
  const pendingTask = useRef<{ sessionId: string; idempotencyKey: string; prompt: string } | null>(null);
  const chatEnd = useRef<HTMLDivElement | null>(null);
  const active = sessions.find(session => session.id === activeId) ?? null;
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

  useEffect(() => {
    invoke<AccountView | null>('mobile_account').then(current => {
      if (current) {
        accountId.current = current.id;
        setSessions(loadSessions(current.id));
        setAccount(current);
      }
    }).catch(() => undefined).finally(() => setBooting(false));
  }, []);
  useEffect(() => { if (account) saveSessions(account.id, sessions); }, [account, sessions]);
  useEffect(() => {
    if (!account) return;
    const timer = window.setTimeout(() => {
      for (const session of sessions) {
        void invoke('bridge_sync_session', { session }).catch(() => undefined);
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [account, sessions]);
  useEffect(() => {
    if (!account) return;
    void refreshDevices();
    void refreshTasks();
    const timer = window.setInterval(() => { void refreshTasks(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [account?.id]);
  useEffect(() => {
    const device = devices.find(item => item.desktopDeviceId === selectedDesktopId);
    if (!account || !device || typeof RTCPeerConnection === 'undefined') return;
    const peer = new BridgePeer({
      desktopDeviceId: device.desktopDeviceId, mobileDeviceId: device.mobileDeviceId,
      localDeviceId: device.mobileDeviceId, remoteDeviceId: device.desktopDeviceId, initiator: false,
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
      setSessions(loadSessions(current.id));
      setAccount(current);
      setView('home');
      setSending(false);
    } catch (error) { setLoginError(errorText(error)); }
    finally { setPassword(''); setLoggingIn(false); }
  }

  async function signOut() {
    await invoke('mobile_logout').catch(() => undefined);
    accountId.current = null;
    setAccount(null);
    setSessions([]);
    setActiveId(null);
    setDraft('');
    setSending(false);
    setChatError(null);
    setDevices([]);
    setTasks([]);
    pendingTask.current = null;
    setView('home');
  }

  async function refreshDevices() {
    try {
      const result = await invoke<{ devices: LinkedDevice[] }>('bridge_devices');
      setDevices(result.devices);
      setSelectedDesktopId(current => result.devices.some(device => device.desktopDeviceId === current)
        ? current : result.devices[0]?.desktopDeviceId ?? '');
    } catch { setDevices([]); }
  }

  async function refreshTasks() {
    try {
      const result = await invoke<{ tasks: RemoteTask[] }>('bridge_tasks');
      setTasks(result.tasks);
      setSessions(current => {
        let changed = false;
        const next = current.map(session => {
          const completed = result.tasks.filter(task => task.sessionId === session.id && task.status === 'succeeded' && task.result);
          const fresh = completed.filter(task => !session.messages.some(message => message.id === task.id));
          if (!fresh.length) return session;
          changed = true;
          return { ...session, updatedAt: Date.now(), messages: [...session.messages, ...fresh.map(task => ({ id: task.id, role: 'assistant' as const, content: task.result! }))] };
        });
        return changed ? next : current;
      });
    } catch { /* The local conversation remains available while the bridge is offline. */ }
  }

  async function claimPairing(raw: string) {
    setPairingBusy(true);
    setPairingError('');
    try {
      const { pairingId, secret } = parsePairingCode(raw);
      await invoke('bridge_claim_pairing', { pairingId, secret, mobileName: 'Harmony Work Android' });
      setPairingText('');
      await refreshDevices();
      setSheet(null);
    } catch (error) { setPairingError(errorText(error)); }
    finally { setPairingBusy(false); }
  }

  async function scanPairing() {
    setPairingError('');
    try {
      const { scan, Format, requestPermissions } = await import('@tauri-apps/plugin-barcode-scanner');
      await requestPermissions();
      const scanned = await scan({ formats: [Format.QRCode] });
      await claimPairing(scanned.content);
    } catch (error) { setPairingError(errorText(error)); }
  }

  async function submitRemoteTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const prompt = taskPrompt.trim();
    const device = devices.find(item => item.desktopDeviceId === selectedDesktopId);
    if (!prompt || !device) { setTaskError('请先绑定并选择一台 Windows 电脑'); return; }
    setTaskBusy(true);
    setTaskError('');
    try {
      const request = pendingTask.current?.prompt === prompt ? pendingTask.current : {
        sessionId: taskSessionId ?? crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), prompt,
      };
      pendingTask.current = request;
      const existing = sessions.find(item => item.id === request.sessionId);
      const taskMessage: ChatMessage = { id: request.idempotencyKey, role: 'user', content: prompt };
      const session: ChatSession = existing ? {
        ...existing, updatedAt: Date.now(),
        messages: existing.messages.some(message => message.id === taskMessage.id) ? existing.messages : [...existing.messages, taskMessage],
      } : {
        id: request.sessionId, title: prompt.slice(0, 22), updatedAt: Date.now(), messages: [taskMessage],
      };
      await invoke('bridge_sync_session', { session });
      await invoke('bridge_create_task', {
        sessionId: request.sessionId,
        desktopDeviceId: device.desktopDeviceId,
        mobileDeviceId: device.mobileDeviceId,
        idempotencyKey: request.idempotencyKey,
        prompt,
      });
      setSessions(current => current.some(item => item.id === session.id) ? current.map(item => item.id === session.id ? session : item) : [session, ...current]);
      pendingTask.current = null;
      peerRef.current?.hint();
      setTaskPrompt('');
      setTaskSessionId(null);
      await refreshTasks();
    } catch (error) { setTaskError(errorText(error)); }
    finally { setTaskBusy(false); }
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

  async function runChat(id: string, messages: ChatMessage[]) {
    const owner = accountId.current;
    if (!owner) return;
    setSending(true);
    setChatError(null);
    try {
      const reply = await invoke<string>('mobile_chat', { messages: messages.slice(-24).map(({ role, content }) => ({ role, content })) });
      if (accountId.current !== owner) return;
      setSessions(current => current.map(session => session.id === id ? {
        ...session, updatedAt: Date.now(), messages: [...session.messages, { id: crypto.randomUUID(), role: 'assistant', content: reply }],
      } : session));
    } catch (error) {
      if (accountId.current === owner) setChatError({ id, text: errorText(error) });
    } finally { if (accountId.current === owner) setSending(false); }
  }
  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || sending || !draft.trim()) return;
    const text = draft.trim();
    const messages: ChatMessage[] = [...active.messages, { id: crypto.randomUUID(), role: 'user', content: text }];
    setSessions(current => current.map(session => session.id === active.id ? {
      ...session, title: session.messages.length ? session.title : text.slice(0, 22), updatedAt: Date.now(), messages,
    } : session));
    setDraft('');
    void runChat(active.id, messages);
  }

  if (booting) return <div className="launch"><span className="brand-mark">H</span><b>Harmony Work</b></div>;
  if (!account) return <main className="login-page"><div className="login-aura" /><div className="login-brand"><span className="brand-mark">H</span><b>Harmony Work</b></div><div className="login-copy"><span>WORK FROM ANYWHERE</span><h1>带上小亨，<br />工作随时继续。</h1><p>手机独立处理轻量对话；需要电脑环境的任务，随后交给已授权桌面端。</p></div><form className="login-card" onSubmit={signIn}><div className="login-card-heading"><span className="icon-tile purple"><Icon name="lock" /></span><div><h2>登录个人账户</h2><p>同步你的加密模型配置</p></div></div><label htmlFor="email">邮箱</label><input id="email" type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="username" placeholder="你的账户邮箱" required /><label htmlFor="password">密码</label><input id="password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" placeholder="输入账户密码" required />{loginError && <p className="form-error" role="alert">{loginError}</p>}<button className="primary-button" type="submit" disabled={loggingIn}>{loggingIn ? '正在登录并解锁…' : '登录并解锁设置'} <Icon name="arrow" size={18} /></button><p className="privacy-note">API Key 只在手机本地的 Rust 会话中解密，不会显示在界面中。</p></form></main>;

  return <div className="app-shell"><main className={`app-content ${view === 'chat' ? 'chat-content' : ''}`}>
    {view === 'home' && <div className="page-enter"><header className="home-header"><div className="top-row"><div className="app-brand"><span className="brand-mark">H</span><b>Harmony Work</b></div><button className="avatar-button" onClick={() => setView('mine')} aria-label="我的账户">{account.name.slice(0, 1)}</button></div><div className="greeting"><span>欢迎回来，{account.name}</span><h1>今天想和<span>小亨</span>做什么？</h1></div></header><div className="home-body"><section className="hero-card"><div className="hero-top"><span>YOUR WORKSPACE</span><span className="hero-status">手机已就绪</span></div><h2>想法随时开始，<br />轻量工作立即完成。</h2><p>小亨在手机上独立对话、整理与规划。需要电脑环境的工作会在设备连接后交接。</p><button onClick={startChat}>开始对话 <Icon name="arrow" size={17} /></button></section><div className="section-heading"><h2>快捷开始</h2><span>按需进入</span></div><div className="quick-grid"><button className="quick-card" onClick={() => setSheet('harvis')}><span className="icon-tile peach"><Icon name="image" /></span><b>Harvis 生图</b><small>图片创作入口</small></button><button className="quick-card" onClick={() => setView('tasks')}><span className="icon-tile blue"><Icon name="tasks" /></span><b>我的任务</b><small>查看远端接入进度</small></button><button className="quick-card" onClick={() => setSheet('skills')}><span className="icon-tile purple"><Icon name="puzzle" /></span><b>技能管理</b><small>远程技能入口</small></button><button className="quick-card" onClick={() => setSheet('memory')}><span className="icon-tile green"><Icon name="memory" /></span><b>记忆</b><small>个人记忆入口</small></button></div><div className="section-heading"><h2>最近对话</h2><button onClick={() => setView('conversations')}>查看全部 <Icon name="arrow" size={15} /></button></div>{sorted.length ? <button className="recent-card" onClick={() => openChat(sorted[0].id)}><span className="icon-tile purple"><Icon name="chat" /></span><span><b>{sorted[0].title}</b><small>{sorted[0].messages.at(-1)?.content.slice(0, 35) || '刚创建的对话'}</small></span><Icon name="arrow" size={17} /></button> : <button className="recent-empty" onClick={startChat}>还没有对话。和小亨说第一句话 <Icon name="arrow" size={16} /></button>}<div className="section-heading"><h2>我的设备</h2></div><button className="device-card" onClick={() => setSheet('device')}><span className="icon-tile gray"><Icon name="monitor" /></span><span><b>{devices.length ? devices[0].desktopName : "电脑尚未连接"}</b><small>{devices.length ? `已绑定 · ${peerState === 'direct' ? 'P2P 直连' : '服务器保障'}` : "手机对话可独立使用"}</small></span><Icon name="arrow" size={17} /></button></div></div>}
    {view === 'conversations' && <div className="page-enter"><header className="page-header"><h1>对话</h1><button className="icon-button" onClick={startChat} aria-label="新建对话"><Icon name="plus" /></button></header><div className="page-body"><p className="section-caption">最近对话</p>{sorted.length ? sorted.map(session => <div className="conversation-row" key={session.id}><button onClick={() => openChat(session.id)}><span className="icon-tile purple"><Icon name="chat" /></span><span className="conversation-text"><b>{session.title}</b><small>{session.messages.at(-1)?.content.slice(0, 45) || '开始和小亨交流'}</small></span><time>{dateLabel(session.updatedAt)}</time></button><button className="row-delete" onClick={() => deleteChat(session.id)} aria-label={`删除${session.title}`}><Icon name="trash" size={17} /></button></div>) : <div className="empty-state"><span className="icon-tile purple"><Icon name="chat" /></span><h2>从一个想法开始</h2><p>和小亨讨论、整理、规划。手机不连接电脑也能使用。</p><button className="primary-button" onClick={startChat}>开始新对话 <Icon name="arrow" size={17} /></button></div>}</div></div>}
    {view === 'chat' && active && <div className="chat-page page-enter"><header className="chat-header"><button className="icon-button plain" onClick={() => setView('conversations')} aria-label="返回对话列表"><Icon name="back" /></button><div><h1>{active.title}</h1><span><i className="green-dot" />小亨 · 手机独立对话</span></div><button className="icon-button plain" onClick={() => deleteChat(active.id)} aria-label="删除对话"><Icon name="trash" size={19} /></button></header><div className="messages"><div className="chat-date">手机端独立会话</div>{active.messages.length === 0 && <div className="chat-welcome"><span className="agent-symbol"><Icon name="spark" size={22} /></span><h2>你好，我是小亨。</h2><p>可以聊想法、整理资料、拟定计划。需要访问电脑文件或应用时，我会清楚告诉你。</p></div>}{active.messages.map(message => message.role === 'user' ? <div className="message user-message" key={message.id}>{message.content}</div> : <div className="agent-message" key={message.id}><div className="agent-label"><Icon name="spark" size={14} /> 小亨</div><div className="message assistant-message">{message.content}</div></div>)}{sending && <div className="agent-message"><div className="agent-label"><Icon name="spark" size={14} /> 小亨</div><div className="message assistant-message typing" aria-label="小亨正在回复"><span /><span /><span /></div></div>}{!sending && active.messages.at(-1)?.role === 'user' && <div className="retry-panel" role="status"><span>{chatError?.id === active.id ? chatError.text : '这条消息尚未收到回复。'}</span><button onClick={() => void runChat(active.id, active.messages)}>重试</button></div>}<div ref={chatEnd} /></div><form className="composer" onSubmit={sendMessage}><textarea aria-label="给小亨发送消息" value={draft} onChange={event => setDraft(event.target.value)} placeholder="给小亨发送消息…" maxLength={8000} rows={2} disabled={sending} /><div className="composer-bottom"><button type="button" className="handoff-button" onClick={() => { setTaskPrompt(draft.trim()); setTaskSessionId(active.id); setView("tasks"); }} disabled={!devices.length || !draft.trim()}>交给电脑</button><span><Icon name="spark" size={14} /> 手机处理</span><button type="submit" disabled={sending || !draft.trim()} aria-label="发送消息"><Icon name="send" size={19} /></button></div></form></div>}
    {view === 'tasks' && <div className="page-enter"><header className="page-header"><h1>远端任务</h1></header><div className="page-body"><section className="remote-panel"><span className="section-caption">交给电脑完成</span><h2>在手机规划，在 Windows 执行</h2><p>桌面端在线时会领取任务，结果会返回这里。请只将任务交给你信任的电脑。</p>{devices.length ? <form onSubmit={submitRemoteTask}><label htmlFor="remote-device">执行设备</label><select id="remote-device" value={selectedDesktopId} onChange={event => setSelectedDesktopId(event.target.value)}>{devices.map(device => <option key={device.desktopDeviceId} value={device.desktopDeviceId}>{device.desktopName}</option>)}</select><label htmlFor="remote-prompt">任务内容</label><textarea id="remote-prompt" value={taskPrompt} onChange={event => setTaskPrompt(event.target.value)} placeholder="例如：整理电脑上的项目周报并给出摘要" maxLength={8000} rows={4} required />{taskError && <p className="form-error" role="alert">{taskError}</p>}<button className="primary-button" type="submit" disabled={taskBusy || !taskPrompt.trim()}>{taskBusy ? '正在交接…' : '交给电脑执行'} <Icon name="arrow" size={17} /></button></form> : <button className="secondary-button" onClick={() => setSheet('device')}>先连接 Windows 电脑 <Icon name="arrow" size={17} /></button>}</section><div className="section-heading"><h2>任务进度</h2><button onClick={() => void refreshTasks()}>刷新</button></div>{tasks.length ? tasks.map(task => <article className="remote-task-card" key={task.id}><div><b>{task.prompt}</b><span className={`task-status status-${task.status}`}>{task.status === 'succeeded' ? '已完成' : task.status === 'failed' ? '执行失败' : task.status === 'claimed' ? '执行中' : '等待电脑'}</span></div>{task.result && <p>{task.result}</p>}</article>) : <p className="muted-note">暂无远端任务。手机上的轻量对话仍可独立使用。</p>}</div></div>}
    {view === 'mine' && <div className="page-enter"><header className="page-header"><h1>我的</h1></header><div className="profile-card"><span className="profile-avatar">{account.name.slice(0, 1)}</span><div><b>{account.name}</b><small>{account.email}</small></div></div><div className="page-body"><p className="section-caption">账户与配置</p><div className="setting-card"><span className="icon-tile purple"><Icon name="lock" /></span><div><b>加密模型配置</b><small>Harmony Responses · {account.model}</small></div><span className="configured"><Icon name="check" size={14} /> 已解锁</span></div><button className="setting-card" onClick={() => setSheet('device')}><span className="icon-tile gray"><Icon name="monitor" /></span><div><b>已连接设备</b><small>{devices.length ? `已绑定 ${devices.length} 台电脑` : "当前未连接电脑"}</small></div><Icon name="arrow" size={17} /></button><p className="section-caption spaced">小亨能力</p><button className="setting-card" onClick={() => setSheet('skills')}><span className="icon-tile purple"><Icon name="puzzle" /></span><div><b>技能管理</b><small>远程管理尚未接入</small></div><Icon name="arrow" size={17} /></button><button className="setting-card" onClick={() => setSheet('memory')}><span className="icon-tile green"><Icon name="memory" /></span><div><b>记忆</b><small>跨端记忆尚未接入</small></div><Icon name="arrow" size={17} /></button><button className="logout-button" onClick={() => void signOut()}>退出登录</button></div></div>}
  </main><nav className="bottom-nav" aria-label="主导航"><button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}><Icon name="home" />首页</button><button className={view === 'conversations' || view === 'chat' ? 'active' : ''} onClick={() => setView('conversations')}><Icon name="chat" />对话</button><button className={view === 'tasks' ? 'active' : ''} onClick={() => setView('tasks')}><Icon name="tasks" />任务</button><button className={view === 'mine' ? 'active' : ''} onClick={() => setView('mine')}><Icon name="user" />我的</button></nav>
  {sheet && <div className="sheet-backdrop" onClick={event => { if (event.target === event.currentTarget) setSheet(null); }}><section className="feature-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div className="sheet-handle" /><button className="icon-button sheet-close" onClick={() => setSheet(null)} aria-label="关闭"><Icon name="close" size={19} /></button><span className="icon-tile purple"><Icon name={features[sheet].icon} size={23} /></span><h2 id="sheet-title">{features[sheet].title}</h2><p>{features[sheet].intro}</p>{sheet === 'device' ? <div className="pairing-panel"><p className="muted-note">{features.device.detail}</p><button className="secondary-button" onClick={() => void scanPairing()} disabled={pairingBusy}>扫描桌面二维码</button><label htmlFor="pairing-code">或粘贴配对内容</label><textarea id="pairing-code" value={pairingText} onChange={event => setPairingText(event.target.value)} placeholder="harmonywork://pair?id=…" rows={2} /><button className="primary-button" onClick={() => void claimPairing(pairingText)} disabled={pairingBusy || !pairingText.trim()}>{pairingBusy ? '正在绑定…' : '绑定电脑'}</button>{pairingError && <p className="form-error" role="alert">{pairingError}</p>}{devices.length > 0 && <div className="linked-devices"><b>已绑定设备</b>{devices.map(device => <div key={device.desktopDeviceId}><Icon name="monitor" size={17} /> {device.desktopName}</div>)}</div>}</div> : <><div className="availability"><b>接入状态</b><span>{features[sheet].detail}</span></div><button className="primary-button" onClick={() => setSheet(null)}>知道了</button></>}</section></div>}
  </div>;
}

export default App;
