# 手机与 Windows 双向设备管理实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（- [ ]）语法跟踪进度。

**目标：** 手机和 Windows 都能看到并解除各自的绑定；手机显示电脑真实设备名；一台 Windows 连续绑定多台手机仍是同一个桌面设备。

**架构：** 11.29 的设备表与 link 表是绑定真相源，桌面配对时复用已有有效设备 ID 与令牌。解绑按 link 主键删除并取消该关系内尚未终结的任务，服务端授权即时失效。两端通过阶段 A 的变更流刷新列表。

**技术栈：** Express 5、PostgreSQL、Windows Tauri/Rust/React、Android Tauri 2/Rust/React。

**来源规格：** docs/superpowers/specs/2026-10-11-live-sync-device-management-attachments-design.md 的阶段 B。依赖 2026-10-11-mobile-desktop-live-sync.md 任务 3 的变更流。

---

## 文件与职责

- 门户 src/server/mobile-bridge.ts：配对设备复用、名称更新、DELETE /links、有效绑定鉴权。
- 门户 src/server/mobile-bridge-routes.integration.test.ts：一台电脑多手机、任意一端解绑、权限即时撤销。
- Windows src-tauri/src/commands/mobile_bridge.rs：真实 Windows 设备名、配对复用、列表与解绑命令。
- Windows src/components/MobileBridgeWizard.tsx：绑定手机列表、解绑确认、二维码仍可用。
- Windows src/components/MobileBridgeWizard.test.tsx：列表和解绑交互。
- Android apps/mobile/src-tauri/src/bridge.rs：解绑命令。
- Android apps/mobile/src/App.tsx 与 apps/mobile/src/bridge.ts：设备列表删除、默认电脑回退。
- Android apps/mobile/tests/bridge.test.mjs：默认电脑回退及设备列表边界。

## 任务 1：服务端配对复用与名称

- [ ] 在 mobile-bridge-routes.integration.test.ts 加失败测试：同一 desktopDeviceId 连续生成两张配对码并绑定两台手机，GET /devices 返回两条 link 和同一个 desktopDeviceId；错误令牌不得复用设备。
- [ ] POST /pairings 增加可选 desktopDeviceId：传入时必须与 X-Harmony-Device-Id 一致且 deviceAuthorized(..., "desktop") 为真；仅在未传 ID 时创建新设备和令牌。已有设备名称在事务内更新，响应复用请求头中已验证的设备令牌供旧客户端兼容；新设备仍返回新令牌。请求体不得接受任意 userId、tokenHash。
- [ ] 添加 PATCH /devices/:id/name：只允许该设备凭自己的有效令牌更新，名称 trim 后 1–80 字符；写设备变更通知。测试别的账户、手机改电脑名称、超长名称都被拒绝。
- [ ] 运行 npm run test:server、npm run build:server，提交服务端变更。

## 任务 2：服务端解绑及执行撤销

- [ ] 加失败测试：DELETE /links/:desktopId/:mobileId 可由 link 任一有效参与设备发起、重复调用幂等；第三方设备、另一账户返回 403；解绑后会话/任务/信令/附件授权均失效，其余 link 仍可用。
- [ ] schema 扩展任务 status 约束以接受 cancelled。DELETE 在事务中验证参与设备，删除指定 link，取消 queued/claimed 任务并写 cancelled 任务事件与设备变更；保留历史消息。正在执行的旧租约续租必须 409，完成请求也必须 409。Android RemoteTask 类型与任务页映射同步加入 cancelled。
- [ ] 补查所有 API 授权路径：session 列表、messages、tasks、signals、task-events、changes 与 SSE 都要重新检查有效 link；不能仅凭未撤销的设备令牌访问已解绑关系。
- [ ] 运行 npm run test:server、npm run typecheck；部署 11.29，先用测试账号验证再验证实际绑定。提交并记录 SHA。

## 任务 3：Windows 命令与向导

- [ ] Rust 测试 Windows 名称读取：ComputerName/COMPUTERNAME 非空时使用系统名，长度限制 80；失败退回 Harmony Work Windows。名称仅从本机 OS 读取，UI 不提供伪装字段。
- [ ] mobile_bridge_start_pairing 读取已保存 desktop ID/令牌；有效时把 ID 传给服务端，服务端拒绝时清理过期设备身份并仅在明确失效场景创建新身份。mobile_bridge_unlink(desktopId,mobileId) 发 DELETE，mobile_bridge_devices 保持现有 GET。
- [ ] MobileBridgeWizard.tsx 打开时加载绑定手机列表，设备变更提示时刷新；每项显示 mobileName、解绑按钮和确认弹窗。解绑成功后移除该手机卡片及其 P2P 通道，不影响其他手机或当前二维码。
- [ ] 运行 npm run test -- MobileBridgeWizard、npm run build:web、Windows cargo test；同一电脑绑定两台手机并解绑一台。提交 Windows 变更。

## 任务 4：Android 设备页

- [ ] bridge.test.mjs 先测 selectPreferredDesktop：删除当前默认电脑后选择剩余第一台；无剩余设备返回空字符串。
- [ ] bridge.rs 增加 bridge_unlink(desktop_device_id,mobile_device_id)，复用当前 Cookie/设备头；App.tsx 的设备列表每项加入删除按钮，确认文案包含实际电脑名和“该电脑将不能继续执行此手机任务”。
- [ ] 成功解绑后 refreshDevices，并以 selectPreferredDesktop 更新选中设备与本地偏好；若 P2P peer 正对该电脑，停止连接。失败保留列表并展示服务端错误；历史会话不删除。
- [ ] 运行 node --test apps/mobile/tests/*.test.mjs、npm --prefix apps/mobile run build、Android debug APK 构建；MuMu 与小米各验证显示 Windows 名称和双向解绑。提交 Android 变更。

## 验收

- [ ] 两台手机绑定同一台 Windows 后，桌面列表两项，各手机显示同一真实 Windows 名。
- [ ] 手机端或桌面端解绑其中一个，两个列表无需重启即一致；另一手机仍可发送消息和任务。
- [ ] 已解绑手机不能读写原共享会话、领取任务、连接 P2P 或取得附件；正在运行的电脑任务被取消且不会再回传成果。
