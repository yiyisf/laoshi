# 摸高沙箱摸底报告

- 时间：2026-11-06
- 做法：在摸高的对话里运行 [probe.sh](probe.sh)，并按 [README](README.md) 做了存活测试；结论由使用者整理后发回。原始输出未入库。
- 用途：决定 laoshi 以哪种形态作为摸高上的"专家"参加数字工程师挑战赛（赛题：在平台中提交 skill 或专家，专家是多个 skill 的组合）。设计见 [mogao-expert](../../design/mogao-expert.md)。

## 结论

| 问题 | 结果 |
| --- | --- |
| 容器的寿命 | 每个会话新建一个容器（`/proc/uptime` 只有几分钟）。**每条命令执行完，沙箱实例就被回收**：两次存活测试里后台进程都只活了 10～20 秒 |
| 哪些目录持久 | `/data/workspace` 持久（标记文件、npm 安装结果、打包结果都在）；`/tmp`、`$HOME`（`/wls/ci/`）每次执行都重置 |
| 一次命令能跑多久 | 一次执行内可以跑长任务：前台约 60 秒后转为后台会话继续；同一次执行内可以用平台命令行 `aimax run` 起任务并轮询状态 |
| 跨对话、跨回合的后台进程 | **不行**。"后台常驻 + 之后再查状态"走不通 |
| 平台命令行 | `aimax`（有 `run` 子命令），用法待第二轮确认 |
| 平台环境变量（只记名字） | `AIMAX_SESSION_ID`、`AIMAX_USER_NAME`、`AIMAX_MODEL`、`AIMAX_VL_MODEL`、`AIMAX_LLM_API_KEY` |
| 工具链 | Node.js 23.11、npm 10.9、git 2.43、Python 3.12、Java、docker 19.03、curl、zip/unzip/tar；沙箱自带的工具较少，没有 mvn、gradle。**缺的工具可以装到 `/data/workspace` 下，不随沙箱销毁而丢失**（已确认 mvn 装在工作区可用；工作区在 NAS 卷上，空间足够） |
| 网络 | npm 走内网镜像，装包可行（`tsx@4` 2.6 秒、12 MB，可执行，结果持久在工作区）；公网全部不通（npm 官方源、GitHub、模型服务） |
| skill 的格式 | 业界通用的 `SKILL.md` 结构，只是目录是平台定制的 |
| skill 在哪里 | `/aimax/extensions/*/skills`（如 workflow-script、goals）；`/scenes/dev/…`、`/scenes/product/…`、`/scenes/test/…` 下有大量 `SKILL.md`（SDD 系列、BRD/PRD、测试用例与执行等）；内置 skill 在 `/aimax_pvc/skills/built-in/*`；`$HOME` 下没有 `.claude`、`.agents` 等目录 |

## 对形态的判断

- **形态甲（专家 + 常驻后台引擎）不可行**：后台进程活不过一次执行，`/tmp`、`$HOME` 也不持久。只有平台明确提供跨对话的常驻进程时才能重新考虑。
- **可行的是"每条命令内跑完"**：一次执行内可以跑长任务，也可以在同一次执行内用 `aimax run` 起任务并等它结束；状态只能写在 `/data/workspace`。
- **依赖可以在第一次使用时从内网镜像装**，装好的东西留在工作区。
- 结论倾向：形态乙（对话内编排；或"每次执行跑完一步"）或形态丙（纯 skill）。

## 第二轮：平台命令行 `aimax`（2026-11-06）

用 [probe2.sh](probe2.sh) 收集，并在同一会话里补测了几项。原始输出未入库。

| 项 | 结果 |
| --- | --- |
| 命令行 | `aimax` 0.36.0（Node.js 程序）。子命令：`run`、`resume`、`cancel`、`sessions`、`task`、`goal`、`generate`、`summarize`、`commands`、`bootstrap`、`memory`、`agents`、`plugins`、`snapshots`、`export-html` |
| 数据目录 | 默认 `/data`，会话在 `/data/.aimax/sessions` |
| 认证 | 用环境变量里的平台凭据（或 `--auth-token`），不需要另外登录 |
| 起一个 agent | `aimax run --project-dir <目录> --message "…" --output json --timeout <毫秒>`：同步执行，返回 JSON：`sessionId`、`text`、`usage{input,output,total}`、`durationMs`、`modelName`、`context{snapshotPath,toolResultsDir}` |
| agent 的能力 | 有完整的工具（能执行命令、读写文件）；加 `--plugins-config` 后平台插件（知识库等）也能用 |
| 续接 | `aimax run -s <sessionId> --message "…"`：接着同一个会话，记得之前的上下文（会话文件持久，不需要进程常驻） |
| 并发 | 同一次执行里同时起两个 `aimax run`，都正常结束 |
| 查状态 | `aimax sessions -d /data --output json` 列出全部会话；`-s <id>` 看详情；`export-html` 导出可读页面 |
| 容器（更正第一轮） | **每个对话轮次一个容器**，同一轮里的多次执行共用这个容器（`/tmp` 在轮内保留）；轮次结束容器就没了 |
| 持久目录 | `/data/workspace`、`/data/.aimax` 跨轮保留 |
| 单条命令时长 | `sleep 75` 正常；前台约 60 秒后转为后台会话，对话轮询它；长任务用后台会话 |
| laoshi 0.1.1 | 内网镜像能装（约 40 秒、44 MB），`version`、`help`、`list` 能运行；`doctor` 报"没有平台"（没有 Paseo、没有 dsh、没有安装级配置），这是预期的：还没有摸高适配器 |

## 第三轮：用 `aimax run` 串流水线（2026-11-06）

| 项 | 结果 |
| --- | --- |
| 三步流水线 | 每步一次独立的 `aimax run`（新会话），步骤之间只靠文件和 `state.json` 传递：需求说明 → 方案 → 实现，三份产物正确衔接；用时 64 秒、7 秒、64 秒，每步约 1.4 万 token。用时波动大，每步要有自己的超时和重试 |
| 进度回调 | `--callback-url`（HTTP POST，发出即忘，接收端不在不影响运行）：`start`、`thinking_end`（思考摘要）、`usage`、`tool_start`（`toolCallId`、命令、风险等级、是否只读）、`tool_end`（完整输出、退出码、目录）、`title_updated`、`done`（结果文本、用量、用时）。本地 HTTP 服务能收到 |
| 文本流 | `--stream-url`（WebSocket，令牌放在 query 参数）：`start`、`text`（增量，带序号）、`done` |
| 审批（HITL） | 默认权限模式按工作区 `.aimax/config.yaml` 的命令黑名单拦截；命中时 `run` **立即返回** `paused: {requestId, kind: "approval", title}`，并在会话目录写 `pending-hitl.json`。`aimax resume -d /data -s <会话> --request-id <id> --input-json '{"action":"approve"\|"deny",…}'` 续跑（拒绝后 agent 明确不重试）；`aimax cancel … --request-id <id>` 取消。其他权限模式：confirm、autoEdit、plan、fullAccess、unset（环境变量 `AIMAX_PERMISSION_MODE`）；审批默认 30 分钟超时，超时按拒绝 |
| 超时 | `--timeout` 到期：退出码 1，仍输出 JSON（`error: "Run timed out after …ms"`、`sessionId`、`usage`）；没有残留进程；没有写到一半的文件；可以用 `-s` 续跑。要看 `error` 字段区分超时和失败（两者退出码都是 1） |

## 风险（第二、三轮发现）

1. `aimax generate` 会把模型请求的 Authorization 头打进日志。laoshi 不用 `generate`；laoshi 记录的工具输出也要先脱敏再写日志。
2. 环境变量里有平台凭据，步骤 agent 执行的命令能读到。laoshi 的危险命令拦截要把"读出或外发这些变量"算作危险操作。
3. 每次 `aimax run` 的系统提示约 1.38 万 token，没有缓存命中；laoshi 的用时和 token 估算按这个算。
4. 会话都在 `/data/.aimax`，需求多时会话目录会变大。

## 结论（三轮）

形态定为 **B1**：laoshi 的引擎加一个摸高适配器，步骤 agent 用 `aimax run` 起，用 `-s` 续接，审批走 `paused` / `resume` / `cancel`，工具调用和用量从 `--callback-url` 收。引擎在对话的一次执行（后台会话）里运行，状态写在工作区，轮次结束后下一轮 `laoshi resume` 接着做。见 [mogao-expert](../../design/mogao-expert.md)。
