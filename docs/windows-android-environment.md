# 远端 Windows Android 开发环境评估

日期：2026-09-30。结论：可以在该 Windows 部署 Android/Tauri Android 开发环境。SSH 已恢复并完成实测；CPU、GPU 和磁盘有开发基础，但当前内存压力极高，Android 工具链尚未配置，模拟器加速尚未就绪。本次完成工程准备和环境分析，没有安装 SDK 或交付 APK。

## 本次已核实

| 项目 | 证据与结果 |
|---|---|
| 远端主机 | 192.168.11.5 |
| E 盘映射 | SMB 的 E 共享挂载于 /Volumes/192.168.11.5 |
| 剩余空间 | df 快照约 687 GiB，足够规划 Android SDK/NDK/缓存 |
| 项目 | E:\harmony-work-mobile，新建独立仓库 |
| Rust 文件 | E:\xiaoheng-tools\cargo\bin 中存在 cargo.exe、rustc.exe、rustup.exe |
| Rust 工具链目录 | stable-x86_64-pc-windows-msvc；设置文件的默认工具链一致 |
| 桌面构建脚本 | E:\xiaoheng-tools\winbuild.cmd 引用 VS 2022 BuildTools；它强制切换到 E:\harmony-work，不能直接用于移动项目 |
| 命令连接 | 初始免交互认证失败；用户提供凭据后 SSH 实测成功，凭据未写入项目 |

## Windows 实测结果

| 项目 | 结果 |
|---|---|
| 系统 | Windows 11 专业版，64 位，10.0.26200 |
| CPU | i7-13700KF，16 核 / 24 逻辑处理器 |
| 内存 | 约 16 GB；两次快照可用仅约 38 MiB / 113 MiB |
| 高内存占用 | 4 个 cmd 进程工作集约 5770、1836、1836、1834 MiB；未终止或修改这些进程 |
| 显卡 | NVIDIA GeForce RTX 4060，另有虚拟显示驱动 |
| 磁盘 | C 盘 NVMe，剩余约 421 GiB；E 盘 Storage Spaces 内部阵列，剩余约 687 GiB；未据此推断 E 盘物理介质 |
| Git | 2.50.1.windows.1，可运行 |
| Node / npm | v24.18.0 / 11.16.0，可运行 |
| Rust / Cargo | 1.96.0 / 1.96.0，可运行 |
| Rust targets | 只有 x86_64-pc-windows-msvc，需增加 Android targets |
| Java / ADB | 当前 PATH 未发现 |
| Android Studio / SDK | 注册表、默认路径和规划路径未发现，未全盘扫描任意便携安装 |
| JAVA_HOME / NDK_HOME | 未设置 |
| WHPX | HypervisorPlatform = Disabled |
| 其他虚拟化状态 | VirtualMachinePlatform = Enabled；HypervisorPresent = true |
| 下载入口 | Google SDK、Google Maven、Gradle versions、npm、Rust manifest 均 HTTP 200，curl exit 0 |

WMI 的 VirtualizationFirmwareEnabled/SLAT 返回 false，但系统同时检测到 hypervisor，不能据此断言 CPU 不支持或 BIOS 虚拟化一定关闭。应在安装模拟器并启用适当平台后用 emulator -accel-check 和实际 AVD 启动验证。下载入口连通不等于全部 SDK/Gradle 依赖已下载验证。

报告位于 reports/android-environment.json，已通过 .gitignore 排除；提交本文的必要摘要，不提交账户凭证、原始环境转储或设备标识。Windows Git 因 SMB 创建者与 SSH 管理员不同触发所有权检查，已仅信任 E:/harmony-work-mobile，没有设置通配信任。

## 推荐安装布局

| 内容 | 规划路径 |
|---|---|
| 应用源码 | E:\harmony-work-mobile |
| Android Studio 与自带 JBR | C:\Android\android-studio |
| Android SDK / NDK | C:\Android\Sdk |
| Gradle 缓存 | C:\Android\gradle-cache |
| 模拟器镜像 | C:\Android\avd |
| 移动专用 Cargo 构建缓存 | C:\Android\cargo-target |

这是规划路径，尚未安装。源码依用户要求留在 E 盘；SDK 与高频编译缓存建议放剩余空间充足的 C 盘 NVMe，减少 E 盘阵列随机 I/O 对编译的影响。先使用项目启动脚本设置进程级 JAVA_HOME、ANDROID_HOME、NDK_HOME、GRADLE_USER_HOME、ANDROID_AVD_HOME 和 CARGO_TARGET_DIR，避免影响既有桌面构建。SDK、NDK、JDK、Gradle/AGP 版本必须与生成的 Tauri Android 工程兼容，并记录确切版本；不要混用任意最新版本。

## 三类能力分别验收

### 1. 命令行构建 APK

Windows 可以执行 Node/前端构建、Rust Android 交叉编译与 Gradle 打包。需要 Node、Rust、JDK、SDK Platform/Build Tools/Platform Tools/Command-line Tools、NDK。ARM64 真机需要 aarch64-linux-android；x86_64 模拟器需要 x86_64-linux-android。无需先跑模拟器，也不依赖 GPU 或虚拟化加速来编译 APK。

### 2. 模拟器运行

官方 Windows Studio + Emulator 最低 RAM 为 16 GB，推荐 32 GB；还需满足 CPU、GPU 和虚拟化条件。优先 Windows Hypervisor Platform (WHPX)。安装后运行 emulator -accel-check 并实际启动 AVD，才能确认可用。启用 Windows 功能可能需要重启，不能在未安排维护时间时自动重启。

远程命令构建和交互式模拟器是不同能力。可以在 Windows 交互桌面上使用 Android Studio，也可验证无窗口 AVD；不能把远程桌面画面是否流畅等同于 APK 构建是否可行。

### 3. 真机调试

最直接是 Android 手机 USB 接到这台 Windows，手机确认调试授权后检查 adb devices -l。手机插在 Mac 上不会自动变成 Windows 的 ADB 设备。无线调试需设备配对且网络可达；也可由 Windows 构建 APK，再在 Mac/手机侧安装测试。不要公开暴露 ADB 端口。

## 部署顺序

已恢复远端命令认证并运行报告；接下来先释放现有内存占用 → 安装缺少的 Android 工具并锁定版本 → 配置进程级路径 → 验证 Rust targets 和 SDK packages → 生成移动工程 → 构建 ARM64 debug APK → 真机安装启动 → 另行验证模拟器和推送/恢复。

从 Windows 的 E 盘源码路径启动构建，缓存可放 C 盘 SSD；Mac SMB 仅用于编辑/交付；不要通过 SMB 运行大规模依赖安装和编译。

## 官方依据（本次已查阅）

- https://v2.tauri.app/start/prerequisites/#android
- https://developer.android.com/studio/install
- https://developer.android.com/studio/run/emulator-acceleration

iOS 的 Xcode 构建仍需要 macOS，不能由这台 Windows 单独完成。
