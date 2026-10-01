# Harmony Work Mobile

Android 优先的 HarmonyWork 移动端，后续支持 iOS。

## 当前状态

Android 第一阶段已具备个人账户登录、加密云模型配置解锁、手机独立 Harmony Responses 对话，以及按账户隔离的本地会话。2026-10-01 增加 Windows 桌面端扫码绑定、跨端会话同步与远端任务交接的代码路径；真机扫码当前仍立即失败，完整绑定与任务闭环尚未验收。现状和节后待办见 [假期前交接](docs/2026-10-01-holiday-handoff.md)。

- Android 项目：`E:\harmony-work-mobile`，Git 分支 `feat/mobile-desktop-bridge`
- Windows 桌面连接分支：`E:\harmony-work-mobile-bridge`，Git 分支 `feat/windows-mobile-bridge`
- 自建协调服务：`https://remote.harmonywatch.cn/api/mobile`，A 记录直指 `61.150.31.150`，部署在 11.29 的 `harmonywork-remote.service`
- Debug APK：`apps/mobile/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`

## 连接与数据路径

桌面端左下角手机图标生成 5 分钟一次性二维码；手机在「我的设备」中扫码，同一账户完成绑定。MuMu 无摄像头时可复制配对内容。手机会话自动同步到 11.29，再由已绑定桌面端导入本地会话列表。任务采用服务端队列和租约，Windows 端在后台轮询，执行后写回状态和结果；断线后可按租约重试。

绑定后两端还会尝试 WebRTC DataChannel 直连，用于低延迟任务提醒；NAT 或网络限制使直连失败时，HTTPS 队列继续工作。当前不提供文件 P2P 传输，任务正文和结果始终经过自建服务。会话和任务内容以明文存储于 11.29 的 PostgreSQL；模型 API Key 在运行时由移动端 Rust 使用，并随会话经 Android Keystore 加密保存在应用私有存储，不写入桥接数据库。

Harvis 生图、技能远程管理与跨端记忆目前只有真实状态入口，尚未接入功能。移动端登录后需保持网络，桌面端需运行并保持个人账户已登录才能领取任务。

## 目录

```text
apps/mobile/          Tauri Android 应用工程
packages/protocol/    跨端任务协议边界（尚未定义实现）
scripts/windows/     Windows 环境检查工具
docs/                架构决策、环境评估与准备计划
```

## 环境检查

在目标 Windows 的 PowerShell 中运行：

```powershell
Set-Location E:\harmony-work-mobile
powershell.exe -NoProfile -File .\scripts\windows\Inspect-AndroidEnvironment.ps1
```

报告写入 `reports/android-environment.json`，不进入 Git。脚本不安装 SDK、不修改系统环境变量、不启用虚拟化、不重启机器；工具版本探测仅启动所列开发工具，ADB 版本检查不连接设备。

已通过 SSH 在 Windows 执行检查脚本并安装命令行工具链。JDK、SDK/NDK、Rust ARM64 target、前端及 APK 构建已验证。使用 `scripts\windows\Test-MobileRust.cmd` 运行 Rust 单元测试，`scripts\windows\Build-AndroidDebug.cmd` 构建 APK，产物在 `apps\mobile\src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk`。具体 APK 大小和 SHA256 以当前构建产物为准。

Android 登录后，手机从账户服务取得加密设置快照，在 Rust 内存中解锁 Harmony API Key；会话凭证与 API Key 由 Android Keystore 加密持久化，以便进程退出后恢复登录。Cookie、密码和 API Key 不进入前端本地存储。本地对话保存在 WebView localStorage，并按账户 ID 隔离。设备绑定和远端任务已有代码路径但完整闭环未验收；跨端记忆尚未接入，相关页面会展示真实状态。

参见 [环境评估](docs/windows-android-environment.md)、[架构决策](docs/architecture.md)、[准备计划](docs/superpowers/plans/2026-09-30-android-bootstrap.md)。
