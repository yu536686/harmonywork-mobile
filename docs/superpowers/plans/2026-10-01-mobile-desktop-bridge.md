# 手机与 Windows 桌面端连接实现计划

> 面向当前工程的实施清单。按服务器、移动端、Windows 桌面端分别提交和验证。

**目标：** 同一账户扫码绑定 Windows 桌面端；手机会话同步到桌面并标记“手机端”；手机创建的远端任务在电脑执行，手机断线后仍可恢复状态与成果。

**架构：** `remote.harmonywatch.cn` 直接解析到 `61.150.31.150`，11.29 上的 Nginx 终止 TLS，仅将 `/api/mobile/` 转发到本机门户 API。门户 API 复用现有账户认证和 PostgreSQL，持久化配对、设备、会话和任务。客户端优先尝试 WebRTC DataChannel；ICE 失败或应用在后台时使用同一 11.29 服务的 HTTPS 任务队列。P2P 只承载在线低延迟消息，任务领取与结果始终写入服务端以保证恢复。

**安全边界：** 配对挑战一次性、短期有效，并要求手机与电脑登录同一账户；所有列表和对象操作同时按账户及绑定设备鉴权；任务领取采用租约与幂等键；禁止远端直接下发任意 shell 命令，桌面端仍按本地确认策略执行。API Key 与桌面文件内容不进入配对二维码。Nginx 只公开桥接路径并限速、限请求体大小。

**技术栈：** 门户 Express 5 + PostgreSQL；移动端 Tauri 2/Rust/React；Windows 桌面端 Tauri/Rust/React；Nginx；WebRTC DataChannel 与 STUN（直连失败时回退 HTTPS）。

---

## 文件与职责

- 门户 `src/server/mobile-bridge.ts`：输入校验、配对、设备、会话、任务、信令 API。
- 门户 `src/server/db.ts`：桥接表及索引；`src/server/index.ts`：注册受账户认证保护的路由。
- 移动端 `src-tauri/src/bridge.rs`：直连域名请求及登录 Cookie 复用。
- 移动端 `src/App.tsx`：扫码/输入绑定码、会话同步、远端任务状态和结果。
- 桌面端 `src-tauri/src/commands/mobile_bridge.rs`：配对、会话导入、任务领取与结果回传。
- 桌面端 `src/App.tsx`：Windows 左下角手机入口及连接向导；`src/components/Chat/GlobalSessionRail.tsx`：手机端标记。
- 11.29 `/etc/nginx/sites-available/harmonywork-remote.conf`：直连域名 TLS 与反向代理；证书包含 `remote.harmonywatch.cn`。

## 验收顺序

### 任务 1：服务器协议与持久化

- [ ] 为配对过期、一次性领取、同账户隔离、任务租约和会话修订写失败测试。
- [ ] 实现表结构、API 和严格输入上限，运行服务器测试与构建。
- [ ] 在 11.29 单独部署并验证未认证请求、认证请求及重启后状态恢复。

### 任务 2：移动端绑定与同步

- [ ] 先测二维码解析、错误状态和会话上传去重。
- [ ] 实现扫码/手输兜底、设备选择、会话同步和远端任务页面。
- [ ] 构建 APK，在 MuMu 验证绑定及对话上传。

### 任务 3：Windows 桌面端

- [ ] 在 `feat/windows-mobile-bridge` 分支实现左下角入口与配对向导。
- [ ] 将手机会话导入本地数据库，`source=mobile`，列表显示“手机端”。
- [ ] 领取任务后走现有 Agent 执行与本地授权策略，回传进度、结果及成果索引。
- [ ] 只在 Windows 启用，运行前端与 Rust 相关测试并实际连接验证。

### 任务 4：直连优化与网络回退

- [ ] 在两端使用服务端信令尝试 WebRTC DataChannel，记录 ICE 成功/失败。
- [ ] 信令或直连失败时继续使用 HTTPS 队列，不丢任务或结果。
- [ ] 公网验证域名、证书、Nginx、任务恢复和断线重连；不经过腾讯云中转。

## 已验证的前提

- 2026-10-01：`remote.harmonywatch.cn` 解析到 `61.150.31.150`。
- 11.29 的 Nginx 已运行，当前证书不包含此域名，必须签发并配置后客户端才能连接。
- 门户 API 当前部署在 11.29，现有账户 Cookie 可在 Rust 请求中复用。
- 桌面端已有会话 `source` 字段和固定 ID 的会话创建方法，可用于手机会话导入。
