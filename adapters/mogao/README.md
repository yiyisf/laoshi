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

```bash
export LAOSHI_HOME=/data/workspace/.laoshi
npm install --prefix /data/workspace/.laoshi/npm @yiyi_zhang/laoshi@latest
node /data/workspace/.laoshi/npm/node_modules/@yiyi_zhang/laoshi/bin/req.mjs install --platform mogao
```

装好后在项目目录的对话里：`laoshi start <需求>`（或 `/laoshi`）。命令会一直运行到需要人决定的地方（方案确认、业务问题、等待批准）或做完；这期间不要结束这一轮对话。被打断后用 `laoshi resume <需求>` 接着做；步骤等待批准时，问人之后运行 `laoshi permission <需求> approve`（或 `deny`）。

安装级配置中 `platform.mogao` 可以写：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `command` | `aimax` | 平台命令行（不在 `PATH` 中时写完整路径） |
| `dataDir` | `/data` | 平台的数据目录（`aimax -d`） |
| `runTimeoutMinutes` | 240 | 一次 `aimax run` 的上限（引擎另有每一步的时限） |
| `pluginsConfig` | 无 | 给步骤 agent 的 `--plugins-config`（平台插件，如知识库） |

## 端到端检查

```sh
node adapters/mogao/e2e/run-e2e.mjs [--out <目录>]
```

最近一次结果（2026-11-07，Linux，Node 24）：11 项全部通过。

## 还没有做 / 待确认

- 在摸高沙箱里的真实运行：`aimax resume` 的输出格式、`--callback-url` 事件的外层结构、一轮对话最长能持续多久，按真实结果调整。
- `aimax run` 能否指定模型（现在所有角色用平台的模型）；提示词超过 100 KB 时改为"读这个文件"的消息。
