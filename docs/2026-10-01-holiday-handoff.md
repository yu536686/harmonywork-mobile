# 2026-10-01 假期前交接：Harmony Work Mobile

本文件记录 **2026-10-01 停工时** 的实际状态。当前分支是工作检查点，扫码绑定尚未验收，不能当作可发布版本。

## 代码与运行环境

| 项目 | 位置 / 状态 |
| --- | --- |
| Android 仓库 | Windows `E:\harmony-work-mobile`，分支 `feat/mobile-desktop-bridge`，GitHub 私有仓库 `yu536686/harmonywork-mobile`，PR #1（草稿） |
| Windows 桌面端 | `E:\harmony-work-mobile-bridge`，分支 `feat/windows-mobile-bridge`，`yu536686/harmony-work` PR #1；Windows 版本号 1.0.8 |
| Windows 安装包 | `E:\harmony-work-mobile-bridge\release\full\Harmony-Work-1.0.8-x64-setup.exe` |
| 协调服务 | `https://remote.harmonywatch.cn/api/mobile`，11.29 服务器上的 `harmonywork-remote.service`；本次未改动 |
| 最新 Android Debug APK | `E:\harmony-work-mobile\apps\mobile\src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk`，2026-10-01 17:32 构建，约 716 MiB，SHA-256 `e482fda22542838197c1c1e1d5a89df15c49915caad28dfff9292f689c37e910` |
| 测试设备 | 小米真机 ADB `a80fdf4b`，MuMu `emulator-5554`；上述 APK 已覆盖安装到两台设备 |

## 已实现及验证范围

- 第一阶段基础：个人账户登录、加密云模型配置解锁、手机独立 Harmony Responses 对话、按账户隔离的本地会话，已经形成代码路径。不要把本次检查点视为完整功能验收。
- Windows 连接基础：桌面端二维码向导、服务端设备绑定与任务接口、手机端设备/任务页面、会话同步及桌面端领取执行路径已有实现。服务器 API 曾做过冒烟检查，但 **真机扫码绑定到远端执行的完整闭环尚未通过**。
- 小米导航布局：移除 Android `enableEdgeToEdge()` 并调整视口/安全区后，已通过小米首页、会话页、任务页截图核对底部导航位置。
- 登录状态：Android Keystore + AES-GCM 加密保存会话到应用私有存储；小米经系统返回退出、进程 PID 变化后重新打开仍在首页。覆盖安装新版 APK 后，MuMu 登录可进入首页。退出登录会清除保存的会话。
- 手动配对输入：解析器可识别完整 `harmonywork://pair?...` URI 和桌面复制的查询参数文本；Node 单元测试通过。界面实际绑定仍需验证。
- 登录页：增加 `adjustResize`、可视视口高度及输入框聚焦滚动，缩小 Logo 与标题间距；MuMu 做过视觉检查，小米键盘遮挡尚需复测。
- 扫码界面：已增加返回/取消控件，并尝试将 ML Kit 二维码模型打包进 APK；**当前两台设备打开扫码窗口后仍立即关闭并显示“操作失败，请稍后重试”**。

## 当前阻塞与待办（按接手顺序）

1. **优先修复扫码即时失败。** 在小米和 MuMu 均可复现：登录 → 连接电脑 → 扫描桌面二维码，窗口一闪即退。`apps/mobile/src/App.tsx` 的 `scanPairing()` 当前调用插件 `requestPermissions()` 后调用 `scan({ windowed: true })`，通用错误文案掩盖了底层异常。先记录原始插件错误及 Android logcat，区分权限、插件原生 Activity、扫描器初始化和模型加载问题，再做修复；若插件路径不稳定，可评估自建 CameraX + ML Kit 扫描 Activity。修复后必须在两台设备对桌面端真实二维码验证自动识别、返回/取消和权限拒绝行为。
2. **完成绑定闭环。** 扫码成功后核对账户一致性、配对码过期/重放、设备凭证保存与重新打开、服务端绑定列表；同时实测手动粘贴完整配对内容。
3. **完成会话/任务闭环。** 手机新建会话 → 桌面出现“手机端”标记；手机派发复杂任务 → Windows 领取执行 → 状态/成果回传。分别检查桌面在线、断线重连和 HTTPS 回退路径。
4. **补齐 Android 仪器测试。** `src-tauri/gen/android/app/src/androidTest` 下的 `BarcodeModelTest.kt`、`SessionVaultTest.kt` 和二维码样本是未完成测试。上次 `assembleUniversalDebugAndroidTest` 在编译测试代码时无法解析 `BarcodeScannerOptions` / `BarcodeScanning`，尽管已添加 `androidTestImplementation("com.google.mlkit:barcode-scanning:17.3.0")`；需先修复测试 classpath，再在 MuMu / 小米运行。直接调用 Gradle 的 connected 测试还会遇到 Tauri Rust build options 文件依赖，应从 Tauri 构建环境运行或排除相关任务后安装测试 APK。
5. **复测小米登录键盘** 与系统手势导航，检查顶部/底部安全区及不同软键盘高度；MuMu 登录曾因设备上旧版 APK 缺少 `SessionVault` JNI 类而闪退，覆盖安装新版后用户确认可进入首页。
6. 扫码与任务闭环稳定后，继续 Harvis 图片生成、技能远程管理、跨端记忆；这三项目前仍是状态入口，尚未接通执行接口。

## 接手时的验证命令

在 Windows 的 `E:\harmony-work-mobile`：

```powershell
node --test apps/mobile/tests/*.test.mjs
E:\harmony-work-mobile\scripts\windows\Build-AndroidDebug.cmd
C:\Android\Sdk\platform-tools\adb.exe devices -l
C:\Android\Sdk\platform-tools\adb.exe -s a80fdf4b install -r E:\harmony-work-mobile\apps\mobile\src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk
C:\Android\Sdk\platform-tools\adb.exe -s emulator-5554 install -r E:\harmony-work-mobile\apps\mobile\src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk
```

最后一次 `node --test apps/mobile/tests/*.test.mjs` 通过 4 项，Android Debug APK 构建成功；这些只证明对应命令和安装包生成。扫码仍失败，仪器测试未通过，未做发布版验收。节后重新运行验证并以实际输出为准。

## 安全与发布备注

会话凭证和模型 API Key 随移动会话由 Android Keystore 加密保存在应用私有存储，运行时在 Rust 内存解锁；不得记录真实账户密码、API Key、设备令牌或二维码密钥。桥接服务中的会话/任务正文目前是服务器数据库明文，后续发布前需要单独评估隐私与权限边界。当前 PR 保持草稿，不合并。
