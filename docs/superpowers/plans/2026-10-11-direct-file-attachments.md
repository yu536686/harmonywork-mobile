# 共享会话电脑附件直传实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（- [ ]）语法跟踪进度。

**目标：** Windows Agent 找到文件后，在原共享会话生成附件卡；手机仅在电脑在线且 WebRTC 直连时预览或下载并校验文件。

**架构：** 11.29 只保留附件元数据、归属关系和一次性短时票据，不接收文件字节。Windows 本地保存附件 ID 到规范化路径的私有映射，WebRTC DataChannel 按授权票据分块发送；Android 校验 SHA-256 后再预览或保存。模型仅能向 WorkBuddy MCP 工具提交路径与显示名，任务身份来自本次 Codex 进程的可信上下文。

**技术栈：** Express/PostgreSQL、Windows Tauri/Rust/WorkBuddy MCP Host/React WebRTC、Android Tauri 2/Rust/React WebRTC。

**来源规格：** docs/superpowers/specs/2026-10-11-live-sync-device-management-attachments-design.md 的阶段 C。依赖实时任务事件计划和双向设备管理计划。

---

## 文件与职责

- 门户 src/server/mobile-bridge-schema.ts：附件元数据与一次性票据哈希。
- 门户 src/server/mobile-bridge.ts：附件登记、列出、出票与核验路由。
- 门户 src/server/mobile-bridge-routes.integration.test.ts：账户、绑定、任务、票据和撤销权限。
- Windows src-tauri/workbuddy-mcp-host/src/mobile_share.rs 与 lib.rs：仅 mobile_executor 可见的 share_file 工具。
- Windows src-tauri/src/codex_runtime/headless.rs 与 background.rs：每次手机任务独立的能力令牌环境变量。
- Windows src-tauri/src/commands/mobile_attachment.rs：受信任务上下文、本机文件映射、授权后分块读取。
- Windows src/bridgePeer.ts：独立文件 DataChannel，受控发送窗口。
- Windows src/bridgePeer.test.ts：传输协议和背压。
- Windows src/components/Chat/MobileTaskCard.tsx：附件卡与桌面打开动作。
- Android apps/mobile/src/bridgePeer.ts：文件 DataChannel 请求、块 ACK、重试与取消。
- Android apps/mobile/tests/bridgePeer.test.mjs：票据、续传、取消和错误。
- Android apps/mobile/src-tauri/src/bridge.rs：短时票据与临时文件写入/校验/系统保存。
- Android apps/mobile/src/App.tsx：附件预览、下载和离线错误状态。

## 任务 1：元数据与授权票据

- [ ] 在服务端集成测试加失败用例：目标桌面只能给自己已领取的任务登记最多 200 MiB 的文件元数据；另一账户、未绑定手机或其他桌面不能列出、出票、核验。票据重复核验、过期、解绑后为 403/410。
- [ ] schema 新增 workbuddy_mobile_attachments（UUID、user/session/task/desktop、name、MIME、size、sha256、created_at、revoked_at）及 workbuddy_mobile_transfer_tickets（token_hash、attachment_id、mobile_id、expires_at、consumed_at）；不要添加路径或 BLOB 字段。
- [ ] 增加 POST /tasks/:id/attachments、GET /sessions/:id/attachments、POST /attachments/:id/ticket、POST /attachments/:id/verify。ticket 由 CSPRNG 生成，仅将原文返回手机，服务端存哈希；有效期 60 秒且只能核验一次。verify 必须以桌面设备令牌和有效 link 认证，并要求 ticket 指定的 mobileId 与目标手机匹配。
- [ ] 附件登记后在同一任务写 artifact_ready 事件与 changes 通知；解绑、任务取消及本地文件失效时标记附件 revoked。运行 npm run test:server、npm run build:server，提交服务端。

## 任务 2：Windows Agent 分享工具与本机文件映射

- [ ] WorkBuddy MCP Host 的测试先验证：普通桌面会话看不到 share_file；手机任务模式下工具只接受 path、displayName；模型输入中的 taskId/sessionId 被拒绝。
- [ ] mobile_share.rs 定义工具描述与调用，读取本次 Codex 子进程继承的 WORKBUDDY_MOBILE_TASK_CAPABILITY。桌面 worker 启动执行前生成随机能力令牌，并在仅当前用户可读的 app_data_dir/mobile_share_requests 下建立任务上下文；MCP Host 通过该能力令牌提交请求，桌面 worker 核对后补上 taskId、sessionId、desktopId，返回附件 ID。令牌只活到该任务结束，不写入聊天、日志或服务端。
- [ ] Windows mobile_attachment.rs 规范化真实路径，拒绝符号链接跳出允许工作区、目录、设备文件和大于 200 MiB 文件；工作区外仅遵循现有桌面文件授权结果。计算 size、SHA-256、MIME；本地私有映射保存附件 ID 与真实路径，服务端只提交展示元数据。文件后续读取前重新 stat 并验证摘要，修改或删除即撤销。
- [ ] 把附件 ID 加入对应任务成果事件，并在 MobileTaskCard 中展示文件名、大小、类型。运行 WorkBuddy MCP Host 测试、Windows cargo test、npm run build:web；提交 Windows 文件登记。

## 任务 3：P2P 传输协议

- [ ] 在两端 bridgePeer 的协议测试先覆盖 ticket 错误、重复块、乱序 ACK、取消、断线、200 MiB 上限、接收字节数与 SHA-256 不符。
- [ ] 使用既有 WebRTC PeerConnection 建立独立 harmonywork-file DataChannel。控制帧：request {attachmentId,ticket,offset}、ack {offset}、cancel {attachmentId}、error {code}、complete {size,sha256}；数据帧带 attachmentId 和 offset。块大小 16 KiB，未确认数据窗口最多 1 MiB，bufferedAmount 超阈值暂停。断线续传重新申领一次性票据并带已校验的 offset；不得复用已核验票据。
- [ ] Windows 收到 request 后用服务端 verify 确认票据/手机/有效绑定，native mobile_attachment_read_chunk(attachmentId,offset,length) 只接受已授权的 ID 和不超界 offset；JS 不可传本地路径。传输期间每 1 MiB 或 10 秒重新验证绑定和附件撤销状态，解绑立即停止后续块。P2P 失败时显示“电脑直连不可用，请重试”，不走 HTTPS/TURN 文件字节回退。
- [ ] Android 收块时写 app cache 临时文件并逐块校验 offset，全部接收后校验长度与 SHA-256；失败删除临时文件。图片、PDF、文本以只读缓存预览；用户点下载时通过 Android 系统文档保存界面选择目标位置，取消则保留会话卡片但不保存文件。
- [ ] Windows 与 Android 分别运行单元测试、构建并在 MuMu 与小米实际网络环境验证 1 KiB 文本、图片、PDF 和接近 200 MiB 文件；记录直连失败时的明确错误。提交两端传输实现。

## 任务 4：端到端权限与发布

- [ ] 手机在同一会话让电脑找到文件，Windows Agent 调用 share_file，双方看到同一附件卡；手机在线电脑直连预览/下载后比对 SHA-256。
- [ ] 电脑离线、解绑、任务撤销、票据过期、伪造文件 ID、文件被移动/改写时均不能取到字节；服务端请求日志、数据库、Nginx 传输统计都不含文件内容或本地绝对路径。
- [ ] 运行三端完整适当测试和构建，复测阶段 A 消息/进度及阶段 B 双向解绑；记录 APK、Windows 安装包、服务版本和实测可用网络条件。正式全量包只在跨端验收通过后生成。
