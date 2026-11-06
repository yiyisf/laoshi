# laoshi 作为摸高上的"专家"

- 状态：已定形态（B1）；第 5 节第 1～3 项已实现（[adapters/mogao](../../adapters/mogao/README.md)，假 `aimax` 上的端到端检查通过），第 4～6 项待做。依据是[摸高沙箱摸底](../discovery/mogao/report.md)第一、二、三轮。
- 背景：摸高的数字工程师挑战赛，赛题是在平台中提交 skill 或专家（多个 skill 的组合）。laoshi 本身就是一组 skill（`/laoshi` 入口、手册、方法、原则）加一个确定性的流水线引擎，天然是一个专家。

## 1. 约束（来自摸底）

| 约束 | 对 laoshi 的影响 |
| --- | --- |
| 每个对话轮次一个容器，轮次结束容器就没了；轮内的多次执行共用容器 | 引擎不能跨轮常驻。引擎在对话的一次执行里运行（超过 60 秒转为后台会话，对话轮询）；每一步做完都写回状态，轮次结束时没做完的步骤，下一轮 `laoshi resume` 接着做 |
| 只有 `/data/workspace`、`/data/.aimax` 持久 | 安装根、程序、需求状态放在工作区：`LAOSHI_HOME=/data/workspace/.laoshi`；`$HOME` 不持久，每条命令都要带上这个变量 |
| `aimax run` 能在指定目录同步起一个带完整工具的 agent，返回 JSON；能用 `-s` 续接；能并发 | 步骤 agent 就用它起，和 Paseo、dsh 上一样，每一步是一个新的 agent，评审独立 |
| 审批：`run` 遇到要批准的命令立即返回 `paused`，之后 `resume` / `cancel` | 和 laoshi 现有的"等待批准"对应：引擎停下，把要批准的内容告诉使用者，使用者在对话里回答后续跑 |
| 进度：`--callback-url` 推送工具调用、用量和结束事件 | 引擎在本机起一个接收端，用于危险命令拦截、大目录搜索打断、最近活动和用量统计 |
| 没有定时、没有向对话推送消息的方式 | 进展作为引擎的输出回到对话；"预约开始""自动继续"降级为"告诉使用者下一步说什么" |
| npm 走内网镜像，公网不通 | 第一次使用时从镜像安装 `@yiyi_zhang/laoshi`（固定版本，约 40 秒）；模型用平台的 |
| 沙箱自带的工具少，但可以装在工作区并保留（mvn 已确认可用） | 项目需要的构建工具装在工作区（如 `/data/workspace/.laoshi/tools/`），路径写进项目的验证方法和服务定义；每条命令都要带上这些路径 |

laoshi 现有的设计正好有两块可以直接用：

- **续跑**：引擎每一步的结果都存在 `state.json` 里，重新运行会跳过已完成的步骤（`laoshi resume`）。轮次结束打断了引擎，下一轮接着做即可。
- **平台用词和 skill 渲染**：skill 和提示词里与平台有关的说法都是 `{{platform.<词>}}`，按平台渲染（M2e），加一个平台只需要一份适配器。

## 2. 形态：B1（引擎 + 摸高适配器）

```text
使用者 ──对话──► 摸高对话 agent（加载 laoshi 专家的 skill）
                     │ 执行一条命令（超过 60 秒转为后台会话，对话轮询它的输出）
                     ▼
     laoshi start / resume <需求>         ← laoshi 引擎（状态在工作区）
                     │ 每一步：aimax run --project-dir <仓库> --output json --callback-url <本机> --timeout …
                     ▼
            步骤 agent（新会话，带工具）── paused ──► 引擎停下，告诉使用者要批准什么
                     │                                  使用者回答 → laoshi reply → aimax resume / cancel
                     ▼
            校验结果文件、质量门、写回状态 → 下一步 …… → 需要人决定的点或完成：输出给对话
```

不选 B2（对话 agent 自己做每一步）的原因：`aimax run` 已经能起独立的 agent，用它流程保证更强、评审独立，而且和 Paseo、dsh 共用同一套引擎，不需要 [in-chat-orchestration](in-chat-orchestration.md) 里还没验证的"外包执行"。

形态丙（纯 skill，不带引擎）始终可用：访谈、需求说明、验收标准、如实报告这些方法 skill 不依赖引擎，可以作为专家的最小版本先提交。

## 3. 摸高适配器（`adapters/mogao`）

运行时把 laoshi 的 `AgentRuntime` 映射到 `aimax` 命令行：

| laoshi 需要 | 摸高上怎么做 |
| --- | --- |
| `verifyOrigin`、发起的对话 | `AIMAX_SESSION_ID`；对话的工作目录就是当前目录 |
| `startAgent` | 在后台起 `aimax run --project-dir <目录> --message <提示词> --output json --timeout <步骤时限> --callback-url <本机接收端>`，记下进程和（回调里拿到的）`sessionId` |
| `wait` | 等进程结束，解析 JSON：正常结束 → `idle`；有 `paused` → `permission`（附 `requestId`、标题）；`error` 为超时 → `timeout`；其他 `error` → `error` |
| `followUp` | `aimax run -s <sessionId> --message <文本> …` |
| `interruptAgent` | 结束这个 `aimax run` 进程，再用 `-s` 续接并给出新指令 |
| `attachAgent` | 按 `sessionId` 续接（另一个进程、下一轮也可以） |
| 批准 / 拒绝 | `aimax resume -d /data -s <会话> --request-id <id> --input-json '{"action":"approve"\|"deny"}'`；停止步骤时 `aimax cancel` |
| `recentActivity`、`runningTool`、`toolCalls` | 回调的 `tool_start` / `tool_end`（命令、退出码、输出摘要；**写日志前脱敏**） |
| 用量 | 回调的 `usage`、结果 JSON 的 `usage` |
| `notifyAgent`（进展发回对话） | 能力为 none：进展写进引擎的输出和进度日志，对话 agent 转述 |
| 定时（`scheduleMessage` 等） | none |
| 工作区、服务 | builtin（`git worktree`、`.laoshi/services.json`），和 dsh 一样 |
| 各角色的模型 | 默认用对话的模型；`aimax run` 能否指定模型待确认 |
| 用词 | 平台名"摸高"，会话、工作区、"说'继续'"代替定时提醒 |

## 4. 安装

摸高上没有"安装器"这一步。专家的入口 skill 在第一次使用时：

1. 检查 `/data/workspace/.laoshi/npm` 下有没有约定版本的 `@yiyi_zhang/laoshi`，没有就 `npm install --prefix /data/workspace/.laoshi/npm @yiyi_zhang/laoshi@<版本>`（内网镜像，约 40 秒）。
2. 运行 `laoshi install --platform mogao`：写安装级配置；skill 由平台从专家加载，所以这一步不复制 skill。
3. 之后每条命令都写成 `LAOSHI_HOME=/data/workspace/.laoshi node /data/workspace/.laoshi/npm/node_modules/@yiyi_zhang/laoshi/bin/req.mjs …`（skill 渲染时把这一串换成占位符，使用者看不到）。

专家提交时带上按摸高渲染好的 skill。

## 5. 要做的事

| # | 内容 | 依赖 |
| --- | --- | --- |
| 1 | `adapters/mogao`：运行时（`aimax run` / `resume` / `cancel`、回调接收端）、用词、能力声明、身份（`AIMAX_SESSION_ID`、`AIMAX_USER_NAME`）、安装模块；用一个假的 `aimax` 脚本（按第二、三轮记录的 JSON 和回调格式）做测试 | 无 |
| 2 | 引擎在对话里运行：输出给对话看的进展（没有推送时）；轮次结束被打断后 `resume` 能接上正在做的步骤（用 `sessionId` 续接，而不是重做） | 第 1 项 |
| 3 | 危险命令拦截：把读出、外发平台凭据环境变量的命令列为危险；工具输出写日志前脱敏 | 第 1 项 |
| 4 | 专家的入口 skill：首次安装、启动和继续、转述进展和审批 | 第 1、2 项 |
| 5 | 在摸高沙箱里端到端验证：一个小需求从对齐到可验收（含一次审批、一次轮次中断后续跑），一个 Java 项目（工作区里的 mvn） | 第 4 项，需要使用者在沙箱里配合 |
| 6 | 参赛材料：演示、评估用例结果（隐藏验收、如实率）、说明文档 | 第 5 项 |

## 6. 参赛的亮点

- **不是写代码的助手，而是"把需求做到可验收"的专家**：给测试、产品、项目经理用，每个要拍板的地方都停下来等人。
- **流程由程序保证**：顺序、评审轮次、质量门、危险命令拦截、密钥扫描由引擎执行，不靠模型自觉。
- **用足平台能力**：每一步是平台的一个独立 agent（`aimax run`），审批用平台的 HITL，工具调用和用量来自平台回调，平台插件（知识库等）步骤里也能用。
- **能和平台已有的 skill 组合**：摸高上已有 SDD、PRD、测试用例等场景 skill，可以作为某一步的方法（例如验收用例），体现"多 skill 组合"。
- **跨平台**：同一套流程已经在 Paseo、DeepSeek Harness 上运行，摸高是第三个平台。
- **结果可度量**：评估用例带隐藏验收，`laoshi stats` 统计交付周期、返工、等待和 token。

## 7. 待确认与风险

- **一轮对话最长能持续多久**：引擎在一次执行（后台会话）里运行，对话要一直轮询到需要人决定的点。轮次有总时限时，引擎每做完一步都已写回状态，下一轮 `laoshi resume` 接着做，只是使用者要多说一次"继续"。
- **提示词怎么传给 `aimax run`**：步骤提示词可能较长（几十 KB），要确认 `--message` 之外有没有从文件或标准输入读取的方式；没有时用"读这个文件并照做"的短消息代替。
- **能否按角色指定模型**：`aimax run` 有没有模型参数；没有时所有角色用同一个模型，评审只靠"新会话、不带实现上下文"保持独立。
- **平台凭据在步骤 agent 的环境里**：命令能读到，靠危险命令拦截和日志脱敏降低风险；最好请平台提供不把凭据传给子进程的选项。
- **token**：每次 `aimax run` 约 1.4 万 token 的系统提示、没有缓存命中，一个标准档需求的步骤数乘上去，要在用时和 token 估算里体现。
- **评审在谁的沙箱里试用、能否第一次使用时从内网镜像安装**：决定专家能否依赖 npm 包，否则要把程序随专家一起提交。
