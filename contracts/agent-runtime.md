# AgentRuntime：引擎对 agent 平台的要求

引擎（`engine/src`）只通过 `AgentRuntime`（`engine/src/runtime.ts`）与 agent 平台打交道。现有的实现在各平台的适配器里：Paseo（`adapters/paseo/paseo-runtime.ts`）、DeepSeek Harness（`adapters/dsh/dsh-runtime.ts`）、摸高（`adapters/mogao/mogao-runtime.ts`）、命令行（`adapters/cli/cli-runtime.ts`，已冻结）；测试用 `REQ_PIPELINE_FAKE_RUNTIME` 指向的假实现（`engine/test/fake-runtime.ts`）。要让 laoshi 运行在别的 agent 平台上，就是为那个平台写一个适配器和它的 `AgentRuntime`（见 [adapter-guide](../docs/design/adapter-guide.md)）。

本文说明：能力如何按来源分层、每个方法属于哪一级、没有它时现在的行为、以及适配器应该怎么做。`runtime.ts` 和 `platform.ts` 里的类型和注释是字段定义的准确来源，本文不重复。

## 级别

- **必需**：没有就不能运行流水线。适配器必须实现。
- **可选**：平台没有时由运行时能力层统一返回 `null`（或按"现状"一栏降级处理）。
- **按需**：只有对应功能被使用时才会调用（卡片接单、需求总览、`--worktree`、联合需求、对话内转达审批）。

"现状"一栏记录的是引擎今天的真实行为。标了 ⚠ 的是降级不够平滑、适配器作者需要特别注意的地方。

## 能力来源与平台插件（ADR 0008）

按 [ADR 0008](../docs/adr/0008-capability-sources-and-platform-plugin.md)，除必需方法外，`PlatformAdapter.capabilities`（`engine/src/platform.ts`）为每项可选或按需能力声明提供方来源，按以下优先级选用：

| 来源 | 含义 | 典型示例 |
| --- | --- | --- |
| `platform` | 平台原生提供（CLI / SDK / 服务端接口） | Paseo 提供的 worktree、服务管理、定时任务、额度、profile |
| `plugin` | laoshi 为该平台写的插件，运行在平台进程内（只提供能力与视图入口，不编排流程） | `laoshi-dsh-plugin` 提供的对话子 agent、定时任务、审批、工具轨迹、`providerStatus` |
| `builtin` | laoshi 内置实现，与平台无关 | `git worktree`、`engine/src/builtin/project-services.ts`（`.laoshi/services.json` 受管服务） |
| `none`（未声明） | 确实没有该能力，按契约统一降级 | CLI 的定时消息、dsh 现在的额度与 profile |

- **统一降级（`withCapabilities`）**：未声明的能力由 `engine/src/platform.ts` 中的 `withCapabilities(runtime, adapter)` 在入口处统一降级——只读能力返回 `null`，定时能力返回 `null`，按需动作抛出带有平台名称的说明错误；调用点不再各自重写降级分支。
- **能力矩阵体检**：`laoshi doctor` 的「平台能力」一节逐项列出 `CAPABILITIES` 中的能力及其实际来源；除了契约允许缺失的项外没有 `none`，即视为达到完整的集成体验。
- **worktree 与服务内置替代**：平台没有原生工作区或服务管理时，适配器可复用 `engine/src/builtin/` 中的 `git worktree` 与项目服务管理器，对外仍然通过 `createWorktree` / `listServices` 等 `AgentRuntime` 方法暴露。本机后台调度已决定不作为 `builtin` 实现（见 [builtin-capabilities](../docs/design/builtin-capabilities.md)）。
- **审批策略与边界（ADR 0008 决定 4）**：涉及步骤 agent 审批时，插件或适配器必须严格遵循配置的审批策略（`allow` / 交给人）；未写进策略的请求一律交给人，不能默认放行，且只处理 laoshi 步骤 agent 的请求，不干预使用者自有会话。

## 必需

| 方法 | 要求 | 备注 |
| --- | --- | --- |
| `verifyOrigin(agentId, cwd)` | 确认发起流水线的会话存在，且工作目录是 `cwd`；不满足时抛出面向用户的原因 | 步骤 agent 要挂在发起会话下，平台给子 agent 的工作目录必须与会话一致（见 ADR 0001）。没有"会话"概念的平台，应在适配器里自行定义"发起者"并让此方法恒通过 |
| `startAgent(input)` | 按 `role`、`prompt`、`cwd`、`labels`、`profile` 创建一个步骤 agent；`parentAgentId` 非空时挂在该会话下；`workspaceId` 非空时放进该工作区 | 返回 `StepAgent` |
| `StepAgent.wait(timeoutMs)` | 等待当前回合结束，最多 `timeoutMs`；遇到权限请求时提前返回 | 返回值的 `status` 为 `idle` / `error` / `permission` / `timeout`；`usage` 平台不报告时为 `null` |
| `StepAgent.followUp(text)` | 在同一会话里开始新回合 | 用于"结果文件缺失，请补写"或同轮中断后接续 |
| `StepAgent.archive()` | 归档该 agent | |
| `attachAgent(agentId)` | 恢复（冷接入）之前可能由另一流水线进程启动的步骤会话 | 续跑、重新接着等用；当平台/进程不支持冷恢复时，由引擎结合已有结果文件兜底重做该步 |
| `notifyAgent(agentId, text)` | 向已有会话投递一条消息，不打断它 | 进展、需要决定的问题、结论都靠它发回会话。⚠ 没有等价能力的平台，至少要写通知文件让使用者看到（或由适配器支持原生通知通道） |
| `interruptAgent(agentId, text)` | 打断当前回合，改为处理 `text` | 用于停止一个步骤 |
| `close()` | 释放连接 | |

## 可选

未在 `PlatformAdapter.capabilities` 中声明的能力由 `withCapabilities` 统一返回 `null`（`cancelSchedule` 返回空）：

| 方法 | 能力键（`CAPABILITIES`） | 平台没有时 / 现状 |
| --- | --- | --- |
| `listProfiles()`（req-kit 1.x 叫 `listPaseoProfiles`） | `profiles` | 返回 `null`。只影响用 `platformProfile`（旧名 `paseoProfile`）引用平台档案的配置：解析不了就拒绝启动并说明。只用 `provider/model` 直配时不调用 |
| `listServices(target)`、`startServices(target, names, timeoutMs)`、`stopServices(...)` | `services` | 无原生能力时可用 `builtin` 项目服务（`.laoshi/services.json`）；若声明为 `none`，`listServices` 返回 `null`，`startServices` 抛出说明，验证改用 `verify.md` 里的手工启动命令 |
| `providerQuota(providers)` | `quota` | 返回 `null`；额度提醒关闭，不影响运行 |
| `recentActivity(agentId, limit)` | `activity` | 返回 `null`；查看进度时不附"最近动作" |
| `runningTool(agentId)` | `runningTool` | 返回 `null`；关闭"打断搜索大目录命令"（1.13） |
| `toolCalls?(agentId)` | `toolCalls` | 返回 `null`；关闭基于工具调用流的事后/实时危险命令拦截（1.14 `dangerGuard`） |
| `capabilities()` | `toolInfo` | 返回 `null`；当作"未知"，不做依赖平台工具或浏览器的假设 |
| `providerStatus()` | `providerStatus` | 返回 `null`；接单器体检跳过 provider 登录态核对 |
| `scheduleMessage(input)`、`cancelSchedule(id)` | `scheduling` | ⚠ 声明为 `none` 时返回 `null`：流水线内部（等待提醒、自动继续、定时检查、预约验证）不预约；但 `launch.ts` 的"预约开始"（`--at`）**直接失败**并提示"到时再启动"（见下文"调度"） |
| `agentDirectory?(agentId)` | — | 可选辅助方法，供内置服务从发起会话推导默认工作目录；未知时返回 `null` |

## 按需

| 方法 | 能力键（`CAPABILITIES`） | 用在哪里 | 备注 |
| --- | --- | --- | --- |
| `createWorktree(request)`、`openWorkspace?(directory)`、`waitForWorkspaceSetup(id, timeoutMs)` | `worktree` | `--worktree`（`worktree.ts`）和联合需求（`joint.ts`） | ⚠ 未声明时触发硬错误。没有平台原生工作区的适配器可在适配器内接 `engine/src/builtin/worktree.ts`（`git worktree`）；`waitForWorkspaceSetup` 可恒返回 `{ status: "none", error: null }` |
| `startSessionAgent(input)` | `sessionAgent` | 从卡片接单（`card-cmd.ts`）：为需求新开一个顶层会话 | 未声明时不能使用卡片接单 |
| `scheduleNewAgent(input)` | `scheduleAgent` | 需求总览的定时发送（`digest.ts --schedule`） | 未声明时返回 `null`，该功能关闭 |
| `answerPermission(agentId, requestId, approve, reason)` | — | `laoshi permission <需求> approve\|deny`（`permission-cmd.ts`）：平台的审批不能直接在对话界面里回答、需由对话命令转达人的决定时用；`requestId` 为 `null` 表示当前等待的那一个 | 没有时，审批在平台自己的界面（如 Paseo 界面、dsh 审批 UI 或插件策略）处理 |

适配器还可以声明 `runsInChat`（`PlatformAdapter`）：平台只在对话的一个轮次内保留对话容器时，引擎不能在后台脱管运行，`launch.ts` 让它在对话的命令里前景运行，给对话的消息（`notifyAgent`）写进 `chat.log` 并显示在命令输出里。状态文件记下运行引擎的主机名（`host`），另一台机器上记录的进程不算还在运行。

## 调度

引擎里所有"以后再做"（预约开始、等待提醒、限流后自动继续、定时检查、预约验证）都表达为：**在某个时间，向发起会话投递一条写明步骤的消息**（ADR 0020）。适配器实现 `scheduleMessage`（支持 `at` / `cron` 及周期任务的 `expiresAt` 自动终止）时有三种选择：

1. 平台有等价的定时任务 → 直接映射（Paseo 的做法）。
2. 平台插件提供定时创建与生命周期管理 → 在插件内调用平台定时接口并在到 `expiresAt` 时取消（dsh 插件的做法）。
3. 都做不到 → 不声明 `scheduling`（经 `withCapabilities` 返回 `null`），按上表处理。

## 一致性要求

新适配器至少应满足：

- 通过 `engine/test` 中使用 `fake-runtime.ts` 的编排测试及 `engine/test/conformance.ts`（`runConformance`）所覆盖的行为约定（步骤顺序、续跑、重新接着等、结果文件追问、打断）。读 `fake-runtime.ts` 可以看到引擎对每个方法的真实期望。
- `StepAgent.wait` 返回 `permission` 时，`pendingPermissions` 非空且有可读的 `title`。
- 步骤 agent 的创建要保证产物写在 `cwd` 下（ADR 0001 的问题：有的平台在传了 parent 时会改用 parent 的目录）。
- 能力是否支持统一在 `PlatformAdapter.capabilities` 中声明，交给 `withCapabilities` 处理，不在核心调用点假定平台特性。

## 后续演进预留（暂未改变当前契约）

[ADR 0008](../docs/adr/0008-capability-sources-and-platform-plugin.md) 决定 5 中已经完成了 `listProfiles` 命名、能力来源声明（`PlatformAdapter.capabilities` + `withCapabilities`）与审批策略接入。以下两项作为后续按需演进预留，若将来推进，将按契约变更规则与实现一并提交：

- **统一 agent 事件模型**：由核心从事件流推导 `wait`、`recentActivity`、`runningTool`、`toolCalls` 和用量，适配器只需输出事件流（轮询型平台由适配器将状态变更转为事件）。
- **对话通道独立拆层**：把 `verifyOrigin`、`notifyAgent`、定时消息等能力拆成可独立组合的"对话通道"，便于实现"平台运行时 + 外部通知通道"等组合（目前摸高/外部 IM 通知仍由 `notifiers` 与适配器钩子承担）。

## 中性化（laoshi M2a–M2e 已处理）

req-kit 1.x 里带 Paseo 字样的地方，laoshi 中已改为中性的名称：

- 方法与字段：`listPaseoProfiles` → `listProfiles`（M2a），`capabilities().paseoTools` → `platformTools`（M2e）。`ServiceTarget`、`ManagedService` 本来就是中性的名字，只改了注释。
- 状态文件字段：`originAgentId`、`worktree.workspaceId`、`schedules[]` 在第 2 版中改名（M2d，见 `state.md`）；对外契约不变。
- 面向使用者的文案和提示词：改用适配器的词汇表（M2e，`engine/src/words.ts`，见 [platform-vocabulary](../docs/design/platform-vocabulary.md)）；`engine/prompts/paseo-services.md` 改名为 `managed-services.md`。
- 会话识别：由适配器声明环境变量（`originEnv`，M2a）；使用者识别同样由适配器声明（`userEnv`，如摸高的 `AIMAX_USER_NAME`，ADR 0007）。
- 配置：`AgentProfile.paseoProfile` → `platformProfile`，`paseoServices` → `platformServices`，旧名继续读取（M2e）；daemon 地址可写在 `platform.paseo` 中（M2c）。

`engine/test/platform.test.ts` 检查核心代码和提示词里不出现平台名（有意保留的旧字段名、对外契约字段，在那一行或上一行写明 `platform-name:` 和原因）。
