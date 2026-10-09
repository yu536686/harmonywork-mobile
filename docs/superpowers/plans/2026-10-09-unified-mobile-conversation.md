# Harmony Work 统一会话实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 手机只有一个会话入口，按需调用 Windows 执行，并让手机发起的会话可在两端继续。

**架构：** 11.29 服务端维护逐条、不可覆盖的共享消息流和任务/轮次状态。Android 负责手机轮次的 Responses 工具调用及结果整理；Windows 负责反向同步及隔离的桌面执行。两端按服务端序号收敛，使用消息 ID 和任务键幂等重试。

**技术栈：** Express 5、PostgreSQL、Zod；Tauri 2/Rust/React；Harmony Responses；Windows Codex runtime。

**设计依据：** `docs/superpowers/specs/2026-10-09-unified-mobile-conversation-design.md`。

---

## 工作区和文件职责

- 服务端工作区 `/Users/yutianqi/Documents/亨吉利-mobile-bridge`：`src/server/mobile-bridge-contract.ts` 定义请求验证，`src/server/mobile-bridge-schema.ts` 定义可重复执行的迁移，`src/server/mobile-bridge.ts` 实现授权后的会话、消息、轮次和任务 API；同名 `.test.ts` 覆盖合同与迁移。
- 手机工作区 `/Volumes/192.168.11.5/harmony-work-mobile`：`apps/mobile/src-tauri/src/chat.rs` 解析 Responses 文本/工具调用，`apps/mobile/src-tauri/src/bridge.rs` 请求新协议，`apps/mobile/src/conversationSync.ts` 负责合并和队列，`apps/mobile/src/App.tsx` 负责单入口及状态；`apps/mobile/tests` 覆盖纯状态机行为。
- Windows 工作区 `/Volumes/192.168.11.5/harmony-work-mobile-bridge`：`src-tauri/src/commands/mobile_bridge.rs` 实现双向同步和隔离执行，`src-tauri/src/store/db.rs` 按消息 ID/服务端序号去重，`src/components/Chat/index.tsx` 在共享轮次占用期间显示状态。
- 11.29 运行环境：沿用 `harmonywork-remote.service`、现有域名与 Nginx，先部署向后兼容的服务端，再更新客户端。

## 任务 1：服务端消息合同与数据库迁移

- [ ] 在 `src/server/mobile-bridge-contract.test.ts` 添加测试：合法的 `{id,role,content,turnId}` 通过；`system` 角色、非 UUID、超过 8000 字或同一 ID 不同内容被拒绝。先运行 `node --import tsx --test src/server/mobile-bridge-contract.test.ts`，确认新增测试因导出缺失失败。
- [ ] 在 `src/server/mobile-bridge-contract.ts` 增加 `normalizeSharedMessage`。消息输入合同为：

```ts
const sharedMessage = z.object({
  id: uuid,
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
  turnId: uuid.optional()
}).strict();
export const normalizeSharedMessage = (value: unknown) => sharedMessage.parse(value);
```

- [ ] 在 `src/server/mobile-bridge-schema.ts` 增加 `workbuddy_mobile_messages` 表：`seq BIGSERIAL PRIMARY KEY`、`user_id`、`session_id`、`message_id`、`role`、`content`、`origin_device_id`、`turn_id`、`created_at`；`UNIQUE(user_id,session_id,message_id)` 和会话外键。增加 `workbuddy_mobile_turns` 表：`id`、用户/会话/发起消息/设备、`status`、`lease_until`、`task_id`、`created_at`、`updated_at`。增加 `(user_id,session_id,seq)` 索引。迁移用 `IF NOT EXISTS` 保证服务重启可重复执行。
- [ ] 在 11.29 上准备独立的 `harmonywork_bridge_test` PostgreSQL 数据库，使用该库运行迁移两次，确认表和索引存在且第二次无错误；运行 `npm run test:server` 与 `npm run build:server`，再提交服务端任务 1。测试库不得指向正在服务的门户数据库。

## 任务 2：服务端增量消息 API 与旧快照迁移

- [ ] 为消息追加/读取写失败的路由测试：同 ID 同内容重试返回相同 `seq`，同 ID 不同内容返回 `409`，其他账户或未绑定设备返回 `403`，同内容但不同 ID 保留两条。使用隔离测试库和真实 HTTP 请求，不用仅检查 Zod 的替代测试。
- [ ] 在 `src/server/mobile-bridge.ts` 实现 `POST /sessions`（仅手机创立）、`POST /sessions/:id/messages`、`GET /sessions/:id/messages?afterSeq=`。所有查询同时约束 `user_id`、会话归属及设备绑定；消息写入使用 `ON CONFLICT (user_id,session_id,message_id) DO NOTHING` 后读取既有行并核对内容。每次读取最多 100 条，按 `seq ASC` 返回。
- [ ] 扩展 `GET /sessions`，支持已绑定的手机和 Windows 获取共享会话列表，并返回 `latestSeq`。保留旧客户端的 `desktopDeviceId` 分页参数与响应字段。将旧 `PUT /sessions/:id` 的快照消息按原顺序幂等导入新表；历史 JSONB 在启动迁移阶段一次性导入，不覆盖后来新增的桌面消息。
- [ ] 运行新增路由测试、`npm run test:server`、`npm run build:server`；在测试库检查迁移前后历史消息数量与顺序，再提交服务端任务 2。

## 任务 3：服务端轮次租约和任务关联

- [ ] 先写失败测试：一个会话第二轮领取返回 `409`，同轮次重试返回原记录，过期轮次可以恢复，任务完成仅发起手机可读取；同一 `idempotencyKey` 不创建第二任务。
- [ ] 实现 `POST /sessions/:id/turns`、`POST /sessions/:id/turns/:turnId/heartbeat`、`POST /sessions/:id/turns/:turnId/complete` 与 `GET /sessions/:id/turns/active`。服务端事务中锁定会话行，比较未过期轮次后才插入；响应包含 `turnId,status,leaseUntil,taskId`。排队远端任务关联轮次，领取/心跳/完成时延续轮次有效期；手机整理成功或失败后显式完成轮次。
- [ ] 现有 `POST /tasks` 接受可选 `turnId` 和 `toolCallId`，新客户端必须传入；旧客户端请求继续兼容。轮次与任务必须属于同一用户、会话与手机设备。结果仍按现有租约验签，不能把原始结果直接写进消息表。
- [ ] 运行路由测试、完整服务端测试与构建，再提交服务端任务 3。部署到 11.29 后分别验证旧 `GET /sessions`、新消息读写、未授权拒绝及服务重启后数据留存。

## 任务 4：手机模型决策与任务恢复

- [ ] 在 `apps/mobile/src-tauri/src/chat.rs` 写失败测试：Responses 的 `function_call` 被解析为工具请求，普通 `output_text` 保持文本回复，reasoning 不出现在 UI，未知工具及超限参数失败。调用结果采用 `ChatDecision::Text(String)` 或 `ChatDecision::Desktop { call_id: String, goal: String, response_items: Vec<Value> }`。
- [ ] 为 `mobile_chat` 添加 `execute_on_desktop` 函数声明，只有已绑定设备时提供；校验 `goal` 长度 1–8000 字。新命令 `mobile_chat_continue` 接收原始 `call_id`、必要响应项和电脑结果，用 `function_call_output` 继续，禁用再次调用电脑工具。继续请求失败保留任务成果与轮次，不重建任务。
- [ ] 在 `apps/mobile/src-tauri/src/bridge.rs` 实现会话创建、逐条消息、增量读取、轮次领取/完成的命令；保留旧命令以兼容已安装旧 APK。`apps/mobile/src/conversationSync.ts` 持久保存消息 ID、游标、待提交操作和工具调用恢复项，按服务端 `seq` 合并，严格按 ID 去重。
- [ ] 在 `apps/mobile/tests` 先测试断网重试、同内容不同 ID、任务完成后仅生成一次最终答复及重启恢复，再实现状态机。运行 `node --test apps/mobile/tests/*.mjs`、`npm --prefix apps/mobile run build` 和手机 Rust 单元测试，提交手机任务 4。

## 任务 5：手机单入口 UI

- [ ] 先写状态转换测试：发送普通问题保留一个会话；模型选择桌面任务后显示当前会话状态；任务完成后只追加一条手机最终答复；任务卡片点击返回该会话。
- [ ] 在 `apps/mobile/src/App.tsx` 移除对话栏“交给电脑”按钮、任务页独立输入表单及 `submitRemoteTask`。所有发送都走统一轮次编排。任务页仅渲染任务状态与跳转原会话；聊天区显示等待、执行、整理、失败/重试卡片。设备选择移至连接设置，聊天发送时使用默认绑定设备。
- [ ] 更新对应 `App.css` 文案与状态布局；运行手机测试、前端构建、Android Debug APK 编译。先在 MuMu 再在 Xiaomi 实测单会话 UI，记录截图和日志，提交手机任务 5。

## 任务 6：Windows 双向同步与隔离执行

- [ ] 在 `src-tauri/src/store/db.rs` 写失败测试：服务端同 ID 重拉不重复、相同内容不同 ID 均保留、按 `seq` 排序。给移动来源消息保存服务端 `seq` 和同步来源；删除按助手文本去重的特殊规则。
- [ ] 在 `src-tauri/src/commands/mobile_bridge.rs` 将导入改为增量读取；读取本地 `source=mobile` 会话中新生成的用户/助手消息并逐条上传，服务端导入消息不回传。任务领取后用独立的内部 session ID 调 `run_codex_background`，任务结果只提交给任务 API；共享会话不追加内部提示或原始结果。
- [ ] Windows 用户在共享会话发送前领取服务端轮次；轮次占用时禁用发送并显示状态，正常桌面答复按原消息 ID 上传，手机可增量读取。运行 Windows Rust 相关测试、前端测试与构建，提交 Windows 任务 6。

## 任务 7：集成、打包与回归

- [ ] 用测试账户验证 Harmony 网关支持 `function_call`、`function_call_output` 和 `store:false` 的继续请求；不输出 API Key 或完整敏感响应。失败时保留远端自动执行关闭状态并报告实际错误。
- [ ] 在 11.29 部署服务端，验证 Nginx、`harmonywork-remote.service`、权限拒绝、消息顺序、任务幂等和重启恢复。确认旧 APK/旧 Windows 客户端仍可读取历史。
- [ ] 构建 Android Debug APK 与 Windows 安装包，安装到可用设备，执行手机轻量回复→桌面显示→桌面继续→手机显示，以及手机委托→Windows 执行→手机总结两条完整路径。核对断线重连、重复消息和任务重试。
- [ ] 检查三个仓库的 Git 状态、测试输出和安装包哈希；只对实际通过的验收项标记完成，更新已有 draft PR 的最终说明与验证记录。
