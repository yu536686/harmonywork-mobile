# 手机与 Windows 实时会话同步实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（- [ ]）语法跟踪进度。

**目标：** 手机派发的电脑任务在同一会话实时展示执行进度；电脑完成后立即展示成果卡，手机恢复后补上最终答复；双端新消息无需切换会话即可出现。

**架构：** 11.29 PostgreSQL 保存任务事件和变更游标，Express 以设备认证的 SSE 发送轻量提示；客户端以持久游标补拉，SSE 不可用时以前台短轮询兜底。Windows 在读取 Codex JSONL 的同时映射安全事件并上传，完成与成果事件由服务端事务提交。任务事件和聊天消息保持独立序号，UI 按发起消息及 turn ID 组合显示。

**技术栈：** Express 5、PostgreSQL、Node test；Windows Tauri/Rust/React/Vitest；Android Tauri 2/Rust/React/Node test；Nginx。

**来源规格：** docs/superpowers/specs/2026-10-11-live-sync-device-management-attachments-design.md。此计划只交付阶段 A；设备管理和附件按该规格另立实施计划。

---

## 文件与职责

门户仓库 yu536686/xiaoheng-portal 的 feat/harmonywork-mobile-bridge 分支：

- 修改 src/server/mobile-bridge-schema.ts：任务事件、变更通知表及索引。
- 新建 src/server/mobile-bridge-events.ts：事件白名单、截断、序号补拉和通知发布。
- 修改 src/server/mobile-bridge.ts：任务事件写入/读取、完成事务、SSE 路由及消息/任务变更通知。
- 修改 src/server/mobile-bridge-routes.integration.test.ts：任务事件、幂等、租约、断线补拉和权限。

Windows 仓库 /Volumes/192.168.11.5/harmony-work-mobile-bridge 的 feat/windows-mobile-bridge 分支：

- 修改 src-tauri/src/codex_runtime/headless.rs：JSONL 到达时调用异步观察回调，保持旧接口可用。
- 修改 src-tauri/src/codex_runtime/background.rs：将观察回调透传至执行器。
- 新建 src-tauri/src/commands/mobile_task_events.rs：安全映射、限流、上报和本地待发送队列。
- 修改 src-tauri/src/commands/mobile_bridge.rs：任务领取、续租、终态、SSE/补拉和 UI 通知。
- 新建 src/components/Chat/MobileTaskCard.tsx：按任务事件投影绘制阶段和成果。
- 新建 src/components/Chat/MobileTaskCard.test.tsx：卡片状态与事件去重。
- 修改 src/components/Chat/index.tsx 与 src/components/Chat/GlobalSessionRail.tsx：活跃会话和列表即时更新。

Android 仓库 /Volumes/192.168.11.5/harmony-work-mobile 的 feat/mobile-desktop-bridge 分支：

- 修改 apps/mobile/src-tauri/src/bridge.rs：任务事件增量接口与变更流。
- 新建 apps/mobile/src/taskEvents.ts：有序合并、幂等及任务状态投影。
- 修改 apps/mobile/src/conversationSync.ts 与 apps/mobile/src/App.tsx：前台恢复补拉、成果卡、最终总结去重。
- 新建 apps/mobile/tests/taskEvents.test.mjs：乱序、重放、恢复和终态测试。

## 任务 1：服务端事件表和纯函数

- [ ] 在 src/server/mobile-bridge-routes.integration.test.ts 加失败用例：已绑定手机创建任务后，可读取 queued 事件；未绑定设备读事件为 403；相同事件 ID 重试仅保留一条。
- [ ] 在 src/server/mobile-bridge-schema.ts 增加 workbuddy_mobile_task_events：event_id UUID 唯一，seq BIGSERIAL，user_id、session_id、task_id、turn_id、kind、summary、payload、created_at；索引 (user_id, session_id, seq)。再加 workbuddy_mobile_changes：seq BIGSERIAL，user_id、kind、session_id、created_at，并按 (user_id, seq) 索引。
- [ ] 在 src/server/mobile-bridge-events.ts 定义下列共享契约及纯函数，测试白名单、长度、秘密路径过滤：

~~~ts
export const taskEventKinds = [
  "queued", "claimed", "planning", "tool_started", "tool_finished",
  "artifact_ready", "succeeded", "failed", "cancelled"
] as const;
export type TaskEventKind = typeof taskEventKinds[number];
export function publicTaskEvent(input: unknown): {
  eventId: string; kind: TaskEventKind; summary: string;
  payload: Record<string, string | number | boolean>;
} {
  // Zod 严格校验 UUID、kind、摘要 <= 512 字符及 JSON 载荷 <= 2048 字节。
  // 拒绝原始命令输出、绝对路径、推理文本和任意未知字段。
}
~~~

- [ ] 用 TEST_DATABASE_URL 指向专用 /harmonywork_bridge_test 数据库运行 npm run test:server，再运行 npm run build:server；若集成用例显示 SKIP，不能当作通过。验证新用例先失败、实现后通过。单独提交 schema 与纯函数。

## 任务 2：服务端任务事件 API 和完成事务

- [ ] 加失败用例：POST /tasks/:id/events 只有持有效 leaseToken 的目标 Windows 可写；同 eventId 重试返回原 seq；超过 500 条非终态事件返回 429；GET /sessions/:id/task-events?afterSeq=N 只返回可见会话中 seq>N 的事件。失效租约写入必须 409。
- [ ] POST 成功时同一事务写事件和 workbuddy_mobile_changes；GET 返回按 seq 升序、每页最多 100 条。POST 载荷采用任务 1 的 publicTaskEvent；对 tool_started/tool_finished 在电脑端合并到最多每 500 毫秒一条。
- [ ] 修改 POST /tasks/:id/claim：状态更新与 claimed 事件/变更通知同事务。修改 /tasks/:id/complete：锁定任务，验证租约，更新 succeeded/failed 并写同任务终态事件与变更通知后提交。重复同一终态请求返回原结果，不重复成果卡；冲突终态返回 409。
- [ ] 加失败用例：两个并发完成请求、网络重试、手机后台不调用任何 API 时，服务端终态与成果事件仍一起存在；旧 worker 续租失败不得覆盖新结果。
- [ ] 运行 npm run test:server、npm run typecheck；提交 API 与事务变更。

## 任务 3：服务端可靠变更流

- [ ] 加失败用例：带同账户 Cookie、有效设备令牌的 GET /changes?afterSeq=N 仅返回该设备可见的变化；未认证、无效令牌、解绑设备为 401/403；从旧游标补拉不漏消息、任务和设备变更。
- [ ] 为现有消息追加、会话创建/改名、任务创建/事件/完成写变更行；增量 GET 最多返回 100 条，并提供 nextSeq。添加 GET /changes/stream?afterSeq=N，响应 text/event-stream、Cache-Control: no-cache、X-Accel-Buffering: no；每 20 秒发送心跳，连接关闭时清理监听。变更行是可靠来源，SSE 仅提示最新 seq；服务端重启后客户端仍通过 GET 补齐。
- [ ] 在 src/server/mobile-bridge-standalone.ts 注册每日清理：删除 90 天前的非终态过程事件和相应旧变更提示，保留任务终态与成果事件；客户端游标落在清理水位前时 GET 返回 resetRequired，客户端按当前会话完整重建投影。
- [ ] 运行 npm run test:server、npm run build:server；在 11.29 部署后分别用本机 API 和 remote.harmonywatch.cn 验证 SSE 实时性、断线续传及 Nginx 禁用该路径缓冲。提交服务和 Nginx 配置变更；记录回滚版本。

## 任务 4：Windows 执行过程流出

- [ ] 在 headless.rs 加测试：连续 JSONL item.started、item.completed 在进程未退出前即送观察通道；取消和超时不留下子进程。保持现有 run_codex_exec 调用方行为。
- [ ] 扩展执行函数接受可选 tokio::sync::mpsc::Sender<Value>；stdout_task 在 parser.push_line 后把解析成功的事件送通道，通道满时丢弃过程事件，不丢终态。background.rs 的 CodexBackgroundOptions 加观察通道并透传。
- [ ] mobile_task_events.rs 将 Codex JSONL 仅映射为 planning、tool_started、tool_finished、artifact_ready；公开摘要只允许工具显示名和安全步骤文本，拒绝 reasoning、命令输出、环境变量、绝对路径和超过限额的内容。事件 ID 在本地生成，按 500 毫秒合并；上传失败排入有界队列并保持原 ID 重试。
- [ ] 在 mobile_bridge.rs 领取成功后启动观察器，上报公开事件；完成 POST 成功后立即 emit mobile_bridge_updated 和 mobile_task_changed，且本地先投影终态。续租 403/409 时取消执行并停止事件上传。另开带 Cookie/设备头的 SSE 读取任务，记录 changes seq；SSE 提示或断线重连时调用 GET /changes 和现有消息增量 API 补齐，并 emit 给 UI。SSE 不可用时每三秒补拉，且不创建重复 worker。
- [ ] 运行 cargo test（限定 mobile_bridge、headless、mobile_task_events 相关测试）及 npm run build:web；在 Windows 上进行一次手机派发的真实任务并确认执行中能收到事件。提交 Windows 原生实现。

## 任务 5：Windows 会话与列表即时更新

- [ ] 添加 MobileTaskCard.test.tsx：queued/claimed 有运行标记，tool_started 显示安全步骤，succeeded 显示成果摘要与“等待手机整理”，failed 有明确错误；相同事件 ID 不重复渲染。
- [ ] MobileTaskCard.tsx 接收 taskId、turnId、initiatingMessageId 和 taskEvents；按任务 seq 排序，在对应用户消息后绘制，不把 task seq 与 message seq 混排。
- [ ] Chat/index.tsx 订阅 mobile_task_changed 与 mobile_bridge_updated，当前手机来源会话按事件增量重取任务投影和消息；请求带 generation 检查，旧响应不能覆盖新状态。会话获得焦点、窗口恢复及 SSE 重连时主动补拉，不依赖切换会话。
- [ ] GlobalSessionRail.tsx 对未终结的手机任务展示转圈和阶段文字；终态清除运行标记。运行 npm run test -- MobileTaskCard 与相关聊天测试、npm run build:web；提交 UI 变更。

## 任务 6：Android 事件合并与成果卡

- [ ] taskEvents.test.mjs 先验证乱序增量、重复 eventId、旧响应不得回退游标、终态与手机最终助手消息各显示一次。
- [ ] taskEvents.ts 定义 TaskEvent 和 mergeTaskEvents(existing, incoming, afterSeq)，按 ID 去重并按 seq 排序；在 conversationSync.ts 的持久状态增加 taskEventCursors，不改变旧状态读取兼容性。
- [ ] bridge.rs 增加 bridge_task_events(session_id, after_seq)、bridge_changes(after_seq) 与可停止的原生 bridge_start_change_stream；Rust 使用现有 Cookie + 设备头读取 SSE，收到提示 emit 到 WebView。Android 后台不依赖这个连接，前台恢复立即按持久游标补拉；SSE 断开时前台每三秒轮询。
- [ ] App.tsx 的共享会话刷新同时拉消息和任务事件；成果卡在发起用户消息后显示，手机退后台也不影响桌面可见成果。最终总结只在恢复后按 pendingTurns/answeredTurns 运行，append assistant message 使用原 assistantMessageId 幂等；任务页保持会话入口。
- [ ] 运行 node --test apps/mobile/tests/*.test.mjs 与 npm --prefix apps/mobile run build；构建 Android 调试 APK，在 MuMu 和小米设备验证“手机发起—电脑显示过程—电脑立即成果—手机恢复最终答复”。提交 Android 变更。

## 任务 7：跨端验收与发布检查

- [ ] 同一账户双端登录，测试手机消息与电脑消息双向发送。当前会话保持打开，任何一端新消息在 SSE 正常时迅速出现；强制阻断 SSE 时三秒轮询恢复。
- [ ] 在任务执行期间切后台、断网、重连、重启 Windows，检查任务事件按游标恢复，卡片不重复，失败有明确终态，电脑结果不依赖手机前台。
- [ ] 验证服务端无模型推理、密钥、命令原始输出或绝对路径；事件数量、大小和 90 天保留策略符合规格。检查 11.29 的 CPU/内存、SSE 连接数与数据库变更表增长。
- [ ] 在三个仓库分别运行完整适当测试/构建，保存 commit SHA、安装包路径与部署版本，给出实际设备测试证据。未完成验收前不覆盖现有 1.0.9 正式包。

## 对应关系与下一计划

本计划覆盖规格阶段 A 的任务过程、成果卡、双方消息刷新、断线恢复和移动端最终总结。阶段 B 的双向解绑与设备名，以及阶段 C 的附件直连，分别按同日独立计划实施；这两阶段不得用服务端文件缓存替代手机直连电脑。
