# DeepSeek Harness（dsh）摸底报告

- 对象：`@deepseek-ai/dsh@0.2.2-alpha.2`（源码 `deepseek-ai/deepseek-harness`，提交 `f3803c96`，2026-10-28）
- 日期：2026-10-29
- 环境：Linux 容器，Node 24.22（dsh 要求 Node ≥ 24.9），运行 `dsh --profile web --no-open`
- 格式：沿用[平台摸底清单](../../design/platform-discovery.md)的对照表；设计结论见 [dsh-adapter.md](../../design/dsh-adapter.md) 与 [ADR 0008](../../adr/0008-capability-sources-and-platform-plugin.md)

## 方法与局限

- **没有使用真实模型。** 本机没有 DeepSeek 密钥，用 [`probes/mock-llm.mjs`](probes/mock-llm.mjs) 模拟了一个 OpenAI 兼容端点，按固定脚本应答：调用 bash、申请沙箱升级、慢回合、结束回合。在 profile patch 中把它配置为自定义 provider（配置见文末）。**因此以下结论只说明 harness 本身的行为，不能说明模型的产出质量。**
- 外部调用：[`probes/dsh-api.mjs`](probes/dsh-api.mjs) 直接请求 web host 的 `/api`，与 laoshi 适配器将来的调用方式相同。
- host 内能力：[`probes/laoshi-probe-plugin/`](probes/laoshi-probe-plugin/) 是一个最小插件。它报告 host 中有哪些服务，按策略回答审批请求，并从收件箱目录接收"创建子 agent""创建定时任务"指令。[`plugin.log.sample`](probes/plugin.log.sample) 是它的原始日志。
- 依据只来自源码阅读和上述探针。dsh 是开发者预览版，自己说明会有不兼容的变更。

## 对照表

| 问题 | 答案 | 依据 |
| --- | --- | --- |
| 外部程序能否在用户可见的 host 里创建会话 | 是。`session/create {cwd}` 返回 `sessionId`，会话出现在 web 界面的会话列表里 | 探针 1 |
| 能否下发任务、跑完一个回合，产物落在 `cwd` | 是。`session/prompt` 下发任务后，bash 在会话目录中执行，文件出现在指定目录 | 探针 2 |
| 状态能否查询 | 是。`session/list` 的每一项都有 `running`、`parentSessionId`、`origin`、`cwd`，以及 `projections` 中的 `tokenUsage`、`inbox`、`subagentCatalog`。轮询 `running` 就能实现 `wait`。另有流式事件（WebSocket `remote.mux`） | 探针 1、2 |
| 事件 / 工具调用记录 | 有。`session/page` 返回持久事件：`turn/start`、`turn/end`、`step/*`、`tool/call`、`tool/result`、`usage`、`job/*` | 探针 9 |
| 会话识别（对应 Paseo 的 `PASEO_AGENT_ID`） | agent 的 shell 中有 `DSH_SESSION_ID`、`DSH_WEB_URL`、`DSH_HOME`、`DSH_PROFILE`、`DSH_PROFILE_DIR`、`DSH_SHELL`。**`DSH_WEB_URL` 不带 token** | 探针 2、3 |
| 向会话投递消息、不打断（`notifyAgent`） | 是。运行中用 `session/prompt` 的 `mode: "queue"` 投递，当前回合结束后才处理 | 探针 4、5 |
| 中途插话 | 是。`mode: "steer"` 在当前步骤结束后插入 | 探针 7、8 |
| 打断（`interruptAgent`） | 是。`session/cancel` 立即生效 | 探针 6 |
| 认证 | host 启动时打印带 `?token=` 的地址，用它换取 cookie。cookie 由持久保存的密钥签名，**host 重启后仍然有效**。对所有请求都校验 Host 头（只接受 loopback、绑定地址或 `trustedHosts`），并拒绝跨站请求 | 重启测试；`client/connection/src/api-request-trust.ts`、`browser-auth.ts` |
| 续跑（`attachAgent`） | 是。会话持久保存在 `$DSH_HOME/sessions`，host 重启后列表仍在，再下发任务时会冷恢复。**子 agent 也能在重启后通过 `subagents/prompt` 接着跑**（摸底包自测 P12） | 重启测试；摸底包自测 |
| 沙箱 | 生效（Linux 上用 Landlock，没有 bwrap）。`workspace-write` 模式下写 `/root` 被拒绝，`/tmp` 可以写。工具结果会提示模型可以带 `sandbox_permissions` 和 `justification` 申请升级 | 探针 9、10 |
| 权限请求怎么呈现 | 升级申请走 `approval/request` 事件。默认只有浏览器能回答（通过 WebSocket 转发）。**没有浏览器连接时请求一直挂起**，`session/list` 只显示 `running: true`。host 内部的 `pendingInput` 能区分出"在等审批"，但列表接口不返回它 | 探针 11 |
| 插件能否代为审批 | 是。插件用 `{ prepend: true }` 注册 `approval/request` 监听，可以返回 `allowed-once`，或调用 `next()` 交给下一个应答者（例如浏览器）。不加 prepend 时，转发给浏览器的应答者先接住，插件拿不到请求 | 探针 12、13 |
| 插件能否在对话下创建子 agent | 是。调用 `ctx.subagents.startActivation({ provider: "spawn", label, request: { prompt, parent, cwd }, delivery: "caller" })`：子会话的 `origin` 为 `subagent`，挂在父会话下，**带着标签出现在父会话的子 agent 列表里**；`cwd` 按请求生效；结果只返回给调用方，不注入父会话 | 探针 14 |
| 外部能否追问子 agent | 是。`subagents/prompt`，`mode: "continuable"`，`delivery: "queue"` 或 `"steer"` | 探针 15 |
| 外部能否创建子 agent | 否。`/api` 中 `subagents` 只有 `prompt` 和 `interruptByParent` | 源码 `subagent/subagent/src/index.ts` |
| 定时任务 | 插件可以。`ctx.schedule.create(sessionId, { title, prompt, after_seconds | at | every_seconds | daily | weekly | cron })`，到点以新回合送进原会话（预定 02:54:47，实际 02:54:47 送达）。**外部 `/api` 只能查看、更新和删除，不能创建** | 探针 14；`schedule/schedule` |
| 默认子 agent 提供方 | `spawn`、`fork`（都在同一进程内）。ACP、Codex、Claude Code、dsh SDK 提供方都有包，但默认 profile 没有挂载 | plugin.log.sample |
| worktree | 有实验包 `dsh-experimental-worktree`（`ctx.worktrees.create` 会建分支和检出目录，并把会话的工作目录切过去），默认没有挂载 | plugin.log.sample；包 README |
| 后台任务 / 服务 | 已挂载 `ctx.jobs`：任务属于启动它的会话，完成时以会话内通知送达。没有 `paseo.json` 那样的"服务定义 + 端口 + 健康检查" | plugin.log.sample；`jobs` README |
| skill 目录 | 按优先级依次为 `<项目>/.dsh/skills`、`<项目>/.agents/skills`、`customSkillDirs`、`$DSH_HOME/skills`、`<agentsHome>/skills`。req-kit 现在安装到的 `~/.agents/skills` 能直接被读到；`customSkillDirs` 可以指向安装根（ADR 0007） | `docs/subsystems/skills.zh.md` |
| 用量 | 每个会话的 `tokenUsage`：未缓存输入、输出、缓存读取、缓存写入 | 探针 1 |
| 数据外传 | `dsh-session-log-deepseek` 默认挂载：调用 DeepSeek 官方 API 时，请求里附带增量会话日志。使用其他 provider 时不涉及；laoshi 在内网通过自定义 provider 接入模型，不受影响 | 包 README |
| 对外连接 | 用 `netlog.mjs` 记录 web host 及其子进程的所有 DNS 解析和连接：启动、跑一个回合、空闲 60 秒，以及摸底包自测全程，除本机和模型端点外**没有任何对外连接**。浏览器界面触发的功能还没有覆盖到 | 摸底包自测 P14 |
| 运行要求 | 声明要求 Node ≥ 24.9。在 Node 22.20、22.22 上，摸底包自测的全部探针都能通过（npm 安装时只有 EBADENGINE 警告）。`npm install` 后 `node_modules` 约 930 MB | 安装；摸底包自测 |

## 探针清单

各探针都在一个空的 git 仓库目录中运行，向同一个会话依次发送：

| 编号 | 做了什么 | 观察到 |
| --- | --- | --- |
| 1 | `session/create`，再发送一句普通任务 | 返回会话 ID；回合结束，`running` 变为 `false` |
| 2 | `BASH: env … > dsh-env.txt; echo ok > hello.txt` | 两个文件都出现在会话目录；列出了 `DSH_*` 变量 |
| 3 | 记录 `$DSH_WEB_URL`（token 已打码） | 值为 `http://127.0.0.1:3080`，不带 token |
| 4、5 | 先发一个慢回合，运行中再用 queue 模式发一条 | 第二条在第一条结束后处理，没有打断 |
| 6 | 发慢回合后调用 `session/cancel` | 立即回到空闲 |
| 7、8 | 发慢回合后用 steer 模式发一条 | 插入到下一个步骤 |
| 9 | 写 `/tmp` 下工作区外的文件 | 允许（沙箱默认放开 `/tmp`） |
| 10 | 写 `/root` 下的文件 | 被 Landlock 拒绝，提示可以申请升级 |
| 11 | 模拟模型带 `sandbox_permissions` 申请升级，没有浏览器连接 | 一直挂起；列表上只显示 `running: true`；之后用 cancel 结束 |
| 12 | 插件注册审批监听（不加 prepend） | 插件没有收到请求 |
| 13 | 插件加 `{ prepend: true }`，存在允许标记文件时批准 | 插件收到请求（附带工具名、理由、会话 ID）并批准，命令执行。产生的测试文件已删除 |
| 14 | 插件收到指令：在这个会话下创建子 agent；创建一个 45 秒后触发的定时任务 | 子 agent 带标签挂在会话下，文件写在指定目录，结果只返回插件；定时消息准时以新回合送达 |
| 15 | 外部调用 `subagents/prompt` 追问子 agent | 子 agent 执行了追问中的命令 |
| 重启 | 停止并重新启动 host | 会话还在；旧 cookie 仍然有效；新 token 会重新打印 |

## 复现

最简单的方式是用[内网摸底包](probes/README.md)：`node run.mjs --self-test` 用模拟模型跑完全部探针。下面是首轮摸底时的手工步骤。

```sh
# Node ≥ 24.9；DSH_HOME 指向一个临时目录，不污染本机配置
export DSH_HOME=$PWD/dsh-home DSH_TELEMETRY_DISABLED=1 MOCK_API_KEY=mock
npm install @deepseek-ai/dsh@0.2.2-alpha.2
node probes/mock-llm.mjs 4010 mock-llm.log &          # 模拟模型
# 在 $DSH_HOME/profiles/web/cordis.patch.yml 中写入下面的配置
npx dsh plugin --profile web add file:$PWD/probes/laoshi-probe-plugin
npx dsh --profile web --no-open --port 3080 > web.log 2>&1 &
node probes/dsh-api.mjs web.log session/create '{"request":{"cwd":"/path/to/empty-repo"}}'
```

```yaml
- id: llm-pi-ai
  config:
    providers:
      mock:
        apiKeyEnv: MOCK_API_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:4010/v1
        compat:
          supportsDeveloperRole: false
          maxTokensField: max_tokens
        models:
          - id: mock-1
- id: agent-default-model
  config:
    provider: mock
    model: mock-1
- insert:
    - id: laoshi-probe
      name: 'laoshi-probe'
      config:
        log: /path/to/plugin.log
        inbox: /path/to/inbox
        allowFile: /path/to/ALLOW
```

## 内网摸底包

laoshi 在内网使用，模型和 Paseo 上 req-kit 用的相同。上面这些结论还需要在内网用真实模型复核一遍，为此把本次的探针整理成了一条命令就能运行的[内网摸底包](probes/README.md)：P01～P14，生成 `report.md`。摸底包已在云端用模拟模型自测通过。

## 尚未验证

1. 内网真实模型（与 req-kit 相同）配合 dsh 的效果：模型网关的兼容设置，以及步骤任务能否按结果文件约定完成（内网摸底包 P02、P13）；之后再跑 `evals/` 端到端用例。
2. 挂载 ACP、Claude Code、Codex 子 agent 提供方以后，builder 和 reviewer 能否使用不同的模型或 harness。
3. 同一个 host 上同时跑多条流水线时，子 agent 的并发与委派深度上限（`subagents` 的 `maxDepth` 默认为 1）的实际影响。
4. 启用 `dsh-experimental-worktree` 以后，worktree 能否满足 `--worktree` 和联合需求。
5. 插件和引擎之间的正式通道（探针用的是文件收件箱，正式实现建议用 unix socket），以及插件如何把一个限定权限的凭据交给引擎。
6. Windows（内网是 Windows，限制使用 PowerShell）：dsh 在 Windows 上默认用 PowerShell 执行命令，需要改用 Git Bash，这不是 dsh 官方覆盖的组合。摸底包默认就按这种方式配置（`run.cmd`，`LAOSHI_PROBE_WIN_SHELL=bash`），但还没有在 Windows 上实际跑过。此外 macOS 和桌面版（`apps/desktop`）也还没有验证。
