# AgentRuntime：引擎对 agent 平台的要求

引擎（`engine/src`）只通过 `AgentRuntime`（`engine/src/runtime.ts`）与 agent 平台打交道。Paseo 是目前唯一的实现（`engine/src/paseo-runtime.ts`），测试用 `REQ_PIPELINE_FAKE_RUNTIME` 指向的假实现（`engine/test/fake-runtime.ts`）。要让 req-kit（以及之后的 laoshi）运行在别的 agent 平台上，就是为那个平台写一个 `AgentRuntime`。

本文说明：每个方法属于哪一级、没有它时现在的行为、以及适配器应该怎么做。`runtime.ts` 里的类型和注释是字段定义的准确来源，本文不重复。

## 级别

- **必需**：没有就不能运行流水线。适配器必须实现。
- **可选**：平台没有时返回 `null`（或抛出），引擎按"现状"一栏处理。
- **按需**：只有对应功能被使用时才会调用（卡片接单、需求总览、联合需求、`--worktree`）。

"现状"一栏记录的是引擎今天的真实行为，不是理想行为。标了 ⚠ 的是降级不够平滑、适配器作者需要特别注意的地方。

## 必需

| 方法 | 要求 | 备注 |
| --- | --- | --- |
| `verifyOrigin(agentId, cwd)` | 确认发起流水线的会话存在，且工作目录是 `cwd`；不满足时抛出面向用户的原因 | 步骤 agent 要挂在发起会话下，平台给子 agent 的工作目录必须与会话一致（见 ADR 0001）。没有"会话"概念的平台，应在适配器里自行定义"发起者"并让此方法恒通过 |
| `startAgent(input)` | 按 `role`、`prompt`、`cwd`、`labels`、`profile` 创建一个步骤 agent；`parentAgentId` 非空时挂在该会话下；`workspaceId` 非空时放进该工作区 | 返回 `StepAgent` |
| `StepAgent.wait(timeoutMs)` | 等待当前回合结束，最多 `timeoutMs`；遇到权限请求时提前返回 | 返回值的 `status` 为 `idle` / `error` / `permission` / `timeout`；`usage` 平台不报告时为 `null` |
| `StepAgent.followUp(text)` | 在同一会话里开始新回合 | 用于"结果文件缺失，请补写" |
| `StepAgent.archive()` | 归档该 agent | |
| `attachAgent(agentId)` | 接上一个之前（可能由另一个流水线进程）启动的 agent | 续跑、重新接着等用 |
| `notifyAgent(agentId, text)` | 向已有会话投递一条消息，不打断它 | 进展、需要决定的问题、结论都靠它发回会话。⚠ 没有等价能力的平台，至少要写通知文件让使用者看到 |
| `interruptAgent(agentId, text)` | 打断当前回合，改为处理 `text` | 用于停止一个步骤 |
| `close()` | 释放连接 | |

## 可选

| 方法 | 平台没有时 | 现状 |
| --- | --- | --- |
| `listPaseoProfiles()` | 返回 `null` | 只影响用 `paseoProfile` 引用平台档案的配置：解析不了就拒绝启动并说明。只用 `provider/model` 直配时不调用 |
| `listServices(target)` | 返回 `null` | 流水线调用时都带 `.catch(() => null)`，`null` 表示"不由平台管理服务"，改用 `verify.md` 里的手工启动命令 |
| `startServices(target, names, timeoutMs)`、`stopServices(...)` | — | 只在 `listServices` 返回名字后才调用；失败时按启动失败报告给步骤 |
| `providerQuota(providers)` | 返回 `null` | 额度提醒关闭，不影响运行（`.catch(() => null)`） |
| `recentActivity(agentId, limit)` | 返回 `null` | 查看进度时不附"最近动作"（`.catch(() => null)`） |
| `runningTool(agentId)` | 返回 `null` | 关闭"打断搜索大目录命令"（1.13）（`.catch(() => null)`） |
| `capabilities()` | 返回 `null` | 当作"未知"，不做依赖这些工具的假设（`.catch(() => null)`） |
| `providerStatus()` | 返回 `null` | 只在接单器体检时用；`null` 不报问题 |
| `scheduleMessage(input)` | 返回 `null` | ⚠ 流水线内部（等待提醒、自动继续、定时检查、预约验证）拿到 `null` 就不预约；但 `launch.ts` 的"预约开始"在拿到 `null` 时**直接失败**并提示"到时再启动"。其他平台需要本机定时器或让使用者手动继续（见下文"调度"） |
| `cancelSchedule(id)` | — | 下一次运行和暂停命令会调用它取消状态文件里记录的预约 |

## 按需

| 方法 | 用在哪里 | 备注 |
| --- | --- | --- |
| `createWorktree(request)`、`waitForWorkspaceSetup(id, timeoutMs)` | `--worktree`（`worktree.ts`）和联合需求（`joint.ts`） | ⚠ 创建失败是硬错误。没有平台工作区的适配器，可以在适配器内用 `git worktree` 实现并返回 `{ workspaceId, directory }`；`waitForWorkspaceSetup` 可恒返回 `{ status: "none" }` |
| `startSessionAgent(input)` | 从卡片接单（`card-cmd.ts`）：为需求新开一个顶层会话 | 没有则不能用接单器 |
| `scheduleNewAgent(input)` | 需求总览的定时发送（`digest.ts --schedule`） | 返回 `null` 时该功能关闭 |

## 调度

引擎里所有"以后再做"（预约开始、等待提醒、限流后自动继续、定时检查、预约验证）都表达为：**在某个时间，向发起会话投递一条写明步骤的消息**（ADR 0020）。适配器实现 `scheduleMessage` 时有三种选择：

1. 平台有等价的定时任务 → 直接映射（Paseo 的做法）。
2. 平台没有 → 适配器自己保存计划，由一个常驻的本机进程到点调用 `notifyAgent`。
3. 都做不到 → 返回 `null`，让引擎按上表"现状"处理。

## 一致性要求

新适配器至少应满足：

- 通过 `engine/test` 中使用 `fake-runtime.ts` 的编排测试所覆盖的行为约定（步骤顺序、续跑、重新接着等、结果文件追问、打断）。读 `fake-runtime.ts` 可以看到引擎对每个方法的真实期望。
- `StepAgent.wait` 返回 `permission` 时，`pendingPermissions` 非空且有可读的 `title`。
- 步骤 agent 的创建要保证产物写在 `cwd` 下（ADR 0001 的问题：有的平台在传了 parent 时会改用 parent 的目录）。
- 不要让某个可选方法抛出未捕获的异常来表示"不支持"，除非上表标了 ⚠；用 `null`。

## 计划中的修订（ADR 0008，提议）

[ADR 0008](../docs/adr/0008-capability-sources-and-platform-plugin.md) 定下了以下修订的方向，将与实现一起提交，本文暂不改动：能力标明来源（平台 / 插件 / 内置 / 降级）；新增"回答待处理的请求"与审批策略；`listPaseoProfiles` 改名为 `listProfiles`；`attachAgent` 改为"恢复步骤会话"；引入 agent 事件模型，由核心推导 `wait`、活动和用量；把对话相关的能力拆为"对话通道"。

## 已知需要中性化的地方（尚未处理）

这些不影响 `AgentRuntime` 的形状，但换平台时会暴露：

- 类型和方法名里的 Paseo 字样：`listPaseoProfiles`、`ServiceTarget`、`ManagedService`、`capabilities().paseoTools` 等。
- 状态文件字段：`worktree.workspaceId`、`schedules[]`、`originAgentId`（见 `state.md`）。
- 面向使用者的文案和提示词里的"在 Paseo 的某某界面……"（`messages.ts`、`launch.ts`、`control.ts`、`engine/prompts/paseo-services.md` 等）。
- 会话识别依赖环境变量 `PASEO_AGENT_ID`、`PASEO_AGENT_CWD`（`skills/req/SKILL.md`）。
- 配置里的 `AgentProfile.paseoProfile`、`daemonPasswordEnv`。

改动这些属于格式变更，须同时更新 `state.md`、迁移函数和 `CHANGELOG.md`。
