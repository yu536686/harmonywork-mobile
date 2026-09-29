# Mobile app boundary

这里将生成独立的 Tauri 2 + React + TypeScript 移动应用，Android 首先交付。

共享纯业务逻辑和协议类型；不引入桌面进程启动、桌面 MCP、自动化、终端和任意文件系统访问依赖。

在 SDK/NDK/JDK 安装和 Rust Android targets 验证后，再初始化框架并执行第一轮 APK 构建。当前目录不是可构建应用。
