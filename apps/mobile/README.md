# HarmonyWork Mobile Android 工程

Tauri 2 + React + TypeScript 的 Android 客户端。当前已实现个人账户登录与加密模型配置解锁、手机独立的 Harmony Responses 轻量对话、扫码绑定 Windows、手机会话同步、远端任务提交和结果回收。Harvis 生图、技能远程管理和跨端记忆在界面中标明为后续能力，尚未接入执行接口。

连接服务部署在 `remote.harmonywatch.cn`（直达 61.150.31.150 的 11.29 服务器）。绑定流程设计为给本机颁发独立设备凭证，但当前真机扫码失败，尚未完成绑定验收。会话与任务内容保存在该自建服务器的 PostgreSQL 中；模型 API Key 在手机客户端 Rust 内存中使用，并随会话由 Android Keystore 加密持久化。WebRTC 数据通道只用于低延迟更新提示，HTTPS 任务队列和结果接口始终是可靠路径。

Windows 项目路径：`E:\harmony-work-mobile\apps\mobile`。已用 `create-tauri-app` 4.7.4 生成工程，并运行 `tauri android init`。Android 工程位于 `src-tauri\gen\android`。

在目标 Windows 上构建 ARM64 debug APK：

```cmd
E:\harmony-work-mobile\scripts\windows\Build-AndroidDebug.cmd
```

脚本在当前进程加载 Visual Studio C++ Build Tools，使用 `C:\Android` 下的 JDK、SDK、NDK、Gradle 和独立 Cargo 缓存；不会改动桌面项目的全局 Cargo 镜像配置。构建前先确保机器有足够可用内存。

调试 APK 位于 `src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk`。MuMu 模拟器可通过 `C:\Android\Sdk\platform-tools\adb.exe -s emulator-5554 install -r <APK 路径>` 安装。当前已验证编译、两台 Android 设备安装及登录后进入首页；扫码会立即报错，真实绑定与任务闭环未验收。详情见 [假期前交接](../../docs/2026-10-01-holiday-handoff.md)。
