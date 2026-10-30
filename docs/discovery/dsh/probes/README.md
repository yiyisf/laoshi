# dsh 内网摸底包

一条命令跑完 [dsh 摸底](../report.md) 的全部探针，使用的是**内网真实模型**（和 Paseo 上 req-kit 用的是同一个模型），最后生成 `report.md`。结果用于确认 [dsh 适配设计](../../../design/dsh-adapter.md) 在内网成立。

- 用时：约 20～60 分钟。其中 P13 是三个模型任务，每个最多 15 分钟。
- 平台：Linux 或 macOS（用到了 `du`、进程组和 bash）。暂不支持 Windows。
- 摸底包本身已在云端用模拟模型自测通过（`--self-test`），结果见 [自测记录](#自测记录)。

## 需要内网配合设置一次

### 1. 环境

| 需要 | 说明 |
| --- | --- |
| Node.js ≥ 24.9，或 22.19 以上 | dsh 声明要求 ≥ 24.9。但在自测中，Node 22.20 和 22.22 下全部探针都能通过，所以 22.19 以上也可以运行，报告的 P01 会标为 info。低于 22.19 时摸底包会停止 |
| npm 镜像能安装 `@deepseek-ai/dsh@0.2.2-alpha.2` | 会装上约 650 个包，占用约 950 MB，全部在 `@deepseek-ai/*` 等公开包名下 |
| git | 摸底包会建一个小样例仓库 |
| pnpm（可选） | 有 pnpm 时用 `dsh plugin add` 安装探针插件；没有时直接复制，也能用 |

### 2. 环境变量

这些变量**只在运行摸底包时使用**。凭据只通过环境变量读取，不会写进任何文件；报告里的网关地址会打码。

| 变量 | 必填 | 含义 |
| --- | --- | --- |
| `LAOSHI_PROBE_MODEL_BASE_URL` | 是 | 模型网关地址，和 Paseo 上 req-kit 当前使用的是同一个。OpenAI 兼容网关一般以 `/v1` 结尾，例如 `http://llm-gateway.example.internal/v1` |
| `LAOSHI_PROBE_MODEL_ID` | 是 | 模型 ID，和 req-kit 当前使用的相同 |
| `LAOSHI_PROBE_MODEL_API_KEY` | 是 | 访问网关的凭据 |
| `LAOSHI_PROBE_MODEL_API` | 否 | 网关协议：`openai-completions`（默认）、`openai-responses`、`anthropic-messages` |
| `LAOSHI_PROBE_DSH` | 否 | `dsh` 命令的路径。不设时依次查找：当前目录下的 `node_modules/.bin/dsh`、本目录下的同名路径、`PATH` |

## 运行

```sh
# 1. 准备一个空目录，把本目录（probes/）的文件复制进去，然后在里面安装 dsh
mkdir dsh-probe && cd dsh-probe
cp -r <laoshi>/docs/discovery/dsh/probes/* .
npm install @deepseek-ai/dsh@0.2.2-alpha.2 --registry=<内网 npm 镜像>
# 在 Node 22 上会出现 EBADENGINE 警告，可以忽略；如果内网 npm 配置了 engine-strict=true，
# 安装会被拒绝，这时加上 --engine-strict=false

# 2. 先自测：用模拟模型验证摸底包在内网环境里能跑，不消耗模型用量，约 3 分钟
node run.mjs --self-test

# 3. 正式运行
export LAOSHI_PROBE_MODEL_BASE_URL=...
export LAOSHI_PROBE_MODEL_ID=...
export LAOSHI_PROBE_MODEL_API_KEY=...
node run.mjs
```

每次运行都会新建一个输出目录 `dsh-probe-<时间>/`，所有东西都放在里面：独立的 `DSH_HOME`（不影响本机已有的 dsh 配置）、样例仓库、日志、报告。运行期间：

- 会在本机启动一个 dsh web host，只监听 `127.0.0.1` 的随机端口；结束时会停掉。
- 为了测试审批，会在 `$HOME` 下临时建一个 `.laoshi-probe-outside-<时间>` 目录，结束时删除。
- 用 `--import netlog.mjs` 记录 dsh 进程发起的每一次 DNS 解析和连接。只做记录，不拦截任何连接。

可选参数：`--out <目录>` 指定输出目录；`--task-timeout <分钟>` 设置 P13 每个任务的超时，默认 15。

## 探针

| 编号 | 内容 |
| --- | --- |
| P01 | Node、dsh、pnpm 的版本，安装占用的空间 |
| P02 | 模型接入：依次尝试几组兼容设置（`supportsDeveloperRole`、`maxTokensField`），记下第一组能用的 |
| P03 | 工具调用、产物落在会话目录、`DSH_*` 环境变量（识别发起的对话） |
| P04 | 会话状态与 token 用量 |
| P05 | 用 `session/cancel` 打断一个正在运行的回合 |
| P06 | 回合运行中投递消息（queue），确认不打断当前回合 |
| P07 | 回合运行中插话（steer） |
| P08 | 由插件在会话下创建子 agent：带标签、显示在会话的子 agent 列表里、产物写在指定目录 |
| P09 | 从外部追问子 agent |
| P10 | 由插件创建定时消息，到点送进会话 |
| P11 | 审批：由插件代为批准；以及没人作答时会怎样 |
| P12 | host 重启后：会话是否还在、旧 cookie 是否有效、主会话和子 agent 能否接着跑 |
| P13 | 模型按 req-kit 结果文件约定完成三个步骤：方案设计、代码实现、代码评审 |
| P14 | 对外连接：除本机和模型网关外，dsh 有没有尝试连接其他地址 |

## 回传

请把输出目录打包回传，包括 `report.md`、`results.json`、`logs/`、`repo/.pipeline/`、`repo/docs/`。

- `dsh-home/` 里是会话记录，可以不回传。
- `logs/host-*.log` 第一行有 token，只在本机 loopback 地址上有效；回传前可以删掉那一行。
- 回传前请再看一遍报告和日志，确认没有内部敏感信息。

## 文件

| 文件 | 作用 |
| --- | --- |
| `run.mjs` | 摸底包主程序 |
| `netlog.mjs` | 记录对外连接（通过 `NODE_OPTIONS` 预加载） |
| `laoshi-probe-plugin/` | 探针插件：报告 host 内有哪些服务；在会话下创建子 agent；创建定时消息；按标记文件代为审批 |
| `mock-llm.mjs` | 模拟模型，供 `--self-test` 使用 |
| `dsh-api.mjs` | 手工调用 `/api` 的小工具（首轮摸底时用的） |
| `plugin.log.sample` | 首轮摸底中探针插件的日志样本 |

## 自测记录

2026-10-30，云端 Linux 容器，Node 24.22.2，dsh 0.2.2-alpha.2，模拟模型：

- P01～P12、P14 全部通过。P11b 的结论是"没人作答时一直挂起"，只作记录。
- P13 在自测中只验证流程（模拟模型做不了任务）。
- P12 中子 agent 在 host 重启后**能接着跑**；这一项在首轮摸底时还没有验证。
- P14：整个过程中，除本机和模拟模型外没有任何对外连接。

同一天又在 Node 22.20.0 和 22.22.0 上各跑了一次：结果与 Node 24 相同，P01～P12、P14 全部通过。
