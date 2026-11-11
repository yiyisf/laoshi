# 摸高适配器

让 laoshi 运行在摸高上，作为数字工程师挑战赛的"专家"。设计见 [mogao-expert](../../docs/design/mogao-expert.md)，摸底结果见[摸高沙箱摸底报告](../../docs/discovery/mogao/report.md)。

## 组成

| 部分 | 位置 | 做什么 |
| --- | --- | --- |
| 适配器 | `adapter.ts` | 能力（工作区、服务用 laoshi 内置的；工具调用来自平台回调；没有定时和向对话推送）、用词、体检（`aimax --version`）；`runsInChat`：引擎在对话的命令里运行 |
| 运行时 | `mogao-runtime.ts` | 步骤 agent 是一次 `aimax run --project-dir … --output json --callback-url … --timeout …`；追问、打断后续接用 `-s <会话>`；`paused` 时等待批准，`laoshi permission` 转达决定后用 `aimax resume` 送达；本机 HTTP 接收端收进度回调（工具调用写日志前脱敏）。每个 agent 的记录在 `<安装根>/mogao/agents/<id>/`，下一轮的引擎能接上；对话轮次结束打断的运行，用它的会话续接 |
| 安装 | `install.mjs` | 安装级配置（`platform.adapter = mogao`）；按摸高渲染的 skill 放在 `<安装根>/skills`，就是专家的 skill 包 |
| 测试 | `test/` | 运行时配上假的 `aimax`（`fake-aimax.mjs`，按摸底记录的 JSON 和回调格式）；属于 `npm test` |
| 端到端检查 | `e2e/run-e2e.mjs` | 真实的启动命令和引擎跑一条 quick 档流水线，步骤由假的 `aimax` 完成；含一次"等待批准 → 轮次结束 → 下一轮批准 → 接着跑完" |

## 专家

```sh
node adapters/mogao/make-expert.mjs [--out <目录>]     # 默认 dist-expert/
```

生成 `laoshi-expert-<版本>/`（和同名 zip）：按摸高渲染好的 skill（`/laoshi`、`/laoshi-setup`、`/laoshi-doctor`、`/laoshi-retro` 和方法、原则 skill），以及介绍专家的 `EXPERT.md`。skill 里的程序路径都是工作区里的 `/data/workspace/.laoshi/npm/node_modules/@yiyi_zhang/laoshi`；入口 skill 在第一次使用时从内网 npm 镜像安装这个版本（`npm install --prefix /data/workspace/.laoshi/npm`），之后直接使用。所以要用**已经发布到 npm 的版本**生成专家。

摸高上 laoshi 找安装根的方式：没有 `LAOSHI_HOME` 时，程序装在 `<安装根>/npm/…/node_modules` 下、`<安装根>` 有安装级配置，就用它（`$HOME` 每轮都会重置，不能依赖 `~/.laoshi`）。

## 在摸高上使用

提交专家、第一次使用、项目接入、日常使用和配置见[在摸高上使用](../../docs/guide/在摸高上使用.md)。

## 端到端检查

```sh
node adapters/mogao/e2e/run-e2e.mjs [--out <目录>]
```

最近一次结果（2026-11-07，Linux，Node 24）：11 项全部通过。

## 已修复的问题

- **步骤做完了，引擎要等到平台结束命令才接着走**（2026-11-09 沙箱实测发现，同日修复）：对话里一直在刷进度，步骤 agent 实际已经完成，引擎却要等很久才进入下一步；运行记录里每次运行的结束原因都是"流水线进程被 SIGTERM 终止"。
  - 原因：运行时以"`aimax run` 进程结束"作为这一步结束的信号，而 agent 做完后 `aimax run` 进程有时不退出。引擎一直等，直到平台到时结束后台命令（SIGTERM）；下一次 `laoshi resume` 读到已经写好的结果，才进入下一步。
  - 修复（`mogao-runtime.ts` 的 `finished`）：输出里已经有完整结果（给出结果 2 秒后进程仍在），或平台回调送来了这次运行的 `done` 事件，就算这一步结束，并结束残留的进程。假 `aimax` 的 `FAKE_AIMAX_LINGER_MS`、`FAKE_AIMAX_HOLD_OUTPUT` 模拟这种情况，有测试。

- **回调格式按平台文档对齐**（2026-11-11，沙箱里的 `events.jsonl` 和平台文档 CallbackEventPayload）：回调事件是平铺的、按 `type` 区分（`start`、`progress`、`done`、`error`、`usage`、`hitl`、`title_updated` 等）。之前按摸底推测的格式解析，结果 `usage` 的数字都是 null（实际在 `usage` 字段里），工具调用一条也没收到（实际包在 `progress` 事件的 `event` 里），危险命令拦截和"最近活动"在摸高上没有生效。现在：`progress` 拆开取里面的事件，没用到的 `progress` 只记下种类；`usage` 从 `usage` 字段读，计入 `cacheReadTokens`；`error` 和 `done` 一样表示这次运行结束；判断 `done` 属于哪次运行改为看"最后一个 `start` 之后"，上一版启动的 agent（记录里没有开始时间）也能接上。`AgentProgressEvent` 的具体结构还没核对，先按"里面是工具事件"解析。

## 还没有做 / 待确认

- 在摸高沙箱里的真实运行：`aimax resume` 的输出格式、`--callback-url` 事件的外层结构、一轮对话最长能持续多久，按真实结果调整。
- `aimax run` 能否指定模型（现在所有角色用平台的模型）；提示词超过 100 KB 时改为"读这个文件"的消息。
