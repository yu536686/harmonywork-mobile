# Harmony Work Mobile

Android 优先的 HarmonyWork 移动端，后续支持 iOS。

## 当前状态

2026-09-30：已建立独立项目目录与 Git 仓库基础文件。本阶段为工程准备与 Windows 开发环境评估，尚无可运行 App、APK 或 Android 构建通过记录。

- Windows 项目路径：`E:\harmony-work-mobile`
- Mac 已挂载路径：`/Volumes/192.168.11.5/harmony-work-mobile`
- 桌面项目：`E:\harmony-work`，保持独立，不复制桌面运行环境。
- 技术方向：Tauri 2、React、TypeScript、Rust；通过 Android/iOS 技术验证后锁定具体依赖版本。

## 产品边界

手机小亨通过个人账户模型配置独立对话并完成轻量任务。需要本地文件、桌面软件或复杂执行环境时，将完整子任务委派给已授权电脑。服务端持久化任务状态；手机断线后远端继续执行，重连获取进度与成果。

首版保留对话、Harvis 图片生成、技能远程管理、任务、记忆。任务消息先走 HTTPS/WSS；文件独立传输，P2P 在后续阶段验证。

## 目录

```text
apps/mobile/          手机应用目录（尚未生成框架代码）
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

已通过 SSH 在 Windows 执行检查脚本。Git、Node、Rust 可运行；JDK/SDK/NDK 和 Rust Android targets 尚未就绪，尚未安装 Android 工具或构建 APK。

参见 [环境评估](docs/windows-android-environment.md)、[架构决策](docs/architecture.md)、[准备计划](docs/superpowers/plans/2026-09-30-android-bootstrap.md)。
