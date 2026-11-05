# 命令

laoshi 有三类入口：在平台对话中使用的 **skill**，终端中的 **`laoshi` 命令**（`req` 是它的别名），以及 skill 在背后调用的**流水线启动器**。日常使用只需要第一类。

## 对话中的 skill

| 输入 | 作用 | 通常谁用 |
| --- | --- | --- |
| `/laoshi <一句话>` | 需求开发入口：新需求、小改动、查看进度、暂停或继续、修改需求、开始测试验证、验收、上线后问题、接手。由它判断走哪本手册 | 使用者 |
| `/laoshi-setup` | 项目接入：生成项目说明、验证方法、服务定义（Paseo 的 `paseo.json`，或 `.laoshi/services.json`），确认后提交 | 开发或熟悉项目的测试同事 |
| `/laoshi-doctor` | 体检：安装、配置、平台、当前项目 | 任何人 |
| `/laoshi-retro` | 复盘：需求做完后回顾返工、中断和变更，把改进落到 CI、配置、项目说明或提示词 | 开发同事 |

Pi 中写作 `/skill:req`。同一个对话里，之后的"做到哪了""先停一下""继续开发""开始测试验证""我要验收"不需要再带 `/laoshi`。

## req 命令

安装后提供 `req`（同名命令 `laoshi`，避免和其他工具冲突）。Windows PowerShell 受执行策略限制时用 `req.cmd`。

### 在项目目录中

| 命令 | 作用 |
| --- | --- |
| `laoshi list` | 列出这个项目所有工作区中的需求和阶段 |
| `laoshi status [需求]` | 查看进度；只有一个需求运行过时可以不写 |
| `laoshi stop <需求>` | 停止流水线（之后可以继续）；同时取消预约的开始、提醒、自动继续 |
| `laoshi resume <需求>` | 从上次中断处继续；需求改过时只处理变化的部分 |
| `laoshi approve <需求>` | 需求方看过 `preview.md` 并确认后，从方案确认点继续开发 |
| `laoshi verify <需求> [--verify-env local\|deployed] [--defects fix\|handback\|report]` | 研发完成后开始测试验证（分阶段执行时） |
| `laoshi start <需求> [--profile quick\|standard] [--phases gated] [--at 22:00]` | 启动流水线（通常由 `/laoshi` 在对话中启动） |
| `laoshi digest [--notify]` | 项目的需求总览；`--notify` 同时发到外部通知 |
| `laoshi digest --schedule "0 9 * * 1"` | 让平台按时间表发送需求总览；取消：`laoshi digest --cancel <ID>` |
| `laoshi sync <需求>` | 把需求同步到对接的外部系统：补发没有成功的调用、补建卡片、更新状态 |
| `laoshi integration test [需求]` | 显示对接外部系统时每个事件会执行的命令，不真正调用 |
| `laoshi start --from <系统>:<卡号> [--repo <仓库>]` | 从需求管理系统中的一张卡片开始需求：建功能目录和需求会话，问题和确认通过卡片描述；不写 `--repo` 时按子系统选仓库 |
| `laoshi card check [<卡号> \| --all]` | 读取需求方在卡片中的回复，把新内容转给需求会话 |
| `laoshi card publish <卡号>` | 需求会话使用：把 `card-ai.md` 写进卡片的 AI 区 |
| `laoshi card list` | 本机从卡片开始的需求和各自的进展 |
| `laoshi card route [--add <仓库> \| --remove <仓库>]` | 本机接收卡片的仓库和各自的子系统；`laoshi start --from` 不写 `--repo` 时按它选仓库 |
| `laoshi factory once \| run \| start \| stop \| status \| service` | 接单器：定时为标题带 `[AI]` 的新卡片开始需求、转达需求方的回复；`once` 检查一次，`start`/`stop` 后台运行，`service` 给出作为系统服务运行的写法 |
| `laoshi index --rebuild [目录…]` | 把这些仓库中运行过的需求登记进本机的需求索引（索引缺失的需求用） |

### 使用统计（任何目录）

| 命令 | 作用 |
| --- | --- |
| `laoshi stats [--since 30d] [--month 2026-10]` | 本机的使用统计：需求数、交付周期、返工、等待、各步骤用时、用量；`--json`、`--csv` |
| `laoshi stats --report [--out 目录]` | 生成汇报用的 `.md` 汇总和 `.csv` 明细 |
| `laoshi stats --export [文件]` | 导出本机的运行记录 |
| `laoshi stats --merge <文件…> --report` | 汇总几台机器的导出 |
| `laoshi index [--prune]` | 本机记录的需求；`--prune` 移除目录已不在的 |
| `laoshi api <命令> …` | 给程序用的 JSON 输出，见 [laoshi api](./contracts/cli-json) |

`<需求>` 可以写功能目录（`docs/features/20261012-sms-login`）、目录名，或名称中能唯一确定的一部分（`sms-login`）。

### 本机维护

| 命令 | 作用 |
| --- | --- |
| `laoshi install --platform <平台> [选项]` | 安装或更新：安装级配置、按平台渲染的 skill、平台需要的插件，见下面的"安装" |
| `laoshi install --check`、`--uninstall` | 只检查不改动；移除 laoshi 装的 skill 和插件（保留安装根） |
| `laoshi docs [--port <端口>] [--no-open]` | 在本机打开这个版本的文档站点（不需要外网） |
| `laoshi doctor [--no-project]` | 体检：安装、配置、平台、各角色的模型、当前项目 |
| `laoshi configure` | 配置向导：为 builder、reviewer 和备用模型选择 agent |
| `laoshi configure --auto` | 不提问，按推荐选好（安装时自动运行） |
| `laoshi reply <需求> <回复>` | 把回答或方案意见转给需求的对话（插件"等你处理"用它） |
| `laoshi upgrade [版本] [--registry <地址>]` | 从 npm 升级到最新版本（或指定版本，也用于回退），再运行新版本的 `laoshi install` |
| `laoshi check` | 检查安装状态 |
| `laoshi notify-test [--type …]` | 给配置的外部通知（如企业 IM）发一条测试消息 |
| `laoshi version` | 显示版本和安装位置 |

## 流水线启动器

`/laoshi` 在对话中执行的是 `node <安装目录>/bin/start-pipeline.mjs`，在 bash、cmd 中写法相同。它从平台提供的环境变量识别当前对话：Paseo 是 `PASEO_AGENT_ID`（工作目录 `PASEO_AGENT_CWD`），dsh 是 `DSH_SESSION_ID`（工作目录就是当前目录）。

| 选项 | 作用 |
| --- | --- |
| `--feature <功能目录>` | 要操作的需求；可以只写名称的一部分 |
| `--status` / `--stop` / `--list` | 查看进度 / 停止 / 列出需求 |
| `--resume` / `--restart` | 从中断处继续 / 丢弃结果从零开始 |
| `--profile quick\|standard` | 档位；不传时读需求说明中的"档位"，再用配置的 `defaultProfile` |
| `--phases continuous\|gated\|develop-only` | 执行方式；不传时读需求说明中的"执行方式"，再用配置的 `phases.mode` |
| `--approve` | 方案确认点：需求方确认了方案，继续开发（等待确认时单独的 `--resume` 会被拒绝；要修改就先更新需求说明再 `--resume`） |
| `--phase verify` | 开始（或继续）测试验证阶段；研发完成、待测试时单独的 `--resume` 效果相同 |
| `--verify-env local\|deployed`、`--defects fix\|handback\|report` | 开始测试验证时临时指定环境和缺陷处理方式 |
| `--verify-at <时间>` | 分阶段时，研发完成后在这个时间自动开始测试验证 |
| `--at <时间>` | 预约开始：`22:00`、`明天 8:30`、`2026-10-14 08:30`、`+2h` |
| `--worktree` | 为这个需求新建 worktree 工作区并在那里开发（对话目录不变；Paseo 用它的工作区，其他平台用 `git worktree`） |
| `--spec-review` | 确认前请另一个模型独立审阅需求说明草稿 |
| `--repo`、`--origin-agent`、`--config` | 仓库目录、发起对话、配置文件（通常不需要写） |

## 安装

| 场合 | 命令 |
| --- | --- |
| 一步安装 | `npx -y @yiyi_zhang/laoshi@latest install --platform dsh\|paseo` |
| 公司内网（npm 镜像） | `npx -y --registry=<镜像地址> @yiyi_zhang/laoshi@latest install --platform dsh` |
| 指定版本 | `npx -y @yiyi_zhang/laoshi@0.1.1 install --platform dsh` |
| 已有程序目录（离线安装包、git 克隆） | `laoshi install --platform dsh`（即 `node bin/req.mjs install …`） |

一步安装的选项：`--registry <地址>`（使用并保存这个 npm 源）、`--no-save-registry`（只这次用）、`--spec <包>`（安装哪个版本）。其余选项交给 `laoshi install`：`--platform`、`--home`、`--target`、`--force`、`--check`、`--dry-run`、`--uninstall`，以及 dsh 的 `--dsh-home`、`--profile`、`--dsh-bin`、`--approvals ask|allow`，说明见 [安装与升级](../guide/install#安装选项)。
