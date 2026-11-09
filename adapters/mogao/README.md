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

## 已知问题

- **步骤做完了，引擎要等到超时才接着走**（2026-11-09，沙箱实测）：真实需求能跑完全流程，但对话里一直在刷进度，步骤 agent 实际已经完成，引擎却常常要等到这一步超时后才拿到结果、进入下一步，整体耗时变长。
  - 推测的原因：运行时以"`aimax run` 进程结束"作为这一步结束的信号（`mogao-runtime.ts` 的 `finished`）。如果 agent 做完后 `aimax run` 进程没有马上退出（例如步骤里起了后台进程、mvn 守护进程，或进程还有未关闭的连接），引擎就一直等，直到这一步超时，下一轮检查时才发现结果文件已经写好。
  - 要确认：一个慢的步骤的 `<安装根>/mogao/agents/<id>/` 下 `events.jsonl` 里 `done` 事件的时间、`run-<n>.out` 是否已经有完整结果、当时 `aimax run` 进程是否还在（`ps`），以及流水线日志里这一步的开始、超时时间。
  - 修复方向：把回调的 `done` 事件、或 `run-<n>.out` 里已经完整的结果当作"这一步结束"，不再等进程退出；之后留一点时间让进程自己退出，还不退出就结束它。

## 还没有做 / 待确认

- 在摸高沙箱里的真实运行：`aimax resume` 的输出格式、`--callback-url` 事件的外层结构、一轮对话最长能持续多久，按真实结果调整。
- `aimax run` 能否指定模型（现在所有角色用平台的模型）；提示词超过 100 KB 时改为"读这个文件"的消息。
