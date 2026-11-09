# 命令行 agent 适配器（M3）

- 状态：第一版已实现（[adapters/cli](../../adapters/cli/README.md)），用假的命令行测试；真实的 Claude Code、Codex 上的运行待验证。
- 目标：不依赖任何 agent 平台，在一台只装了编码 agent 命令行（Claude Code 的 `claude`、OpenAI Codex 的 `codex`）的机器上跑完整的流水线（[抽取计划 M3](../extraction/plan.md)）。这是第一个"非平台"的适配器，也是 [ADR 0002](../adr/0002-two-orchestration-modes.md) 里模式 A 的最小形态。

## 1. 形态

```text
使用者 ──► 交互式的 Claude Code / Codex（加载 /laoshi skill）
               │ laoshi start <需求>（引擎在后台运行，和 Paseo 上一样）
               ▼
         laoshi 引擎 ── 每一步 ──► claude -p … / codex exec …（一个子进程，带完整工具）
               │                      │ 标准输出是事件流（JSONL）：会话 ID、工具调用、用量、结果
               ▼                      ▼
         结果文件、质量门、写回状态 → 下一步 …… → 需要人决定或做完：通知（日志、外部通知模块）
```

和摸高适配器一样，"步骤 agent"是一次命令行运行，追问、续接用同一个会话；不同的是这里没有平台：没有对话可以发消息，没有审批界面，没有定时任务。

## 2. 映射

| laoshi 需要 | 命令行上怎么做 |
| --- | --- |
| `startAgent` | 按角色的 `provider`（`claude/<模型>`、`codex/<模型>`）选命令行，在步骤目录起一个子进程；提示词从标准输入传入（不受命令行参数长度限制） |
| `wait` | 等子进程结束，读它的事件流：正常结束 → `idle`（带最后一条回复和用量）；出错 → `error`；超过单次运行上限 → 结束进程，`error` |
| `followUp` / `interruptAgent` | 用会话 ID 续接：`claude -p --resume <id>`、`codex exec resume <id>`；打断时先结束正在运行的进程 |
| `attachAgent` | 每个 agent 的记录在 `<安装根>/cli/agents/<id>/`（`agent.json`、提示词、每次运行的输出），另一个引擎进程也能接上 |
| 运行被意外打断（机器重启、进程被杀） | 进程不在了又没有结果：用会话续接，让它接着做（最多两次），不重做整步 |
| `recentActivity`、`runningTool`、`toolCalls` | 事件流里的工具调用（Claude 的 `tool_use` / `tool_result`，Codex 的 `command_execution`），写日志前脱敏；危险命令拦截照常工作 |
| 用量 | 事件流最后的用量（输入、缓存命中、输出 token，Claude 另有费用） |
| `providerStatus`、体检 | `<命令> --version` 能运行即为可用 |
| 审批 | 命令行的非交互模式不会停下来问人：由角色的 `modeId` 决定权限（见第 3 节），laoshi 的危险命令拦截兜底 |
| `notifyAgent`（进展发回对话） | 没有对话：通知写进流水线日志，并照常发给外部通知模块（[notifier-event](../../contracts/notifier-event.md)）；使用者用 `laoshi status` 看进展。设置了 `LAOSHI_CLI_ORIGIN` 时，通知还写进 `<安装根>/cli/messages.log` |
| 定时（`scheduleMessage` 等） | none（[内置调度](builtin-capabilities.md)已设计未实现，实现后由它提供） |
| 工作区、服务 | builtin（`git worktree`、`.laoshi/services.json`），和 dsh、摸高一样 |
| 发起的对话 | 没有：命令行不提供会话 ID；`LAOSHI_CLI_ORIGIN`（任意值）可以当作"对话"，让通知写进 `messages.log` |

## 3. 权限

非交互模式下，命令行遇到没有许可的操作只会拒绝，不会等人。所以每个角色要在配置里写一个不会卡住的权限模式，和 Paseo 上的写法相同（`modeId`）：

| 命令行 | `modeId` | 传给命令行 |
| --- | --- | --- |
| Claude Code | 默认 `bypassPermissions`；也可以写 `acceptEdits`、`default`、`plan` | `--permission-mode <modeId>` |
| Codex | 默认 `full-access` | `full-access` → `--dangerously-bypass-approvals-and-sandbox`；`auto` → `--full-auto`；`read-only` → `--sandbox read-only` |

用"不问人"的模式时，安全靠三层：步骤提示词的约束、laoshi 的危险命令拦截（读事件流里的工具调用，命中就打断这一步）、git 工作区（改动都在分支上，可以丢弃）。在共享或含机密的机器上，应该改用更严格的模式，并接受某些步骤因为权限不够而失败。

## 4. 配置

安装级配置：

```json
{
  "platform": { "adapter": "cli", "cli": { "claude": "claude", "codex": "codex", "runTimeoutMinutes": 120 } },
  "agents": {
    "builder": { "provider": "claude/default", "modeId": "bypassPermissions" },
    "reviewer": { "provider": "codex/default", "modeId": "full-access" }
  }
}
```

- 模型写 `default` 时不传模型参数，用命令行自己的默认模型。
- 只装了一种命令行时，两个角色都用它；评审的独立性靠"新会话、不带实现上下文"保证。
- `platform.cli.<命令行>` 写命令的路径（不在 `PATH` 中时）；测试用环境变量 `LAOSHI_CLI_CLAUDE`、`LAOSHI_CLI_CODEX` 覆盖。

## 5. 安装

`laoshi install --platform cli`：写安装级配置；skill 装到 `~/.agents/skills`（Codex 等读取），有 `~/.claude` 时还有 `~/.claude/skills`，和 Paseo 相同。之后在交互式的 Claude Code 或 Codex 里用 `/laoshi`。入口 skill 里命令行特有的一节（`adapters/cli/skill/setup.md`）告诉对话：步骤不在子 agent 列表里、不会收到通知，用户问进展时运行状态命令。

## 6. 还没有做

- **真实命令行上的验证**：事件流的字段按两个命令行公开的 JSON 输出格式解析，测试用假的命令行（`adapters/cli/test/fake-agent.mjs`）。M3 的完成标准是"在只有编码 agent 命令行的机器上跑通一个 `evals/` 用例，夸大为零"，要在有账号的机器上跑。
- **OpenCode、Pi**：先做 Claude Code 和 Codex；其他命令行按同样的方式加一个驱动。
- **定时**：等内置调度实现。
