# 更新记录

laoshi 的版本号遵循语义化版本，从 0.1.0 开始；每一版的标题写成 `## <版本> - <日期>`。每一版先写使用者会看到的变化，再写升级须知。laoshi 之前的历史见 paseo-req-kit 的更新记录（laoshi 从它的 1.15.0 抽出）。

## 0.1.0 - 2026-11-05

第一个正式版：paseo-req-kit 的需求开发体系，抽成不绑定平台的工具包，支持 Paseo 和 DeepSeek Harness。

### 使用者会看到的变化

- **新的名字和命令**：对话中的入口是 `/laoshi`、`/laoshi-setup`、`/laoshi-doctor`、`/laoshi-retro`；终端命令是 `laoshi`（`req` 是它的别名）。
- **支持 DeepSeek Harness（dsh）**：步骤 agent 作为子会话挂在发起的对话下，进展和结果发回对话；各角色可以各用一个 dsh 中的模型（`<提供方>/<模型>`，`dsh/chat-model` 用对话的模型）；`laoshi doctor` 列出可用的模型并逐个角色检查。
- **内置工作区和服务**：平台不提供时，laoshi 用 `git worktree` 为需求新建工作区，并按 `.laoshi/services.json` 启动、检查、停止项目的服务（每个工作区独立端口）。
- **一步安装**：`npx -y laoshi@latest install --platform dsh|paseo`；公司内网加 `--registry=<镜像地址>`；`laoshi upgrade` 升级或回退；`laoshi install --check`、`--uninstall`。Windows 上只用 cmd 和 Git Bash。
- **离线安装包**：完全没有 npm 源的机器，用 GitHub Release 上带 Windows 依赖的离线安装包，步骤见"内网安装与验证"。
- **文档站点**：https://yiyisf.github.io/laoshi/ ；`laoshi docs` 在本机打开和装的版本一致的文档（不需要外网）。
- **体检**：`laoshi doctor` 的"安装"一节检查 skill 是否已是这个版本的，并从 npm 源查询有没有新版本。
- **使用记录带上代码库和使用者**：使用记录、通知事件和 `laoshi api list` 中增加了代码库（目录、远程地址）和使用者（`LAOSHI_USER` 或安装级配置的 `user`）。

### 升级须知（从 paseo-req-kit）

- laoshi 和 paseo-req-kit 可以装在同一台机器上，互不覆盖：安装根是 `~/.laoshi`（只有 `~/.req-kit` 时读取它），项目配置是 `.laoshi.json`（`.requirement-pipeline.json` 继续被读取）。
- 状态文件升到第 2 版：第一次读到旧的状态文件时自动迁移，原文件留作 `.bak-v1`；正在运行的流水线只在内存中迁移。
- 配置中的 `paseoProfile`、`paseoServices` 改名为 `platformProfile`、`platformServices`，旧名继续有效。
- Paseo 的需求插件暂时仍由 paseo-req-kit 提供，计划在 0.1.0 之后迁入。
