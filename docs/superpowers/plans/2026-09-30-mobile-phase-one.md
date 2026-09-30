# Harmony Work Android 第一阶段实现计划

> 面向当前项目开发：按任务完成并验证，每个功能提交独立变更。

**目标：** 将 Tauri 演示页替换为可登录个人账户、解密云配置并独立调用 Harmony Responses 的 Android 应用。

**架构：** Rust 拥有账户 Cookie、解密后的 API Key 与网关请求；React 只持有用户资料、模型状态和本地会话文本。会话记录按账户隔离保存在设备 WebView。未接入的远程能力明确显示未连接状态。

**技术栈：** Tauri 2、Rust、reqwest、Argon2id、XChaCha20Poly1305、React 19、TypeScript、Vite 8、Windows Android SDK。

---

## 文件职责

- `apps/mobile/src-tauri/src/account.rs`：登录、云快照解密、会话状态、登出；单元测试覆盖合法与错误快照。
- `apps/mobile/src-tauri/src/chat.rs`：Responses 请求组装与可见文本提取；单元测试覆盖标准输出与 reasoning 排除。
- `apps/mobile/src-tauri/src/lib.rs`：注册状态及 Tauri 命令。
- `apps/mobile/src-tauri/Cargo.toml`：添加网络及密码学依赖。
- `apps/mobile/src/model.ts`：前端账户、会话、消息的类型。
- `apps/mobile/src/sessionStore.ts`：按用户 ID 读取和保存会话，限制存储规模。
- `apps/mobile/src/App.tsx`、`App.css`：工作台、登录、对话、任务与我的；真实状态及错误反馈。
- `apps/mobile/src-tauri/tauri.conf.json`：移动尺寸与安全策略。
- `README.md`：运行与验证路径。

## 任务 1：账户与快照

- [ ] 在 `account.rs` 先添加单元测试：v2 `aiProvider` 能解出 `provider/model/harmony_api_key`；v1 `settings` 兼容；错误密码或无效 nonce 必须失败。
- [ ] 在 Windows 运行 `cargo test account --lib`，确认测试因函数缺失失败。
- [ ] 实现 `decrypt_snapshot(password, snapshot)`：只允许 Argon2id v0x13；检查 KDF 参数、salt、nonce、数据密钥长度；解密 XChaCha20Poly1305；仅提取 Harmony 配置，密钥留在 Rust 内存。测试通过。
- [ ] 实现 `mobile_login`：POST `/api/auth/login`，取 `portal_token`；GET `/api/workbuddy/settings/snapshot`；校验用户与快照；返回不含密钥的 `AccountView`。实现 `mobile_logout` 清理状态；不持久化 Cookie 或密钥。
- [ ] 提交账户闭环。

## 任务 2：独立对话

- [ ] 在 `chat.rs` 先添加单元测试：Responses 标准 `output_text` 可见，`reasoning` 不可见，空回复报错；消息超长及超量被拒绝。
- [ ] 运行 `cargo test chat --lib` 确认失败。
- [ ] 实现 `mobile_chat`：读取 Rust 内存中的 Harmony 配置，POST `https://api.harmonywatch.cn/v1/responses`；JSON 使用模型名和文本消息数组；超时与 HTTP 错误映射为短消息；仅返回助手文本。
- [ ] 运行 Rust 单元测试并提交对话网关。

## 任务 3：本地会话与移动 UI

- [ ] 编写 `model.ts` 和 `sessionStore.ts`：存储键包含用户 ID，序列化限定会话数、每会话消息数；异常存储返回空列表并可继续使用。
- [ ] 改造 `App.tsx`：未登录显示账户表单；登录后四标签工作台；新建/打开/删除对话；发送中、失败重试和成功持久化。Harvis、技能、任务、记忆入口清楚说明真实接入状态。
- [ ] 改造 `App.css`：品牌色、线性 SVG、48dp 控件、卡片按压反馈、减少动态效果适配、安全区与小屏可读布局。移除 Tauri/React 演示资源与无关命令。
- [ ] 运行 `npm run build` 并核对各页无静态假任务或假设备。
- [ ] 提交 UI 与本地会话。

## 任务 4：Android 验证

- [ ] 在 Windows 运行 `scripts\windows\Build-AndroidDebug.cmd`，确认 APK 实际生成且签名有效。
- [ ] 运行 `adb devices -l`；设备可用时安装并启动，记录安装是否受 MIUI 权限拦截以及运行日志。
- [ ] 更新 README 的真实完成范围、已验证结果与剩余闭环，提交文档。

## 验收观察

- 账号无快照、非 Harmony 配置或 Key 缺失时显示明确错误，不显示伪配置成功。
- 登录不同账户不会互相读取本地会话；登出后密钥不会留在 React/localStorage。
- 手机和电脑没有连接时，轻量对话仍能发送；API 失败保留会话内容与可重试入口。
- 远程任务、Harvis、技能、记忆均有入口和真实能力说明，不以样例数据冒充服务结果。
