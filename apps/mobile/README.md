# HarmonyWork Mobile Android 工程

Tauri 2 + React + TypeScript 的 Android 工程基线。当前界面仍是框架默认演示页，仅用于验证构建链；账户对话、远端任务、Harvis、技能和记忆尚未接入。

Windows 项目路径：`E:\harmony-work-mobile\apps\mobile`。已用 `create-tauri-app` 4.7.4 生成工程，并运行 `tauri android init`。Android 工程位于 `src-tauri\gen\android`。

在目标 Windows 上构建 ARM64 debug APK：

```cmd
E:\harmony-work-mobile\scripts\windows\Build-AndroidDebug.cmd
```

脚本在当前进程加载 Visual Studio C++ Build Tools，使用 `C:\Android` 下的 JDK、SDK、NDK、Gradle 和独立 Cargo 缓存；不会改动桌面项目的全局 Cargo 镜像配置。构建前先确保机器有足够可用内存。

真机验收仍需要将 Android 手机连接到该 Windows 并授权 USB 调试，或将生成的 APK 安装到测试设备。仅前端构建/Gradle 打包通过不等于移动端功能已实现。
