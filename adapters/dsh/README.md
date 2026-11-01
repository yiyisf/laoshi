# dsh 适配器（M4b 原型）

让 laoshi 运行在 DeepSeek Harness（dsh）上。设计见 [dsh-adapter](../../docs/design/dsh-adapter.md)，决定见 [ADR 0008](../../docs/adr/0008-capability-sources-and-platform-plugin.md)，摸底结果见 [dsh 摸底报告](../../docs/discovery/dsh/report.md)。

## 组成

| 部分 | 位置 | 做什么 |
| --- | --- | --- |
| 插件 | `plugin/`（npm 包 `laoshi-dsh-plugin`） | 运行在 dsh host 里：在对话下创建步骤 agent、向对话发定时消息、按策略回答步骤的审批请求，并把会话的创建、发送消息、取消、状态、历史转给 dsh 的会话控制器。不含流程逻辑 |
| 运行时 | `dsh-runtime.ts` | 引擎一侧的 `AgentRuntime` 实现，只通过插件做事，不调用 dsh 的 `/api` |
| 本地通道 | `plugin/channel.mjs` | 两边共用的约定：插件在 `$DSH_HOME/laoshi/` 下监听本地 socket（Windows 上是命名管道），并写一个随机令牌，只有同一用户能读到，调用时必须带上 |
| 测试 | `test/` | 插件配上模拟的 dsh 服务，运行时通过真实的 socket 调用插件；属于 `npm test` |
| 端到端检查 | `e2e/` | 在真实的 dsh 上跑一条完整的流水线，只有模型是模拟的；需要装好 dsh，不属于 `npm test` |

## 使用

1. 把插件装进 dsh 的 profile，并挂载：

   ```sh
   dsh plugin --profile web add file:<laoshi>/adapters/dsh/plugin
   ```

   在 `$DSH_HOME/profiles/web/cordis.patch.yml` 末尾加上：

   ```yaml
   - insert:
       - id: laoshi-dsh
         name: 'laoshi-dsh-plugin'
         config:
           approvals: ask   # ask：步骤的审批请求交给人（默认）；allow：直接批准一次
   ```

2. laoshi 的配置里选择 dsh 适配器：

   ```json
   { "platform": { "adapter": "dsh" } }
   ```

3. 在 dsh 的对话里发起流水线。引擎从 `DSH_SESSION_ID` 识别发起的对话，从 `DSH_HOME` 找到插件。对话的 shell 运行在会话目录中，所以仓库目录就是当前目录。

## 原型的范围

已实现：`AgentRuntime` 的全部必需能力（核对发起的对话，创建、等待、追问、打断步骤 agent，续接，向对话发消息），以及定时消息和取消、审批（等人时 `wait` 返回 `permission`）、工具调用记录（危险命令拦截、大目录搜索打断、最近活动）、用量。M2b 起，在新建的工作区中开发（`--worktree`）和由 laoshi 管理的服务使用 laoshi 的内置实现（`git worktree`，以及 `.laoshi/services.json` 中定义的服务，见 [builtin-capabilities](../../docs/design/builtin-capabilities.md)）。

还没有实现：

| 能力 | 现在的行为 | 计划 |
| --- | --- | --- |
| 联合需求（几个仓库各建工作区） | 用内置 worktree，单元测试覆盖了新建工作区，但还没有端到端检查 | — |
| 按角色选择模型（builder / reviewer 的 `provider`） | 步骤 agent 使用对话的模型 | 用 dsh 的 agent 预设或子 agent 的模型选项 |
| 定时任务的截止时间（`expiresAt`） | 忽略，在日志里说明 | — |
| 额度、profile、provider 状态 | 返回 `null` | — |
| Windows | 运行时和插件按 Windows 写好（命名管道），但没有在 Windows 上跑过端到端检查；dsh 在 Windows 上的 shell 见[摸底报告](../../docs/discovery/dsh/report.md#内网-windows-自测结果2026-10-30) | 内网验证 |

## 端到端检查

```sh
LAOSHI_E2E_DSH=<装有 @deepseek-ai/dsh 的目录> node adapters/dsh/e2e/run-e2e.mjs [--out <目录>] [--worktree]
```

加 `--worktree` 时，样例仓库在 main 上，带一个服务和一条准备命令（`.laoshi/services.json`）。脚本通过启动器加 `--worktree` 启动流水线，额外检查以下几项：需求的工作区是安装目录下的 `git worktree`；准备命令已运行；步骤 agent 在工作区中工作；验证前内置服务已启动并通过健康检查；流水线结束后服务已停止。

脚本会做这些事：建一个独立的 `DSH_HOME`，装上插件，用 `e2e/step-model.mjs` 模拟模型，启动 dsh；建一个对话；在对话里用 quick 档跑一条流水线；最后检查结果并写出 `report.md`。

模拟模型对每个步骤，通过 dsh 的 bash 工具写出产出文件和合格的结果文件，所以这个检查验证的是"引擎 → 插件 → dsh 子 agent → 文件 → 引擎"整条链路是否接通，不代表模型的能力。

最近一次结果（2026-11-01，Linux，dsh 0.2.2-alpha.2）：不加参数时 8 项检查全部通过（M4b 时 Node 24.22 和 22.20 各跑一次，M2b 时 Node 24.22）；加 `--worktree` 时 14 项全部通过（M2b，Node 24.22）。7 个步骤（方案设计 → 方案审核 → 代码实现 → 代码评审 → 提测说明 → 功能验证 → 完成报告）都以带标签的子 agent 挂在对话下，流水线状态为 `completed`，进展和结束通知都发回了对话。
