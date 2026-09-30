# 远端 Windows Android 开发环境评估

日期：2026-09-30。结论：该 Windows 已部署 Android/Tauri 命令行开发环境，首个 ARM64 debug APK 已构建并验证签名。CPU、GPU 和磁盘有开发基础；内存压力仍高，Android Studio 图形界面、模拟器及真机运行尚未验收。

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
| 内存 | 约 16 GB；初始两次快照可用仅约 38 MiB / 113 MiB；用户自行释放后构建时约 1.3 GiB |
| 高内存占用 | 初始 4 个 cmd 进程工作集约 5770、1836、1836、1834 MiB；本次未主动终止或修改这些进程 |
| 显卡 | NVIDIA GeForce RTX 4060，另有虚拟显示驱动 |
| 磁盘 | C 盘 NVMe，剩余约 421 GiB；E 盘 Storage Spaces 内部阵列，剩余约 687 GiB；未据此推断 E 盘物理介质 |
| Git | 2.50.1.windows.1，可运行 |
| Node / npm | v24.18.0 / 11.16.0，可运行 |
| Rust / Cargo | 1.96.0 / 1.96.0，可运行 |
| Rust targets | 已安装 x86_64-pc-windows-msvc、aarch64-linux-android；其他 Android ABI 未安装 |
| Java / ADB | 已安装 Temurin JDK 21.0.12.1；Platform-Tools 37.0.1 含 ADB |
| Android Studio / SDK | 未安装 Studio 图形界面；SDK 命令行工具 15859902 已安装并校验 SHA256 |
| SDK / NDK | Platform 36、37.0；Build-Tools 36.0.0、37.0.0；NDK 28.2.13676358 |
| JAVA_HOME / NDK_HOME | 未改用户/系统环境变量；由移动工程脚本设置进程级路径 |
| WHPX | HypervisorPlatform = Disabled |
| 其他虚拟化状态 | VirtualMachinePlatform = Enabled；HypervisorPresent = true |
| 下载入口 | Google SDK、Google Maven、Gradle versions、npm、Rust manifest 均 HTTP 200，curl exit 0 |

WMI 的 VirtualizationFirmwareEnabled/SLAT 返回 false，但系统同时检测到 hypervisor，不能据此断言 CPU 不支持或 BIOS 虚拟化一定关闭。应在安装模拟器并启用适当平台后用 emulator -accel-check 和实际 AVD 启动验证。下载入口连通不等于所有未来依赖均可下载；本次 APK 所需依赖已成功解析。

报告位于 reports/android-environment.json，已通过 .gitignore 排除；提交本文的必要摘要，不提交账户凭证、原始环境转储或设备标识。Windows Git 因 SMB 创建者与 SSH 管理员不同触发所有权检查，已仅信任 E:/harmony-work-mobile，没有设置通配信任。

## 推荐安装布局

| 内容 | 规划路径 |
|---|---|
| 应用源码 | E:\harmony-work-mobile |
| Temurin JDK 21 | C:\Android\jdk-21（已安装） |
| Android SDK / NDK | C:\Android\Sdk（已安装） |
| Gradle 缓存 | C:\Android\gradle-cache（构建时使用） |
| 模拟器镜像 | C:\Android\avd |
| 移动专用 Cargo 下载/构建缓存 | C:\Android\cargo-home-harmonywork、C:\Android\cargo-target\harmony-work-mobile |

源码依用户要求留在 E 盘；SDK 与高频编译缓存放在 C 盘 NVMe。`Use-AndroidEnvironment.ps1` 和 `Build-AndroidDebug.cmd` 设置进程级路径，避免影响既有桌面构建。Windows 全局 Cargo 使用 rsproxy 镜像，Cargo 对该镜像的 TLS 握手失败；移动工程改用独立 CARGO_HOME 后，直连 crates.io 下载已验证。生成的 Tauri Android 工程使用 AGP 9.3.1、Gradle 9.6.1、compileSdk/targetSdk 37，所以补装 Platform 37.0 和 Build-Tools 37.0.0。

## 三类能力分别验收

### 1. 命令行构建 APK

Windows 可以执行 Node/前端构建、Rust Android 交叉编译与 Gradle 打包。需要 Node、Rust、JDK、SDK Platform/Build Tools/Platform Tools/Command-line Tools、NDK。ARM64 真机需要 aarch64-linux-android；x86_64 模拟器需要 x86_64-linux-android。无需先跑模拟器，也不依赖 GPU 或虚拟化加速来编译 APK。

已运行 `scripts\windows\Build-AndroidDebug.cmd`，Tauri 报告构建成功。产物为 `E:\harmony-work-mobile\apps\mobile\src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk`，大小 26,481,149 字节，SHA256 为 `8c97016880c13c496c15dfd72cb14ca6b080c7810e2bc3972be719debe647116`。`apksigner verify` 通过 v2 签名；`aapt dump badging` 显示包名 `com.harmonywork.mobile`、版本 `0.1.0`、minSdk 24、targetSdk 37、原生 ABI `arm64-v8a`。当前 APK 只包含框架默认演示页。

首次构建遇到 Windows 全局 Cargo 镜像 TLS 握手、MSVC 环境未加载、Gradle 发行包默认 10 秒超时和 Java 未使用本地代理等独立环境问题。移动工程的专用 Cargo 缓存、`vcvars64.bat`、Gradle Wrapper `networkTimeout=120000` 与 SHA256 校验，以及构建脚本的 JVM 代理传递已经解决；最终构建成功。Gradle/AGP 仍打印旧 API 和 Java 8 兼容性警告，Kotlin daemon 曾回退为进程内编译，均未阻止产出 APK。

### 2. 模拟器运行

官方 Windows Studio + Emulator 最低 RAM 为 16 GB，推荐 32 GB；还需满足 CPU、GPU 和虚拟化条件。优先 Windows Hypervisor Platform (WHPX)。安装后运行 emulator -accel-check 并实际启动 AVD，才能确认可用。启用 Windows 功能可能需要重启，不能在未安排维护时间时自动重启。

远程命令构建和交互式模拟器是不同能力。可以在 Windows 交互桌面上使用 Android Studio，也可验证无窗口 AVD；不能把远程桌面画面是否流畅等同于 APK 构建是否可行。

### 3. 真机调试

最直接是 Android 手机 USB 接到这台 Windows，手机确认调试授权后检查 adb devices -l。手机插在 Mac 上不会自动变成 Windows 的 ADB 设备。无线调试需设备配对且网络可达；也可由 Windows 构建 APK，再在 Mac/手机侧安装测试。不要公开暴露 ADB 端口。

## 部署顺序

已恢复远端命令认证、安装并验证命令行工具、生成移动工程和 Android 原生工程，并成功构建 ARM64 debug APK。下一步是真机安装启动；`adb devices -l` 本次最终未列出在线设备，所以不能声称运行验收。模拟器、推送/恢复与产品功能另行验证。最初现有 4 个 cmd 进程占用约 11 GiB，本次未主动终止；用户自行释放部分内存后完成构建。

从 Windows 的 E 盘源码路径启动构建，缓存可放 C 盘 SSD；Mac SMB 仅用于编辑/交付；不要通过 SMB 运行大规模依赖安装和编译。

## 官方依据（本次已查阅）

- https://v2.tauri.app/start/prerequisites/#android
- https://developer.android.com/studio/install
- https://developer.android.com/studio/run/emulator-acceleration
- https://adoptium.net/temurin/releases/

iOS 的 Xcode 构建仍需要 macOS，不能由这台 Windows 单独完成。
