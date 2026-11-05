# 配置项

配置分三层，后者覆盖前者：

1. **本机配置** `~/.laoshi/config.json`（`LAOSHI_HOME` 可以改变目录）——`laoshi install` 生成，`laoshi configure` 修改；
2. **团队配置**：本机配置的 `teamConfig` 指向的文件，适合放进团队共用的仓库；
3. **项目配置**：仓库根目录的 `.laoshi.json`，只写和本机不同的部分。

`platform`、`user`、`daemonUrl`、`daemonPasswordEnv`、`teamConfig` 只能写在本机配置中；`notifiers`、`integrations`、`push`、`factory`、`people` 不能写在项目配置中（会运行命令、推送或发消息）。写错时，流水线启动前会说明哪一项、为什么。完整的示例见仓库的 [config.example.json](https://github.com/yiyisf/laoshi/blob/main/config.example.json)。

## 平台

```json
{ "platform": { "adapter": "dsh", "dsh": { "home": "D:/dsh", "profile": "web" } } }
```

| 字段 | 说明 |
| --- | --- |
| `platform.adapter` | 流水线运行在哪个平台：`paseo`（默认）或 `dsh`。`laoshi install --platform` 写入 |
| `platform.<平台>` | 这个平台自己的设置，例如 dsh 的 `home`（`DSH_HOME`）、`profile`；安装器按安装选项写入 |
| `user` | 写进使用记录和通知事件的使用者名称（可选；环境变量 `LAOSHI_USER` 优先，都没有时用系统的用户名） |

## agent

```json
{
  "agents": {
    "builder": { "platformProfile": "实现" },
    "reviewer": { "provider": "codex/<模型 ID>", "modeId": "full-access" }
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `platformProfile` | Paseo 中 agent profile 的名称；写在它旁边的字段优先 |
| `provider` | `provider/model`。Paseo：如 `claude/claude-sonnet-5`、`pi/anthropic/claude-sonnet-5`；dsh：`<dsh 的提供方>/<模型>`，如 `deepseek/deepseek-reasoner`，`dsh/chat-model` 用对话的模型 |
| `modeId` | Paseo：必须是不会停下来请求批准的模式：Claude Code `bypassPermissions`、Codex `full-access`、OpenCode `build`（加 `featureValues: { "auto_accept": true }`）、Pi 不写 |
| `thinkingOptionId`、`featureValues`、`options` | 原样传给 provider；dsh 上 `thinkingOptionId` 作为推理强度 |

## 流程

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `defaultProfile` | `standard` | 需求说明没写档位时用的档位 |
| `profiles.<档位>.rounds` | 快速 1/1/1，标准 2/3/3 | 方案审核、代码评审、缺陷修复的最多轮数 |
| `profiles.<档位>.serviceStart` | 快速 false，标准 true | 是否做服务启动验证 |
| `phases` | 连续 | 执行方式和测试阶段的选项，见 [分阶段执行与提测](/guide/phases) |
| `specReview` | `standard` | 确认前独立审阅需求说明：`standard`（标准档）、`always`、`off` |
| `designProposals` | 关闭 | `{"enabled": true}`：方案设计前由几个 agent 并行各提一份方案 |
| `reviewPanel` | 关闭 | 评审小组：首轮方案审核和代码评审由多位成员并行评审，再由 reviewer 核实汇总 |
| `stepTimeoutMinutes.<步骤>` | 20–240 分钟 | 每个步骤的总时限 |
| `resultFollowUps` | 2 | 结果文件缺失或不合格时提醒补写的次数 |
| `retry` | 2 次，等 60/300 秒 | 临时错误（限流、网络）后自动重做这一步 |
| `selfHeal` | `true` | 超时时 agent 还在做就再等一轮；agent 报错、结果文件无效时新开 agent 重做一次 |
| `answerQuestionsFirst` | `true` | 方案审核要需求方决定的问题，先由 builder 从代码和文档中自答 |
| `agents.fallback` | 无 | 备用模型，报错重做、限流重试用完时换它做这一步 |

## 质量与范围

通常写在项目配置 `.laoshi.json` 中，见 [项目定制与运行规则](/guide/project)。

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `checks` | `[]` | 质量门：流水线自己运行的检查，`[{ "name", "command", "cwd"?, "paths"?, "timeoutMinutes"? }]`；只拦改动前通过、现在失败的检查 |
| `qualityGate.fixAttempts` | 2 | 新失败发回 agent 修复的次数，用完照常继续并写进报告 |
| `qualityGate.timeoutMinutes` | 20 | 单项检查的默认时限 |
| `slices` | 标准档，最多 6 片 | 按切片实现：`profiles` 哪些档位，`max` 最多几片 |
| `requirementTypes` | 缺陷、重构、评估 | 哪些需求类型按自己的做法运行；去掉的按新需求处理 |
| `relatedRepos` | `[]` | 只读参考的其他仓库，`[{ "name", "path", "role"? }]`，`path` 相对项目目录 |
| `designApproval` | 界面改动，标准档 | 方案确认点：`mode`（`ui` / `always` / `off`）、`profiles`、`autoContinueHours`（超时按方案继续，0 一直等） |
| `reviewAxes` | 开启，标准档 | 第一轮代码评审由规格评审和规范评审并行，再汇总：`enabled`、`profiles` |

## 平台能力

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `attachToOriginChat` | `true` | 步骤 agent 作为子 agent 挂在发起的对话下 |
| `archiveStepAgents` | `false` | 步骤完成后归档它的 agent |
| `platformServices` | `auto` | 用平台的服务（Paseo 的 `paseo.json`）或 laoshi 内置的服务管理（`.laoshi/services.json`），启动、分配端口；`off` 由步骤 agent 自己启动 |
| `serviceReadySeconds` | 120 | 等待服务就绪的时间 |
| `browserVerify` | `auto` | 有 Paseo 浏览器工具时，验证步骤在浏览器中实际操作 |
| `quotaWarnPercent` | 85 | 开始时额度用到这个比例以上就提醒；0 关闭 |

## 通知与调度

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `notifyMilestones` | `true` | 关键节点（方案确定、开始验证、修复缺陷）在对话里说一句 |
| `notifiers` | `[]` | 外部通知模块（企业 IM 等），见 [外部通知事件](/reference/contracts/notifier-event) |
| `people` | `{}` | 需求方姓名到 IM 账号的对应，按人通知时用；只能写在本机或团队配置中 |
| `push.mergeRequest` | 无 | 推送后用 `glab` 等命令建草稿合并请求，参数可用 `{branch}` `{target}` `{title}` `{description}` |
| `autoConfirm.hours` | 0（关闭） | 快速档、没有待答问题的卡片，过这么久没有异议就开始 |
| `waitingReminderHours` | 24 | 等待需求方回答、或研发完成待测试超过这么久，提醒一次；0 关闭 |
| `autoResumeMinutes` / `autoResumeMax` | 30 / 2 | 临时错误中断后自动继续的等待时间和次数；0 关闭 |
| `watchdogMinutes` | 60 | 运行期间定时检查，进程意外退出时自动继续；0 关闭（默认 60） |
| `maxConcurrentPipelines` | 0 | 本机同时运行的流水线上限，满了排队；0 不限 |
| `queuePollSeconds` | 60 | 排队时检查空位的间隔 |

## 本机与团队

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `daemonUrl` | `ws://127.0.0.1:6767/ws` | Paseo daemon 地址（Paseo） |
| `daemonPasswordEnv` | `PASEO_DAEMON_PASSWORD` | 存放 daemon 密码的环境变量名（Paseo） |
| `teamConfig` | `null` | 团队配置文件的路径 |
| `requiredVersion` | `null` | 团队或项目期望的 laoshi 版本范围，例如 `">=0.1.0 <1"`；只提醒不阻止 |
| `waitChunkSeconds`、`permissionPollSeconds` | 600、30 | 等待步骤 agent 的分段长度、检查权限批准的间隔 |
