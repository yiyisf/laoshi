# DeepSeek Harness（dsh）适配：外部引擎 + 平台插件

- 状态：提议
- 依据：[dsh 摸底报告](../discovery/dsh/report.md)（`@deepseek-ai/dsh@0.2.2-alpha.2`，没有使用真实模型）
- 决策：[ADR 0008](../adr/0008-capability-sources-and-platform-plugin.md)
- 前置阅读：[agent-runtime.md](../../contracts/agent-runtime.md)、[adapter-guide.md](adapter-guide.md)
- 使用前提：laoshi 在内网使用。在 dsh 中使用的模型与 Paseo 上 req-kit 用的相同，经内网模型网关接入（dsh 中配置为自定义 provider），不连接 DeepSeek 官方 API。
- 与摸高的关系：dsh 与摸高是两件独立的事，摸高的底层不是 dsh。摸高的适配见 [internal-platform-adapter](internal-platform-adapter.md)（计划 M4），dsh 的适配是计划 M4b。

## 1. 结论

目标是：在 dsh 原生环境中，使用者的体验和 req-kit 在 Paseo 上一样——在对话里对齐需求，每一步都显示在对话下面，进展和结论发回对话，可以预约、自动继续、停止，需要批准时有人看得到。

摸底表明这个目标可以达到。dsh 的 web host 本身就提供会话、子 agent、定时任务、审批、后台任务和持久会话，相当于 Paseo 的 daemon。差距只有两类：

1. **外部 `/api` 不够用**：不能在对话下创建子 agent，不能创建定时任务，不能回答审批。这三件事在 host 内的插件里都能做，已经实测。
2. **平台没有提供的能力**：服务管理（`paseo.json` 那种服务定义、端口和健康检查）。worktree 只有一个实验包，默认没有挂载。这些由 laoshi 内置实现。

所以 dsh 适配器由两部分组成：**运行时**（外部引擎通过 `/api` 调用 host）和 **laoshi dsh 插件**（在 host 内补上外部做不到的能力）。流程编排仍然只在引擎里（ADR 0006），插件只提供能力，不决定下一步做什么。

## 2. 形态

```text
dsh web host（使用者打开的界面）
 ├─ 对话会话（DSH_SESSION_ID）── /laoshi 在这里对齐需求、启动流水线
 │    └─ 步骤子 agent × N（插件创建，带标签显示在对话下）
 ├─ laoshi dsh 插件
 │    · ctx.subagents  在对话下创建步骤子 agent
 │    · ctx.schedule   预约、自动继续、等待提醒
 │    · approval/request 按策略审批，处理不了的交给人
 │    · 本地通道：接收引擎的请求，把限定权限的凭据交给引擎
 └─ /api（session、subagents、schedule …）
          ▲
          │ 会话的创建、下发、取消、列表、追问、读事件
laoshi 引擎（外部的确定性进程，状态在 .pipeline/state.json）
```

为什么不用 `dsh headless` 或 `dsh acp` 作为 dsh 的主路径：这两种方式起的是独立进程里的会话，使用者在 web 界面里看不到步骤，审批也只能由引擎自己回答。它们适合作为 [ADR 0002](../adr/0002-two-orchestration-modes.md) 里"无头 CLI 运行时"的后端，不适合追求和 Paseo 一样的体验。

## 3. 能力映射

"来源"一栏的含义见 ADR 0008：`platform` 表示平台原生提供，`plugin` 表示由 laoshi dsh 插件提供，`builtin` 表示 laoshi 内置实现，`none` 表示降级。"验证"一栏只说明摸底时是否实测过。

| AgentRuntime | dsh 上的做法 | 来源 | 验证 |
| --- | --- | --- | --- |
| `verifyOrigin` | 用 `session/list` 找到 `DSH_SESSION_ID` 对应的会话，核对 `cwd` | platform | 部分（字段已确认） |
| `startAgent` | 插件调用 `ctx.subagents.startActivation`：`parent` 为发起会话，`delivery: "caller"`，`label` 为步骤名，`cwd` 为仓库或 worktree，`agentPreset` 按角色选择。没有插件时退回 `session/create`，创建顶层会话，不显示在对话下 | plugin | 是 |
| `StepAgent.wait` | 轮询 `session/list` 中子会话的 `running`；"在等审批"由插件报告（见 §5）。之后可以换成订阅事件流 | platform + plugin | 是（轮询） |
| `StepAgent.followUp` | `subagents/prompt`，`mode: "continuable"`，`delivery: "queue"` | platform | 是 |
| `StepAgent.archive` | `workspaces` 的 `archiveSession` | platform | 否 |
| `attachAgent` | 按会话 ID 继续；host 会冷恢复已持久化的会话 | platform | 是（顶层会话和子会话都已验证，见摸底包自测 P12） |
| `notifyAgent` | `session/prompt`，`mode: "queue"` | platform | 是 |
| `interruptAgent` | 子会话用 `subagents/interruptByParent` 或 `session/cancel`，再用 queue 模式发送新指令 | platform | `session/cancel` 已验证 |
| `listPaseoProfiles`（将改名，见 ADR 0008） | `agentPresets` 的列表，以及模型目录 | platform | 否 |
| `listServices` / `startServices` / `stopServices` | dsh 没有服务定义。由 laoshi 内置的服务管理读取代码库配置中的服务，分配端口，做健康检查，保留输出 | builtin | — |
| `createWorktree` / `waitForWorkspaceSetup` | laoshi 内置的 `git worktree`。可选启用 `dsh-experimental-worktree`，但它会改变会话的工作目录，和"步骤在 worktree、对话在原目录"的做法需要先对齐 | builtin | — |
| `scheduleMessage` / `cancelSchedule` | 插件调用 `ctx.schedule.create(sessionId, …)`；用 `/api` 的 `schedule/delete` 取消 | plugin | 创建已验证 |
| `scheduleNewAgent` | 插件为定时任务创建一个专用会话，再预约到它 | plugin | 否 |
| `startSessionAgent` | `session/create`，再 `session/prompt` | platform | 是 |
| `providerQuota` | 没有订阅额度；只能拿到每个会话的 `tokenUsage` | none | — |
| `recentActivity` / `runningTool` / `toolCalls` | `session/page` 中的 `tool/call`、`tool/result` 事件 | platform | 事件已确认 |
| `capabilities` | 看是否挂载了 `browser-use` 等插件 | platform | 否 |
| `providerStatus` | 模型目录与凭据状态 | platform | 否 |
| 用量（`WaitOutcome.usage`） | `projections.tokenUsage` | platform | 是 |

和 Paseo 相比有一处改进：dsh 尊重子 agent 请求里的 `cwd`（已实测），而 Paseo 在指定 parent 时会忽略传入的 `cwd`（req-kit ADR 0001 的起因）。

## 4. 插件与引擎之间

**认证。** agent 环境里的 `DSH_WEB_URL` 不带 token，所以从对话里启动的引擎自己连不上 `/api`。由插件解决，两种做法：

1. 插件通过本地通道把一个 cookie 交给引擎。最简单，但这个 cookie 拥有使用者的全部权限。
2. **插件代为调用**：引擎只和插件通信，插件在 host 内直接使用 `ctx.agents`、`ctx.subagents`、`ctx.schedule`，并且只开放 laoshi 需要的那几项操作。

倾向第 2 种：权限最小，也让引擎不依赖 `/api` 的内部格式（`/api` 的类型由生成器产生，没有承诺稳定）。代价是插件的代码会多一些。

**通道。** 用 unix socket（Windows 上用命名管道），路径放在 `$DSH_HOME` 下，并带上会话 ID。探针中用的文件收件箱只作为实验手段。

**版本。** 插件声明它支持的 dsh 版本范围，`laoshi doctor` 检查版本，并检查插件是否已挂载、通道是否连通。

## 5. 审批

- 插件用 `{ prepend: true }` 注册 `approval/request` 监听（不加 prepend 时，转发给浏览器的应答者会先接住请求，插件拿不到）。
- 只处理 laoshi 步骤子 agent 的请求（判断请求里的会话是不是插件自己创建的子会话），其他会话一律调用 `next()`，不干预使用者自己的对话。
- 决定依据是项目配置的**审批策略**：允许、拒绝、交给人。交给人时，插件同时通过引擎在对话里提醒"某个步骤在等批准"，请使用者在界面里处理。这就是现有 `wait` 返回 `permission` 时的行为。
- 插件永远不把"允许"当作默认值；策略没有写到的请求，一律交给人。

## 6. 安装与运行

- **Node 版本**：dsh 声明要求 ≥ 24.9。这个下限来自 dsh 的一个实验性子 agent 集成（依赖的 `@botiverse/oar` 要求 Node 24），以及脚本入口用到的 `import.meta.main`（dsh 的说明指出 Node 24.0 还没有这个功能，所以下限没有定在 24.0）。在 Node 22.20 和 22.22 上实测（模拟模型），摸底包的全部探针都能通过；dsh 在 0.2.1-rc.2 之前的版本也正式支持 Node 22.19 以上。因此内网的 Node 22.20 可以先用于摸底，但正式使用前需要定下来：升级到 Node 24，还是接受在声明范围之外运行（§8）。`laoshi doctor` 需要分别检查 laoshi 的 Node 版本和 dsh 的 Node 版本。
- 插件通过 `dsh plugin --profile <名称> add <包>` 安装，并在 `$DSH_HOME/profiles/<名称>/cordis.patch.yml` 中用 `insert` 挂载。安装器负责这两步，`doctor` 负责检查。
- skill：`~/.agents/skills` 本来就会被 dsh 读取；按 [ADR 0007](../adr/0007-one-install-many-repos.md)，也可以用 `customSkillDirs` 指向安装根。
- **Windows（内网）**：内网机器是 Windows，**限制使用 PowerShell，可以用 cmd 和 Git Bash**。dsh 在 Windows 上默认让模型通过 PowerShell 执行命令（`pwsh` 工具加 PowerShell 执行器），所以不能直接用，需要在 profile 中改用 Git Bash：关掉 `pwsh-sandbox`，打开 `bash-sandbox`（它在 Windows 的 ACL 沙箱里运行 `bash -c`）和顶层的 `tool-bash`，并把 Git 的 `bin` 目录放到 PATH 前面。这**不是 dsh 官方覆盖的组合**（dsh 在 Windows 上默认关闭 bash，`bash-local` 也写明只支持 POSIX），必须由内网摸底包验证。另外两点：Windows 查找 `bash` 时先查 `System32` 再查 PATH，装了 WSL 的机器可能会启动 WSL；预设里的 `pwsh` 工具只能通过 profile 补丁改顶层条目，关不掉，正式版的 laoshi 应当注册自己的 agent 预设（只带 bash 工具），步骤子 agent 用这个预设。已核对：req-kit 的步骤提示词里没有写死 bash 或 PowerShell 的命令，引擎本来就支持 Windows。laoshi 的插件和内置能力（服务管理、停止进程等）必须按 Windows 实现，且不能依赖 PowerShell。
- **内网离线**：
  - 安装要求内网 npm 镜像能装上 `@deepseek-ai/dsh` 及其依赖（约 650 个包，约 950 MB）。插件安装用 pnpm；没有 pnpm 时可以直接复制到 profile 的 `node_modules`，摸底包两种方式都支持。
  - 对外连接：云端自测中，dsh web host 除本机和模型端点外没有任何对外连接。浏览器界面触发的功能（插件市场、设置页的模型目录等）还没有覆盖到。内网摸底包（P14）会全程记录；如果发现外部地址，再在 profile 中禁用对应插件，并把配置写进安装器。
  - `dsh-session-log-deepseek` 只在调用 DeepSeek 官方 API 时附带会话日志。内网通过自定义 provider 接入模型，不涉及这个问题。
- 子 agent 提供方：默认只有 `spawn` 和 `fork`。builder 和 reviewer 想用不同的 harness（例如 reviewer 用 Claude Code）时，需要在 profile 中挂载对应的提供方，这一点还没有验证。

## 7. 与 Paseo 体验的差异

| 方面 | Paseo | dsh（本方案） |
| --- | --- | --- |
| 步骤显示在对话下 | 有 | 有（插件） |
| 进展发回对话 | 有 | 有 |
| 预约、自动继续 | 有（Paseo 定时任务） | 有（插件 + dsh 定时任务） |
| 审批 | 人在 Paseo 界面里批准 | 先按策略处理，其余由人在 dsh 界面里批准 |
| 服务、端口 | Paseo 管理 | laoshi 内置 |
| 需求总览界面 | Paseo 插件 | `laoshi api` 加本机网页；以后可以做 dsh 的界面插件（dsh 支持在 web 界面里加插件） |
| 额度提醒 | 有 | 没有（只有用量） |

## 8. 待定

1. 引擎和插件之间选哪种认证方式（§4 的第 1 种还是第 2 种）。
2. worktree 用 laoshi 内置实现，还是启用 dsh 的实验包。
3. builder 和 reviewer 用不同 harness 时，挂载哪些子 agent 提供方。
4. 需求总览是否做成 dsh 的界面插件，还是先用本机网页。
5. 内网 dsh 用哪个 Node：升级到 Node 24（可以只给 dsh 单独装一个，例如 npm 包 `node-linux-x64@24`，不影响系统的 Node 22），还是继续用 Node 22.20、接受在 dsh 声明的范围之外运行。
6. 内网真实模型下的结果：用[内网摸底包](../discovery/dsh/probes/README.md)确认模型网关的兼容设置、步骤任务能否按结果文件约定完成、有没有对外连接。模型本身已经在 Paseo 上验证过，这里要验证的是"同一个模型 + dsh 的提示词和工具"能否配合好。
