# dsh 内网摸底包

一条命令跑完 [dsh 摸底](../report.md) 的全部探针，使用的是**内网真实模型**（和 Paseo 上 req-kit 用的是同一个模型），最后生成 `report.md`。结果用于确认 [dsh 适配设计](../../../design/dsh-adapter.md) 在内网成立。

- 平台：**Windows**、Linux、macOS。Windows 上用 `run.cmd` 启动。
- 用时：约 20～60 分钟。其中 P13 是三个模型任务，每个最多 15 分钟。
- 云端自测情况见[自测记录](#自测记录)。

## 需要内网配合设置一次

### 1. 环境

| 需要 | 说明 |
| --- | --- |
| Node.js 24（推荐），或 22.19 以上 | dsh 声明要求 ≥ 24.9。但自测时 Node 22.20 和 22.22 下全部探针都能通过，所以 22.19 以上也可以运行，报告的 P01 会标为 info。低于 22.19 时摸底包会停止 |
| Git（Windows 上为 Git for Windows） | 摸底包会建一个小样例仓库；`git` 需要在 PATH 中 |
| 内网 npm 镜像能安装 `@deepseek-ai/dsh@0.2.2-alpha.2` | 会装上约 650 个包，占用约 750～950 MB |
| Git Bash（仅 Windows） | dsh 在 Windows 上默认通过 PowerShell 执行模型的命令。内网禁止运行 PowerShell，所以摸底包默认把 dsh 改成用 Git Bash（Git for Windows 自带，见下文"Windows 上的 shell"）。摸底包会根据 `git.exe` 的位置自动找到 `bash.exe`，不需要把它加进 PATH |
| pnpm（可选） | 有 pnpm 时用 `dsh plugin add` 安装探针插件；没有时直接复制，也能用 |

### 2. 环境变量

凭据只通过环境变量读取，不会写进任何文件；报告里的网关地址会打码。

| 变量 | 必填 | 含义 |
| --- | --- | --- |
| `LAOSHI_PROBE_MODEL_BASE_URL` | 是 | 模型网关地址，和 Paseo 上 req-kit 当前使用的是同一个。OpenAI 兼容网关一般以 `/v1` 结尾，例如 `http://llm-gateway.example.internal/v1` |
| `LAOSHI_PROBE_MODEL_ID` | 是 | 模型 ID，和 req-kit 当前使用的相同 |
| `LAOSHI_PROBE_MODEL_API_KEY` | 是 | 访问网关的凭据 |
| `LAOSHI_PROBE_MODEL_API` | 否 | 网关协议：`openai-completions`（默认）、`openai-responses`、`anthropic-messages` |
| `LAOSHI_PROBE_WIN_SHELL` | 否 | 仅 Windows：dsh 给模型用的 shell。默认 `bash`（Git Bash）。`pwsh` 是 dsh 的原生默认（PowerShell），内网禁止 PowerShell，**不要设置** |
| `LAOSHI_PROBE_NPM_REGISTRY` | 否 | 内网 npm 镜像地址。只有 `run.cmd` 自动安装 dsh 时会用到 |
| `LAOSHI_PROBE_DSH` | 否 | 已经装好 dsh 的目录（其下有 `node_modules\@deepseek-ai\dsh`）。不设时依次查找：当前目录、本目录、npm 全局目录 |

**Windows 上设置一次、长期有效**（在"命令提示符"里执行；设置后要**新开**一个窗口才能生效）：

```bat
setx LAOSHI_PROBE_MODEL_BASE_URL "http://<模型网关>/v1"
setx LAOSHI_PROBE_MODEL_ID "<模型 ID>"
setx LAOSHI_PROBE_MODEL_API_KEY "<凭据>"
setx LAOSHI_PROBE_NPM_REGISTRY "http://<内网 npm 镜像>/"
```

`setx` 会把变量保存在当前 Windows 用户的环境变量中。不想长期保存凭据的话，可以只在当前窗口里设置：命令提示符用 `set LAOSHI_PROBE_MODEL_API_KEY=<凭据>`，PowerShell 用 `$env:LAOSHI_PROBE_MODEL_API_KEY = '<凭据>'`。

## 运行

### Windows

1. 把压缩包解压到一个**路径里没有空格**的目录，例如 `C:\laoshi-dsh-probe`。不要放在共享盘上。
2. 在这个目录里打开"命令提示符"，执行：

```bat
run.cmd --self-test
run.cmd
```

- `run.cmd --self-test`：第一次运行时会先安装 dsh，然后用模拟模型验证摸底包在这台机器上能跑。约 3 分钟（不含安装），不消耗模型用量。
- `run.cmd`：正式运行，使用上面设置的模型网关。

`run.cmd` 会先检查 `node` 和 `git`；如果本目录下还没有 dsh，就用 `LAOSHI_PROBE_NPM_REGISTRY` 指定的镜像安装（带 `--engine-strict=false`，所以 Node 22 也能装上）。其余参数原样传给 `run.mjs`。整个过程不调用 PowerShell。

也可以在 Git Bash 窗口里运行：

```sh
cd /c/laoshi-dsh-probe
npm install @deepseek-ai/dsh@0.2.2-alpha.2 --engine-strict=false --registry=<内网 npm 镜像>
node run.mjs --self-test
node run.mjs
```

### Windows 上的 shell

dsh 在 Windows 上默认让模型通过 PowerShell 执行命令。内网禁止运行 PowerShell，所以摸底包默认（`LAOSHI_PROBE_WIN_SHELL=bash`）在 dsh 的配置里做三处改动：

- 关掉 PowerShell 执行器；
- 打开 bash 执行器：命令以 `bash -c` 的形式在 Windows 沙箱里运行；
- 打开 bash 工具。

模型会同时看到 `bash` 和 `pwsh` 两个工具，但两者背后都是 Git Bash，不会调用 PowerShell。

需要注意：

- **这不是 dsh 官方覆盖的组合。** dsh 在 Windows 上默认不开 bash，这次摸底就是要确认它能不能用。
- Windows 查找 `bash` 时，会先查 `C:\Windows\System32` 再查 PATH。如果机器装了 WSL，`System32` 下会有一个 `bash.exe`，dsh 可能会启动 WSL 而不是 Git Bash。摸底包检测到这种情况时，P01w 会标为 fail。
- 内网禁止运行 PowerShell，所以**摸底包从不启动 PowerShell**，也不会去测试它能不能运行，以免触发安全告警。

dsh 除了 shell 工具外，还有几处会调用 `powershell.exe`：

| 位置 | 什么时候触发 | 摸底包的处理 |
| --- | --- | --- |
| 默认工作区：查询"文档"目录 | 网页界面初始化默认工作区时 | 在配置里直接指定目录（`workspace-controller.documentsDirectory`），不再调用 PowerShell |
| 网页终端：可选的 shell | 在网页界面里新开终端时 | 在配置里把可选的 shell 限定为 `bash` 和 `cmd` |
| "在其他应用中打开"：读取应用图标 | 在网页界面里打开这个菜单时 | 没法通过配置关掉；摸底不需要打开网页界面，用不到 |
| "用其他应用打开"文件：查询文件关联 | 在网页界面里使用这个功能时 | 同上 |

摸底全程只通过接口操作 dsh，不需要打开网页界面。如果中途在浏览器里打开了 dsh 的网页界面，后两项可能会尝试启动 PowerShell 并失败，不影响摸底结果。

### Linux、macOS

```sh
cd laoshi-dsh-probe
npm install @deepseek-ai/dsh@0.2.2-alpha.2 --engine-strict=false --registry=<内网 npm 镜像>
node run.mjs --self-test
export LAOSHI_PROBE_MODEL_BASE_URL=... LAOSHI_PROBE_MODEL_ID=... LAOSHI_PROBE_MODEL_API_KEY=...
node run.mjs
```

### 运行期间会发生什么

每次运行都会在本目录下新建一个 `dsh-probe-<时间>` 目录，所有东西都放在里面：独立的 `DSH_HOME`（不影响本机已有的 dsh 配置）、样例仓库、日志、报告。另外：

- 会在本机启动一个 dsh web host，只监听 `127.0.0.1` 的随机端口；结束时停止（Windows 上用 `taskkill` 停止整棵进程树）。
- 为了测试审批，会在用户目录（Windows 上是 `%USERPROFILE%`）下临时建一个 `.laoshi-probe-outside-<时间>` 目录，结束时删除。
- 用 `netlog.mjs` 记录 dsh 进程发起的每一次 DNS 解析和连接。只做记录，不拦截任何连接。
- Windows 防火墙如果询问是否允许 Node.js 访问网络，选"取消"也不影响：dsh 只监听本机地址。

可选参数：`--out <目录>` 指定输出目录；`--task-timeout <分钟>` 设置 P13 每个任务的超时，默认 15。

## 探针

| 编号 | 内容 |
| --- | --- |
| P01 | 平台，Node、dsh、pnpm 的版本，安装占用的空间 |
| P01w | 仅 Windows：探针用的 shell（Git Bash 的位置），以及有没有 WSL 的 `bash.exe`。不启动 PowerShell |
| P02 | 模型接入：依次尝试几组兼容设置（`supportsDeveloperRole`、`maxTokensField`），记下第一组能用的 |
| P03 | 工具调用（模型实际调用的工具名，以及 shell 版本）、产物落在会话目录、`DSH_*` 环境变量（用于识别发起的对话） |
| P04 | 会话状态与 token 用量 |
| P05 | 用 `session/cancel` 打断一个正在运行的回合 |
| P06 | 回合运行中投递消息（queue），确认不打断当前回合 |
| P07 | 回合运行中插话（steer） |
| P08 | 由插件在会话下创建子 agent：带标签、显示在会话的子 agent 列表里、产物写在指定目录 |
| P09 | 从外部追问子 agent |
| P10 | 由插件创建定时消息，到点送进会话 |
| P11 | 审批：由插件代为批准；以及没人作答时会怎样（Windows 上的沙箱是系统 ACL 受限令牌，由 dsh 自动选用，不需要配置） |
| P12 | host 重启后：会话是否还在、旧 cookie 是否有效、主会话和子 agent 能否接着跑 |
| P13 | 模型按 req-kit 结果文件约定完成三个步骤：方案设计、代码实现、代码评审 |
| P14 | 对外连接：除本机和模型网关外，dsh 有没有尝试连接其他地址 |

## 回传

请把 `dsh-probe-<时间>` 目录打包回传，包括 `report.md`、`results.json`、`logs/`、`repo/.pipeline/`、`repo/docs/`。

- `dsh-home/` 里是会话记录，可以不回传。
- `logs/host-*.log` 第一行有 token，只在本机 loopback 地址上有效；回传前可以删掉那一行。
- 回传前请再看一遍报告和日志，确认没有内部敏感信息。

## 文件

| 文件 | 作用 |
| --- | --- |
| `run.cmd` | Windows 启动脚本：检查环境，按需安装 dsh，再运行 `run.mjs` |
| `run.mjs` | 摸底包主程序，三个平台通用 |
| `netlog.mjs` | 记录对外连接（通过 `NODE_OPTIONS` 预加载） |
| `laoshi-probe-plugin/` | 探针插件：报告 host 内有哪些服务；在会话下创建子 agent；创建定时消息；按标记文件代为审批 |
| `mock-llm.mjs` | 模拟模型，供 `--self-test` 使用；按 dsh 提供的工具调用 `bash` 或 `pwsh` |
| `package.json` | 让 dsh 安装在本目录的 `node_modules` 中 |
| `dsh-api.mjs` | 手工调用 `/api` 的小工具（首轮摸底时用的） |
| `plugin.log.sample` | 首轮摸底中探针插件的日志样本 |

## 自测记录

在云端 Linux 容器上用模拟模型自测，dsh 0.2.2-alpha.2：

- **Node 24.22、22.20、22.22**：P01～P12、P14 全部通过。P11b 的结论是"没人作答时一直挂起"，只作记录；P13 在自测中只验证流程（模拟模型做不了任务）。
- P12：子 agent 在 host 重启后**能接着跑**。
- P14：整个过程中，除本机和模拟模型外没有任何对外连接。
- **Windows 还没有实际跑过。** 摸底包里与平台相关的部分都已按 Windows 写好：用 `node` 直接启动 dsh 的入口脚本，不经 `.cmd`；用 `taskkill` 停止进程树；用 JS 统计安装大小；默认把 dsh 切换到 Git Bash，也保留了 PowerShell 写法（`LAOSHI_PROBE_WIN_SHELL=pwsh`）。"在 Windows 上让 dsh 改用 Git Bash"是对照 dsh 源码得出的做法（bash 执行器通过 Windows 沙箱启动 `bash -c`），没有实际验证过。所以内网第一次请先跑 `run.cmd --self-test`：它不消耗模型用量，但 P03～P12 会真实地在 Git Bash 里执行命令，正好验证这一点。如果出错，把 `dsh-probe-<时间>\logs\` 和屏幕输出发回来，我来修。
