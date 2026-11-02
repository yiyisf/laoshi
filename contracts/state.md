# state.json

流水线的运行状态，位于 `docs/features/<目录>/.pipeline/state.json`，只由引擎写入，不提交。

## 当前格式：version 2（laoshi M2d 起；req-kit 1.x 为 version 1，见文末"第 1 版到第 2 版"）

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `version` | number | 格式版本。没有这个字段的文件按 1 处理 |
| `repo` | string | 仓库目录（绝对路径） |
| `featureDir` | string | 功能目录（相对路径，`/` 分隔） |
| `status` | `running` \| `waiting_for_business` \| `failed` \| `completed` \| `phase_done` \| `waiting_for_approval` | 当前状态。`waiting_for_business` 表示等待需求方决定；`phase_done`（1.7.0 起）表示研发阶段已完成、停在闸口等待测试验证；`waiting_for_approval`（1.8.0 起）表示方案已通过审核、等待需求方确认 `preview.md`，`--approve` 继续。旧引擎把不认识的状态当作可以继续的中断：`phase_done` 继续时直接做验证，`waiting_for_approval` 继续时不经确认直接写代码 |
| `attempt` | number | 第几次从方案设计开始 |
| `specHash` | string | 启动时 spec.md 的 sha256 |
| `originSessionId` | string \| null | 发起流水线的对话（会话），通知发往这里。第 1 版叫 `originAgentId` |
| `pid` | number | 流水线进程 |
| `startedAt` / `updatedAt` | ISO 时间 | |
| `results` | object | 已完成步骤的结果，键为步骤键（如 `code_review-r2`） |
| `history` | array | 每次步骤执行的记录：agent、起止时间、结果、错误；`usage`（可选，1.3.0 起）为 agent 报告的用量：`inputTokens`、`cachedInputTokens`、`outputTokens`、`totalCostUsd`，agent 没有报告时为 null 或缺少；`leftRunning`（可选，1.11 起）为 true 表示失败时 agent 可能还在运行，下一次运行这一步时先看它；`reattached`（可选，1.11 起）为接着等上一次 agent 的次数 |
| `stopReason` / `outcome` | string \| null | 停止原因；最终结论 |
| `stopKind` | string \| null | 可选，1.12 起。停下等人的原因代码：必要的决定 `approval`（确认方案）、`phase_gate`（研发完成，等待测试）、`business`（需求方决定）、`reproduce`（缺陷复现不了）；中断 `timeout`、`agent_error`、`invalid_result`、`transient`、`stopped`、`process_exit`、`budget`（1.13，用完 token 预算）、`other`。运行中或完成时为 null |
| `budget` | object | 可选，1.13 起，配置了 `budget.tokens` 时。`{ allowance, warnedAt }`：停下前允许用到的 tokens（预算，每次用完后继续再加一份）；已经提醒过的那一档 |
| `waitingPermission` | object \| null | 可选，1.13 起。步骤 agent 在等权限批准时：`{ agentId, stepTitle, requests, since }`；没有在等时为 null |
| `recoveries` | array | 可选，1.12 起。流水线自己处理掉的问题（最多保留 200 条）：`at`、`key`（步骤键）、`kind`（`retry` 重试 / `reattach` 接着等上一次的 agent / `reuse_result` 沿用上一次 agent 的结果 / `extend_timeout` 超时后多等一轮 / `redo` 新开 agent 重做 / `fallback` 换备用模型 / `auto_resume` 预约自动继续 / `quota_wait` 预约在额度恢复后继续 / `self_answer` 方案审核的问题由 builder 自答 / `stop_scan` 打断了搜索大目录的命令，1.13 起）、`detail` |
| `dangers` | array | 可选，1.14 起。步骤 agent 运行（或开始运行）的危险命令（`dangerGuard`，最多保留 50 条）：`at`、`key`（步骤键）、`stepTitle`、`command`、`label`（如"推送到远程仓库"）、`ran`（发现时已经运行完为 true，正在运行、已打断为 false）、`agentId`、`callId`（同一个调用只处理一次） |
| `secretScans` | array | 可选，1.14 起。改代码的步骤之后的密钥扫描（`secretScan`），每个步骤、每次尝试保留最新一次：`key`、`attempt`、`at`、`findings`（`{ file, line, commit, kind, preview }`，`preview` 里的值已遮住）、`fixRounds`、`passed` |
| `profile` | `quick` \| `standard` | 档位 |
| `branch` | string \| null | 工作分支，启动时确定 |
| `milestones` | string[] | 已发送的进展通知，续跑时不重复发送 |
| `incremental` | object \| null | 可选，1.3.0 起。需求变更或回答问题后的继续：`fromAttempt`（接着哪一次）、`reason`、`baseCommit`（本次开始时的提交，评审看这之后的改动）、`hadImplementation`（上一次是否已写过代码）。第一次运行和 `--restart` 为 null |
| `worktree` | object \| null | 可选，1.5.0 起。用 `--worktree` 启动、在为需求新建的工作区中开发时：`workspaceRef`（平台对这个工作区的引用，由适配器解释；Paseo 为工作区 ID，laoshi 内置 worktree 为 `dir:<目录>`。第 1 版叫 `workspaceId`）、`sourceRepo`（对话所在的目录）。此时 `repo` 是新工作区的目录 |
| `wakeups` | array | 可选。这次运行在平台上预约的唤醒（定时任务）：`ref`（平台的定时任务 ID）、`kind`（`reminder` 提醒 / `auto-resume` 自动继续 / `watchdog` 定时检查）、`at`。下一次运行或暂停命令会取消它们。第 1 版叫 `schedules`，其中 `ref` 叫 `id` |
| `adapter` | object \| null | 可选，第 2 版起。这次运行用的平台适配器：`id`（如 `paseo`、`dsh`），便于排查 |
| `mode` | `engine` \| `chat` | 可选，第 2 版起。谁编排步骤：引擎（缺省）或对话（模式 B，见 docs/design/in-chat-orchestration.md） |
| `stepRequest` | object \| null | 可选，第 2 版起，只用于模式 B：`{ key, since }`，等待对话中的 agent 执行的步骤 |
| `autoResumes` | object \| null | 可选，1.6.0 起。`attempt`、`count`：这次尝试已经预约过几次自动继续 |
| `queuedSince` | string \| null | 可选，1.6.0 起。正在排队（`maxConcurrentPipelines`）时为开始排队的时间 |
| `phases` | object \| null | 可选，1.7.0 起。这次运行的执行方式：`mode`（`continuous` / `gated` / `develop-only`）、`environment`（`local` / `deployed`）、`defects`（`fix` / `handback` / `report`）。没有时按 `continuous`、`local`、`fix` 处理 |
| `phase` | `develop` \| `verify` | 可选，1.7.0 起。当前阶段。用字符串而不是编号，以后增加阶段不用改格式 |
| `verifyAt` | string \| null | 可选，1.7.0 起。`--verify-at`：研发完成后在这个时间开始测试验证 |
| `handbacks` | number | 可选，1.7.0 起。测试验证把缺陷退回研发阶段的次数（`defects` 为 `handback`），上限为档位的 `defectFix` 轮数 |
| `type` | `defect` \| `refactor` \| `assessment` \| null | 可选，1.8.0 起。spec 中"类型"对应的做法；新需求、小改动和配置关掉的类型为 null |
| `codeBase` | object \| null | 可选，1.8.0 起。`attempt`、`commit`：这次尝试在改动任何代码之前的提交，质量门的基线和范围检查从这里比较。尝试开始时就已经写过代码的旧记录为 `commit: null` |
| `joint` | array \| null | 可选，1.8.0 起。联合需求（spec 的 `- 联合开发：`）中其他仓库的工作区：`name`（`relatedRepos` 中的名称）、`slug`（步骤键的后缀，如 `implement@backend`）、`sourceRepo`（切出工作区的那份检出）、`repo`（工作区目录）、`workspaceRef`（第 1 版叫 `workspaceId`）、`branch`、`specHash`（最近一次同步过去的 spec），以及这个仓库自己的 `codeBase` 和 `gate`（格式同顶层）。见 ADR 0025 |
| `approval` | object \| null | 可选，1.8.0 起。方案确认点：`attempt`（哪一次尝试的方案）、`status`（`waiting` / `approved`）、`at`。需求变更后的新尝试需要重新确认 |
| `external` | object \| null | 可选，1.9.0 起。外部系统中的卡片，按集成名称：`id`（卡片编号）、`url`、`status`（最近设置的状态）、`syncedAt`、`pending`（没有成功、等待补发的调用：`action` 为 `create` / `status`、`event`、`status`、`at`、`attempts`、`error`）。见 ADR 0028 |
| `pushed` | array \| null | 可选，1.10 起。从卡片开始、配置了 `push` 的需求推送过的分支，每个仓库一条（主仓库在前）：`repo`、`remote`、`branch`、`at`、`error`（成功时为 null；1.14 起，发现疑似密钥时不推送，`error` 写明原因）。见 ADR 0029 |
| `gate` | object \| null | 可选，1.8.0 起。质量门：`baseline`（`attempt`、`commit`、`at`、`results`：每项检查改动前 `pass` / `fail`），`runs`（每次运行：`key` 步骤键、`attempt`、`at`、`checks`（`name`、`result`：`pass` / `fail` / `skipped`、`failedBefore`）、`newFailures`、`fixRounds`、`passed`）。各次运行的完整输出在 `.pipeline/checks/<步骤键>/` |

`wakeups[].kind` 在 1.7.0 起还可能是 `verify-start`（`--verify-at` 预约的测试验证开始），1.8.0 起还可能是 `approval-continue`（方案确认超时后按方案继续，`designApproval.autoContinueHours`）。`history` 中每条步骤记录在 1.7.0 起有可选的 `phase`（`develop` / `verify`），用于按阶段统计用时与用量；没有时按研发阶段统计。

## 迁移

只增加可选字段（缺少时按默认值处理，旧版本引擎读到也不出错）时不提升版本，以便回滚到旧版本后仍能继续已有的流水线；在上表中注明"可选"和起始版本即可。

引擎（`engine/src/state.ts`）中 `STATE_VERSION` 是当前版本，`STATE_MIGRATIONS[n]` 把第 n 版升级到第 n+1 版。增加必需字段或改变已有字段的含义时：

1. `STATE_VERSION` 加 1。
2. 在 `STATE_MIGRATIONS` 中加一个从旧版本到新版本的函数，为旧文件补上默认值。
3. 在 `engine/test/state.test.ts` 中加一条迁移测试，更新本文件。

## 第 1 版到第 2 版（laoshi M2d）

只改名，值不变，流程语义不变（[state-v2](../docs/design/state-v2.md)）：`originAgentId` → `originSessionId`，`worktree.workspaceId` → `worktree.workspaceRef`，`joint[].workspaceId` → `joint[].workspaceRef`，`schedules[]` → `wakeups[]`（`id` → `ref`）；另加可选的 `adapter`、`mode`、`stepRequest`。

- 读到第 1 版时自动迁移并写回，原文件保留为 `state.json.bak-v1`。
- 文件属于一条**还在运行**的流水线（`status` 为 `running`，进程仍在，且不是当前进程）时，只在内存中迁移，不改写它的文件：那个进程（可能是 req-kit 1.x）还在按自己的格式写。它结束后，下一次读取时再迁移。
- 迁移是单向的：req-kit 1.x 读到第 2 版会拒绝运行。回滚时把 `state.json.bak-v1` 恢复为 `state.json`，再改用 1.x。
- 对外契约不随之改名（ADR 0004）：`req api`（[cli-json.md](cli-json.md)）、通知事件（[notifier-event.md](notifier-event.md)）、使用记录与需求索引（[usage-record.md](usage-record.md)）仍为 `schema: 1`，仍输出 `originAgentId`、`workspaceId`，值取自 `originSessionId`、`workspaceRef`。
