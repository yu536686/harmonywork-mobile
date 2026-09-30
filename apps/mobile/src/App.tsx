import { useEffect, useRef, useState, type FormEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icon, type IconName } from './Icon.tsx';
import type { AccountView, ChatMessage, ChatSession } from './model.ts';
import { loadSessions, saveSessions } from './sessionStore.ts';
import './App.css';

type View = 'home' | 'conversations' | 'chat' | 'tasks' | 'mine';
type Sheet = 'harvis' | 'skills' | 'memory' | 'device' | null;
const features: Record<Exclude<Sheet, null>, { title: string; intro: string; detail: string; icon: IconName }> = {
  harvis: { title: 'Harvis 图片生成', intro: '将创作想法变成图片。', detail: '生图接口和积分状态将在下个闭环接入；当前版本暂不发送生成请求。', icon: 'image' },
  skills: { title: '技能远程管理', intro: '在手机上查看与管理电脑技能。', detail: '需要先完成设备绑定、权限与技能状态协议；当前没有连接桌面设备。', icon: 'puzzle' },
  memory: { title: '小亨的记忆', intro: '查看与管理个人记忆。', detail: '跨端记忆接口将在后续接入。当前只保存本机对话，不将其冒充账户记忆。', icon: 'memory' },
  device: { title: '连接电脑', intro: '把复杂工作交给已授权的桌面端。', detail: '设备绑定和远端任务通道正在开发。手机轻量对话不依赖电脑在线。', icon: 'monitor' },
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
    setView('home');
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
    {view === 'home' && <div className="page-enter"><header className="home-header"><div className="top-row"><div className="app-brand"><span className="brand-mark">H</span><b>Harmony Work</b></div><button className="avatar-button" onClick={() => setView('mine')} aria-label="我的账户">{account.name.slice(0, 1)}</button></div><div className="greeting"><span>欢迎回来，{account.name}</span><h1>今天想和<span>小亨</span>做什么？</h1></div></header><div className="home-body"><section className="hero-card"><div className="hero-top"><span>YOUR WORKSPACE</span><span className="hero-status">手机已就绪</span></div><h2>想法随时开始，<br />轻量工作立即完成。</h2><p>小亨在手机上独立对话、整理与规划。需要电脑环境的工作会在设备连接后交接。</p><button onClick={startChat}>开始对话 <Icon name="arrow" size={17} /></button></section><div className="section-heading"><h2>快捷开始</h2><span>按需进入</span></div><div className="quick-grid"><button className="quick-card" onClick={() => setSheet('harvis')}><span className="icon-tile peach"><Icon name="image" /></span><b>Harvis 生图</b><small>图片创作入口</small></button><button className="quick-card" onClick={() => setView('tasks')}><span className="icon-tile blue"><Icon name="tasks" /></span><b>我的任务</b><small>查看远端接入进度</small></button><button className="quick-card" onClick={() => setSheet('skills')}><span className="icon-tile purple"><Icon name="puzzle" /></span><b>技能管理</b><small>远程技能入口</small></button><button className="quick-card" onClick={() => setSheet('memory')}><span className="icon-tile green"><Icon name="memory" /></span><b>记忆</b><small>个人记忆入口</small></button></div><div className="section-heading"><h2>最近对话</h2><button onClick={() => setView('conversations')}>查看全部 <Icon name="arrow" size={15} /></button></div>{sorted.length ? <button className="recent-card" onClick={() => openChat(sorted[0].id)}><span className="icon-tile purple"><Icon name="chat" /></span><span><b>{sorted[0].title}</b><small>{sorted[0].messages.at(-1)?.content.slice(0, 35) || '刚创建的对话'}</small></span><Icon name="arrow" size={17} /></button> : <button className="recent-empty" onClick={startChat}>还没有对话。和小亨说第一句话 <Icon name="arrow" size={16} /></button>}<div className="section-heading"><h2>我的设备</h2></div><button className="device-card" onClick={() => setSheet('device')}><span className="icon-tile gray"><Icon name="monitor" /></span><span><b>电脑尚未连接</b><small>手机对话可独立使用</small></span><Icon name="arrow" size={17} /></button></div></div>}
    {view === 'conversations' && <div className="page-enter"><header className="page-header"><h1>对话</h1><button className="icon-button" onClick={startChat} aria-label="新建对话"><Icon name="plus" /></button></header><div className="page-body"><p className="section-caption">最近对话</p>{sorted.length ? sorted.map(session => <div className="conversation-row" key={session.id}><button onClick={() => openChat(session.id)}><span className="icon-tile purple"><Icon name="chat" /></span><span className="conversation-text"><b>{session.title}</b><small>{session.messages.at(-1)?.content.slice(0, 45) || '开始和小亨交流'}</small></span><time>{dateLabel(session.updatedAt)}</time></button><button className="row-delete" onClick={() => deleteChat(session.id)} aria-label={`删除${session.title}`}><Icon name="trash" size={17} /></button></div>) : <div className="empty-state"><span className="icon-tile purple"><Icon name="chat" /></span><h2>从一个想法开始</h2><p>和小亨讨论、整理、规划。手机不连接电脑也能使用。</p><button className="primary-button" onClick={startChat}>开始新对话 <Icon name="arrow" size={17} /></button></div>}</div></div>}
    {view === 'chat' && active && <div className="chat-page page-enter"><header className="chat-header"><button className="icon-button plain" onClick={() => setView('conversations')} aria-label="返回对话列表"><Icon name="back" /></button><div><h1>{active.title}</h1><span><i className="green-dot" />小亨 · 手机独立对话</span></div><button className="icon-button plain" onClick={() => deleteChat(active.id)} aria-label="删除对话"><Icon name="trash" size={19} /></button></header><div className="messages"><div className="chat-date">手机端独立会话</div>{active.messages.length === 0 && <div className="chat-welcome"><span className="agent-symbol"><Icon name="spark" size={22} /></span><h2>你好，我是小亨。</h2><p>可以聊想法、整理资料、拟定计划。需要访问电脑文件或应用时，我会清楚告诉你。</p></div>}{active.messages.map(message => message.role === 'user' ? <div className="message user-message" key={message.id}>{message.content}</div> : <div className="agent-message" key={message.id}><div className="agent-label"><Icon name="spark" size={14} /> 小亨</div><div className="message assistant-message">{message.content}</div></div>)}{sending && <div className="agent-message"><div className="agent-label"><Icon name="spark" size={14} /> 小亨</div><div className="message assistant-message typing" aria-label="小亨正在回复"><span /><span /><span /></div></div>}{!sending && active.messages.at(-1)?.role === 'user' && <div className="retry-panel" role="status"><span>{chatError?.id === active.id ? chatError.text : '这条消息尚未收到回复。'}</span><button onClick={() => void runChat(active.id, active.messages)}>重试</button></div>}<div ref={chatEnd} /></div><form className="composer" onSubmit={sendMessage}><textarea aria-label="给小亨发送消息" value={draft} onChange={event => setDraft(event.target.value)} placeholder="给小亨发送消息…" maxLength={8000} rows={2} disabled={sending} /><div className="composer-bottom"><span><Icon name="spark" size={14} /> 手机处理</span><button type="submit" disabled={sending || !draft.trim()} aria-label="发送消息"><Icon name="send" size={19} /></button></div></form></div>}
    {view === 'tasks' && <div className="page-enter"><header className="page-header"><h1>任务</h1></header><div className="page-body"><div className="empty-state task-empty"><span className="icon-tile blue"><Icon name="tasks" /></span><h2>远端任务即将接入</h2><p>完成设备绑定后，小亨会把需要电脑环境的工作交给已授权桌面端。进度和成果会留在原会话，这里统一汇总。</p><button className="secondary-button" onClick={() => setSheet('device')}>了解设备连接 <Icon name="arrow" size={17} /></button></div></div></div>}
    {view === 'mine' && <div className="page-enter"><header className="page-header"><h1>我的</h1></header><div className="profile-card"><span className="profile-avatar">{account.name.slice(0, 1)}</span><div><b>{account.name}</b><small>{account.email}</small></div></div><div className="page-body"><p className="section-caption">账户与配置</p><div className="setting-card"><span className="icon-tile purple"><Icon name="lock" /></span><div><b>加密模型配置</b><small>Harmony Responses · {account.model}</small></div><span className="configured"><Icon name="check" size={14} /> 已解锁</span></div><button className="setting-card" onClick={() => setSheet('device')}><span className="icon-tile gray"><Icon name="monitor" /></span><div><b>已连接设备</b><small>当前未连接电脑</small></div><Icon name="arrow" size={17} /></button><p className="section-caption spaced">小亨能力</p><button className="setting-card" onClick={() => setSheet('skills')}><span className="icon-tile purple"><Icon name="puzzle" /></span><div><b>技能管理</b><small>远程管理尚未接入</small></div><Icon name="arrow" size={17} /></button><button className="setting-card" onClick={() => setSheet('memory')}><span className="icon-tile green"><Icon name="memory" /></span><div><b>记忆</b><small>跨端记忆尚未接入</small></div><Icon name="arrow" size={17} /></button><button className="logout-button" onClick={() => void signOut()}>退出登录</button></div></div>}
  </main><nav className="bottom-nav" aria-label="主导航"><button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}><Icon name="home" />首页</button><button className={view === 'conversations' || view === 'chat' ? 'active' : ''} onClick={() => setView('conversations')}><Icon name="chat" />对话</button><button className={view === 'tasks' ? 'active' : ''} onClick={() => setView('tasks')}><Icon name="tasks" />任务</button><button className={view === 'mine' ? 'active' : ''} onClick={() => setView('mine')}><Icon name="user" />我的</button></nav>
  {sheet && <div className="sheet-backdrop" onClick={event => { if (event.target === event.currentTarget) setSheet(null); }}><section className="feature-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div className="sheet-handle" /><button className="icon-button sheet-close" onClick={() => setSheet(null)} aria-label="关闭"><Icon name="close" size={19} /></button><span className="icon-tile purple"><Icon name={features[sheet].icon} size={23} /></span><h2 id="sheet-title">{features[sheet].title}</h2><p>{features[sheet].intro}</p><div className="availability"><b>接入状态</b><span>{features[sheet].detail}</span></div><button className="primary-button" onClick={() => setSheet(null)}>知道了</button></section></div>}
  </div>;
}

export default App;
