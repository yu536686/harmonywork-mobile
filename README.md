# Harmony Work Mobile

Android 优先的 HarmonyWork 移动端，后续支持 iOS。

## 当前状态

2026-09-30：已建立独立 Git 仓库和 Tauri 2 + React + TypeScript Android 工程。远端 Windows 已安装 JDK、SDK、NDK 和 ARM64 Rust target。第一阶段已将框架演示页替换为正式移动界面，实现账户登录、兼容桌面端的加密云设置解密、手机独立调用 Harmony Responses，以及按账户隔离的本地对话。前端构建、Rust 单元测试和 ARM64 Debug APK 构建通过；APK 已安装在小米真机与 MuMu。MuMu 上已观察到真实账户登录后的独立会话和模型回复。

- Windows 项目路径：`E:\harmony-work-mobile`
- Mac 已挂载路径：`/Volumes/192.168.11.5/harmony-work-mobile`
- 桌面项目：`E:\harmony-work`，保持独立，不复制桌面运行环境。
- 技术基线：Tauri 2、React、TypeScript、Rust；Android 工程已生成，产品功能仍待实现。

## 产品边界

手机小亨通过个人账户模型配置独立对话并完成轻量任务。需要本地文件、桌面软件或复杂执行环境时，将完整子任务委派给已授权电脑。服务端持久化任务状态；手机断线后远端继续执行，重连获取进度与成果。

产品目标保留对话、Harvis 图片生成、技能远程管理、任务、记忆。第一阶段已接入独立文本对话，其余功能有明确入口和真实接入状态，尚未宣称完成远端服务。任务消息先走 HTTPS/WSS；文件独立传输，P2P 在后续阶段验证。

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

已通过 SSH 在 Windows 执行检查脚本并安装命令行工具链。JDK、SDK/NDK、Rust ARM64 target、前端及 APK 构建已验证。使用 `scripts\windows\Test-MobileRust.cmd` 运行 Rust 单元测试，`scripts\windows\Build-AndroidDebug.cmd` 构建 APK，产物在 `apps\mobile\src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk`。当前 Debug APK 为 55,037,832 字节，SHA256 `efef85398e591da256928731b0448b4b2f66f2d6568d56472eb7d524a79e6929`。新构建会改变哈希。

Android 登录后，手机从账户服务取得加密设置快照，并只在 Rust 内存中解锁 Harmony API Key。Cookie、密码和 API Key 不进入前端本地存储；关闭进程后需要重新登录。本地对话保存在 WebView localStorage，并按账户 ID 隔离。当前没有设备绑定、后台任务或跨端记忆服务，相关页面不会展示虚假数据。

参见 [环境评估](docs/windows-android-environment.md)、[架构决策](docs/architecture.md)、[准备计划](docs/superpowers/plans/2026-09-30-android-bootstrap.md)。
