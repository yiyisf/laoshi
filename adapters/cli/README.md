# 命令行 agent 适配器（M3）

不依赖任何 agent 平台：在只装了编码 agent 命令行（Claude Code 的 `claude`、OpenAI Codex 的 `codex`）的机器上运行 laoshi 的流水线。设计见 [cli-adapter](../../docs/design/cli-adapter.md)。

## 组成

| 部分 | 位置 | 做什么 |
| --- | --- | --- |
| 适配器 | `adapter.ts` | 能力（工作区、服务用 laoshi 内置的；工具调用来自命令行的事件流；没有对话、定时和审批）、用词、体检（各命令行 `--version`） |
| 驱动 | `drivers.ts` | 每种命令行怎么启动、怎么续接会话、怎么读它的 JSON 事件：`claude -p --output-format stream-json --verbose`（续接 `--resume <会话>`）、`codex exec --json`（续接 `exec … resume <会话>`） |
| 运行时 | `cli-runtime.ts` | 步骤 agent 是一次命令行运行，提示词从标准输入传入；追问、打断用会话续接；工具调用写日志前脱敏；运行被意外打断（没有结果）时用会话继续。每个 agent 的记录在 `<安装根>/cli/agents/<id>/` |
| 安装 | `install.mjs` | 安装级配置（`platform.adapter = cli`，builder 用 `claude/default`、reviewer 用 `codex/default`）；skill 装到 `~/.agents/skills`，有 `~/.claude` 时还有 `~/.claude/skills` |
| skill 片段 | `skill/setup.md` | 入口 skill 里命令行特有的说明：步骤不在对话里、没有通知，问进展时运行状态命令 |
| 测试 | `test/` | 运行时配上假的命令行（`fake-agent.mjs`，按两个命令行公开的 JSON 输出格式）；`e2e.test.ts` 用 `laoshi start` 在后台跑完一条 quick 流水线 |

## 使用

```sh
npx -y @yiyi_zhang/laoshi@latest install --platform cli
laoshi doctor --no-project      # 确认 claude、codex 能运行
```

之后在交互式的 Claude Code 或 Codex 里用 `/laoshi`。流水线在后台运行，进展用 `laoshi status <需求>` 查看（`/laoshi` 里说"做到哪了"）；设置了环境变量 `LAOSHI_CLI_ORIGIN`（任意值）时，给人的消息还会写进 `<安装根>/cli/messages.log`。外部通知模块（IM 等）照常收到事件。

安装级配置：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `platform.cli.claude` / `platform.cli.codex` | `claude` / `codex` | 命令（不在 `PATH` 中时写完整路径） |
| `platform.cli.runTimeoutMinutes` | 120 | 一次运行的上限（引擎另有每一步的时限） |
| `agents.<角色>.provider` | `claude/default`、`codex/default` | `claude/<模型>` 或 `codex/<模型>`；`default` 用命令行自己的默认模型 |
| `agents.<角色>.modeId` | Claude `bypassPermissions`，Codex `full-access` | 权限模式，见设计文档第 3 节；非交互模式不会等待批准 |

## 还没有做 / 待确认

- 在真实的 Claude Code、Codex 上运行一个 `evals/` 用例（M3 的完成标准）；事件流字段按公开格式解析，可能要按实际输出调整（尤其是 `codex exec … resume` 的参数位置）。
- OpenCode、Pi 的驱动；一致性测试 `runConformance(adapter)`；定时（等内置调度）。
