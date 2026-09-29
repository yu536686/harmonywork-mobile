# Android 工程准备与环境验收计划

> 面向 AI 代理的工作者：使用 executing-plans 按步骤内联执行；本计划不要求子代理。

**目标：** 创建 E 盘独立项目和 Git 基线，确定 Windows 开发环境的可行性与真实缺口。

**架构：** 移动应用独立于桌面仓库；跨端任务协议与手机应用分目录。Windows 在 E 盘本地构建，Mac 通过 SMB 编辑文件。

**技术栈：** Git、PowerShell 5.1+；应用候选为 Tauri 2、React、TypeScript、Rust。

## 任务 1：准备仓库

- [x] 核实 E 盘共享映射和项目目录不存在。
- [x] 创建 README、目录说明、架构决策、忽略规则和行尾规则。
- [x] 初始化 main；在 Windows 检查文件与暂存区，在首个提交后以 git status、git log 和 git fsck 验证仓库。

## 任务 2：环境评估

- [x] 记录已验证的共享空间和现有 Rust 工具文件。
- [x] 查阅 Tauri 与 Android 官方宿主和模拟器要求。
- [x] 保存 PowerShell 探测脚本，区分未发现与探测失败。
- [x] 恢复 Windows 命令连接并在 Windows 执行环境检查：

```powershell
Set-Location E:\harmony-work-mobile
powershell.exe -NoProfile -File .\scripts\windows\Inspect-AndroidEnvironment.ps1
Get-Content .\reports\android-environment.json
```

预期：生成报告，逐项标记工具、硬件、SDK 和虚拟化实际状态。脚本成功产出报告不代表构建链就绪。

## 任务 3：阶段结论

- [x] 将 Windows 实测结果更新到 docs/windows-android-environment.md。
- [ ] 根据报告形成确切安装清单，安装后验证 SDK/JDK/NDK 和 Rust targets。
- [ ] 通过首个真实 APK 构建与设备启动后，才开始功能开发验收。

任务 3 的安装和应用实现属于下一阶段；当前请求的完成标准为项目/Git 已建立以及可行性与未验证项如实交付。SSH 已恢复；部署前需释放内存并安装 Android 工具链。模拟器还需验证 WHPX 加速。
