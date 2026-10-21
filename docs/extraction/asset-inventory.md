# laoshi 资产清单：req-kit 的"核心 / 能力契约 / 平台绑定"

基于 `yiyisf/paseo-req-kit` 1.13.0（commit `4bdb338`，320 个文件，engine/src 约 15.4k 行）。

**这里的"平台"指 Paseo 这类 agent 编排平台**（不是操作系统，也不是 Claude Code / Codex 这类编码 agent）。req-kit 其实有两条轴，分开看很重要：

- **编码 agent 轴**（Claude Code、Codex、OpenCode、Pi）：安装脚本和 skill 已经基本跨 agent（`~/.agents/skills`、`~/.claude/skills`，见 ADR 0006）。
- **编排平台轴**（Paseo）：创建/等待/打断 agent、定时任务、worktree、受管服务、用量、插件界面。**laoshi 要解耦的是这一条。**

> 可信度说明：下面"接口层"和"契约/ADR"部分是我直接读过的；各 `.ts` 文件的归类主要依据文件职责和 "Paseo" 出现次数，**没有逐行读完**（尤其 pipeline.ts 2378 行）。标了"待核对"的是需要进一步确认的点。

---

## 0. 最重要的发现

1. **接口层已经存在。** `engine/src/runtime.ts` 定义了 `AgentRuntime`，真实实现只有 `paseo-runtime.ts`（491 行），测试用 `REQ_PIPELINE_FAKE_RUNTIME` 注入假实现，`runtime-loader.ts` 负责加载。engine/src 里所有对运行时的调用都经过这个接口，一共 21 个方法（含 `close`）；其中 pipeline.ts 自己只用 11 个（`startAgent`、`attachAgent`、`notifyAgent`、`interruptAgent`、`scheduleMessage`、`listServices`/`startServices`/`stopServices`、`providerQuota`、`runningTool`、`capabilities`），其余在 launch / control / doctor / factory 等入口里。耦合面是清楚、可枚举的。
2. **接口里已经有"可选能力"的写法。** 多数增强方法在不支持时返回 `null`（服务、用量、活动、定时、工作区等），调用方有降级分支。这正是能力契约的雏形。
3. **直接 Paseo 绑定的文件只占一小部分**：`paseo-runtime`、`paseo-profiles`、`paseo-json`、`daemon-check`、`daemon-version`、`runtime-loader` 共约 884 行（约 5.7%）；加上部分耦合的 `doctor.ts`（494）、`configure.ts`（362）约 11%。
4. **真正的难点不在代码，在三个"形状"假设**（见第 4 节）：引擎是**外部进程**经 SDK 驱动 agent；"以后再做"全靠 Paseo 定时任务把消息发回**发起对话**；用户界面文案和状态文件里写死了 Paseo 概念。

---

## 1. 核心（平台无关，可直接进入 laoshi core）

### 1.1 文件契约（`contracts/`，9 个文件）
| 文件 | 说明 | 需要改的地方 |
| --- | --- | --- |
| `spec.md`、`result-file.md`、`feature-files.md`、`verify.md` | spec 格式、步骤结果 JSON、功能目录文件、验证说明 | 无 |
| `state.md` | 运行状态 | 含 Paseo 命名字段，见 4.2 |
| `cli-json.md`、`notifier-event.md`、`usage-record.md` | `req api` 输出、通知事件、用量记录 | 各有 2~4 处 Paseo 字样，待核对是否只是措辞 |
| `README.md` | 格式版本与迁移规则（已有 `STATE_MIGRATIONS` 机制） | 无，可直接复用 |

### 1.2 方法类 skill（几乎不含 Paseo）
- `acceptance-criteria`、`spec-writing`（含模板）、`requirement-interview`、`requirement-kickoff`、`result-report`、`req-retro`
- 7 个原则：`principle-delete-before-add`、`dont-block-on-humans`、`fix-root-cause`、`prove-it-works`、`report-honestly`、`speak-to-reader`、`this-requirement-only`，以及 `principles/INDEX.md`
- 手册（`skills/req/playbooks/`）：`accept`、`change`、`incident`、`small`、`unattended` 为 0 处 Paseo；`new`、`status`、`takeover`、`verify` 各有 1~2 处

### 1.3 步骤提示词（`engine/prompts/`）
00 共享上下文、02 spec 评审、03/03a/04/04b 设计与评审与修订、05 实现、06 代码评审、07 评审修复、09 验证、10/10b 缺陷修复与复验、11 报告、`incremental`、`panel-member`、`review-axis-*`、`related-repos`、`ui-check`、`types/*`。
有 Paseo 字样、需要中性化的：`07b-handoff`（2）、`08-service-start`（1）、`09-verify`（1）、`browser-verify`（2）、`joint`（1）、`paseo-services`（5，整份属于平台能力）。

### 1.4 编排与业务逻辑（`engine/src/`，按职责初判）
流程与状态：`pipeline.ts`（待核对：2378 行，含 37 处 Paseo 字样）、`steps.ts`、`state.ts`、`gate.ts`、`records.ts`、`features.ts`、`playbooks.ts`、`prompts.ts`、`lessons.ts`、`scan-guard.ts`、`spec-review.ts`、`estimate.ts`、`queue.ts`（本机并发名额，不依赖平台）、`git.ts`、`paths.ts`、`locations.ts`、`schedule-time.ts`
统计与对外：`stats.ts`、`usage.ts`、`digest.ts`、`api.ts`、`index-cmd.ts`
集成：`integrations.ts`、`integration-cmd.ts`（本地 CLI 驱动，如 shenbing alm-card）、`card.ts`、`card-cmd.ts`、`notifiers.ts`、`notify-test.ts`、`notifiers/im-template.mjs`
评审与界面检查：`review.ts` + `review-assets/`（原型审查页）、`ui-check.ts` + `ui-check-page.js`
命令入口：`main.ts`、`cli-args.ts`、`control.ts`、`launch.ts`（二者含"连 Paseo / 预约 / 新建工作区"逻辑，需要拆）
配置：`config.ts`（含 `AgentProfile`，见 3.3）

### 1.5 质量保障资产
- `engine/test/*`：用 `fake-runtime.ts` 跑真实编排逻辑。**这套假运行时就是 laoshi 一致性测试（conformance）的种子。**
- `evals/`：端到端评估（隐藏验收测试 + "夸大"指标）、对话评估。换平台后可以原样当验收标准。
- `docs/adr/`（33 篇）：多数是产品/流程决策，可沿用；与平台相关的见 3.6。

---

## 2. 能力契约（`AgentRuntime` 的方法如何变成 laoshi 能力）

| laoshi 能力 | 现有方法 | 级别 | 无该能力时的降级（建议） |
| --- | --- | --- | --- |
| 创建步骤 agent（挂在发起会话下、指定目录、标签） | `startAgent`、`verifyOrigin` | **必需** | 无子 agent 机制 → 串行单 agent，靠文件交接并重置上下文 |
| 等待/追问/归档 | `StepAgent.wait`、`followUp`、`archive`、`attachAgent` | **必需** | — |
| 向运行中的会话发消息 / 打断 | `notifyAgent`、`interruptAgent` | **必需** | 退化为只写通知文件 |
| 开启需求自己的会话 | `startSessionAgent` | 可选 | 由用户手动开会话 |
| 以后再做（定时发消息/起 agent、取消） | `scheduleMessage`、`scheduleNewAgent`、`cancelSchedule` | 可选 | 引擎本机定时器/系统 cron；或提示用户到时手动执行 |
| 新建隔离工作区 | `createWorktree`、`waitForWorkspaceSetup` | 可选 | 直接用 `git worktree` |
| 受管服务（独立端口、健康检查） | `listServices`、`startServices`、`stopServices` | 可选 | 用 `verify.md` 里的手工启动命令（现已保留） |
| 用量/额度 | `providerQuota`、`usage` 字段 | 可选 | 只统计 token，不提醒额度 |
| 实时活动/当前工具 | `recentActivity`、`runningTool` | 可选 | 不显示、不做"搜大目录"打断 |
| 能力探测/提供方状态 | `capabilities`、`providerStatus` | 可选 | 假定可用，失败再报 |
| 档案（profile）解析 | `listPaseoProfiles` | 可选 | 只用 `provider/model` 直接配置 |

建议：把"必需 / 可选 / 增强"写进契约文档，并让 `laoshi doctor` 按它输出能力矩阵。

---

## 3. 平台绑定（只属于 Paseo 适配器）

### 3.1 代码
`paseo-runtime.ts`（491）、`paseo-profiles.ts`（135）、`paseo-json.ts`（73）、`daemon-check.ts`（105）、`daemon-version.ts`（66）、`runtime-loader.ts`（14）；`doctor.ts`、`configure.ts`、`smoke-test.ts`、`factory.ts` 中的"连 daemon / 检查 profile / 提供方登录状态"部分（需要拆成"通用体检 + 适配器体检"）。

### 3.2 依赖与版本
`@getpaseo/client`；经 `internal/daemon-client` 调用工作区脚本与定时任务（ADR 0017、0020，已逐处做了不可用时的降级）；`package.json` 的 `reqKit.paseo: >=0.11.0 <0.12.0`。

### 3.3 配置里的平台概念
`AgentProfile.paseoProfile`；`provider/model` 字符串约定（`claude/...`、`pi/anthropic/...`）；`modeId`、`thinkingOptionId`、`featureValues`；`config.daemonPasswordEnv`。内网自建 agent 平台需要自己的 profile 形状，建议把 `AgentProfile` 拆成"通用字段 + 适配器私有字段"。

### 3.4 环境变量与会话识别
`PASEO_AGENT_ID`、`PASEO_AGENT_CWD`（`skills/req/SKILL.md` 靠它识别当前对话）、`PASEO_DAEMON_PASSWORD`、`PASEO_PORT`。

### 3.5 项目接入物
`paseo.json` 生成逻辑（`skills/req-setup` 有 14 处）、`skills/req-setup/templates/paseo/`（`with-port.mjs`、`copy-local-files.mjs`）、`skills/req-doctor`（3 处）。

### 3.6 界面插件与文档
- `paseo-plugin/`（27 个文件）：通过 `req api`（`cli-json.md`）读数据，是个干净的"展示适配器"，换平台要重写，但**数据契约可以复用**。
- 以 Paseo 为前提的 ADR：0001（步骤挂在发起会话下）、0003（脚本引擎而非 Hub）、0017、0018（自带 worktree）、0020（定时消息回对话）、0027（插件）。
- `legacy/hub-workflow/`：旧 Hub 版本，不用迁移。
- `site/`、`docs/guide/`、`install.*`、`vercel.json`：品牌、安装与站点内容需要按 laoshi 重写。

---

## 4. 抽取时的坑（比代码更需要先想清楚）

### 4.1 引擎是"外部进程驱动 agent"
ADR 0003 决定用确定性引擎经 SDK 创建 agent。这要求平台有**程序化的 agent API**。内网自建平台如果只有"skill + 会话内子 agent 工具"，就没法照搬。建议 laoshi 支持两种编排模式：
- **模式 A（外部引擎）**：现状。需要适配器实现必需能力。
- **模式 B（会话内编排）**：由会话里的 agent 按 skill 逐步调用 `laoshi next / record / gate` 这类确定性命令，用平台自带的子 agent 工具执行步骤。流程顺序和状态仍由 laoshi CLI 保证。

"自己长出来"最适合发生在这里：`laoshi-init` 探测平台属于哪种，再生成对应的适配文件。

### 4.2 状态文件里有 Paseo 命名
`worktree.workspaceId`、`schedules[]`（Paseo 定时任务 ID）、`originAgentId`、`history[].agent` 的 profile 名。需要中性化（如 `workspaceRef`、`wakeups`、`originSessionId`），并用现成的 `STATE_MIGRATIONS` 做 v1→v2 迁移。

### 4.3 "以后再做"全靠平台
预约开始、等待提醒、限流后自动继续、定时检查，现在都是"Paseo 定时任务把消息发回发起对话"（ADR 0020）。laoshi 需要一个 `wakeup` 抽象，并给出无平台调度时的退路（本机定时器或让用户手动继续）。

### 4.4 用户可见文案写死了 Paseo
`messages.ts`、`launch.ts`、`control.ts` 以及若干提示词里直接写"在 Paseo 的 Schedules / 侧边栏 / 子 agent 列表里……"。建议做一张"平台词汇表"（会话、子 agent 列表、定时任务入口、需求页入口），文案从适配器取。

### 4.5 命名与兼容
现有命令 `req`、`req-kit`、`paseo-req-kit`、`/req`、`/req-setup`。建议 laoshi 保留 `req` 作别名，`paseo-req-kit` 作为"laoshi + Paseo 适配器"的薄分发包，已安装的用户不用迁移。

---

## 5. 建议的下一步（对应前面的落地顺序）

1. **先加 `AgentRuntime` 的契约文档**：把第 2 节的表正式化，并给每个可选能力写明降级行为。
2. **拆 `launch.ts` / `doctor.ts` / `configure.ts`**：把"连 Paseo"的部分挪进适配器，核心只依赖 `AgentRuntime`。
3. **状态 v2 迁移**：中性化第 4.2 节的字段。
4. **平台词汇表**：先收敛 `messages.ts` 和 `launch.ts` 的 Paseo 文案。
5. **第二个适配器验证契约**：优先 bb-app，或你们内网 agent 平台；用 `fake-runtime` 和 `evals/` 做一致性验收。
6. 之后再做 `laoshi-init`（探测 + 生成适配器 + `doctor` 自检）和模式 B。

> 以上均未改动任何仓库文件；仓库在本会话里只读克隆，没有推送。
