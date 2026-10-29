# 0008 能力按来源分层，平台插件作为适配器的一部分

- 状态：提议
- 日期：2026-10-29
- 关联：[ADR 0002](0002-two-orchestration-modes.md)、[ADR 0003](0003-generate-once-then-lock.md)、[ADR 0006](0006-deterministic-engine-platform-capabilities.md)、[ADR 0007](0007-one-install-many-repos.md)
- 详见：[dsh-adapter.md](../design/dsh-adapter.md)、[dsh 摸底报告](../discovery/dsh/report.md)

## 背景

现有的能力契约（[agent-runtime.md](../../contracts/agent-runtime.md)）是从 Paseo 的接口逐个方法整理出来的，只区分"有"和"没有"，没有的能力一律降级为 `null`。

用 DeepSeek Harness（dsh）检验时发现，"没有"其实分好几种情况：

- 平台有这项能力，但外部 API 调不到，host 内的插件可以调到。例如 dsh 在对话下创建子 agent、创建定时任务、回答审批。
- 平台根本没有这项能力，但 laoshi 可以自己实现，而且这份实现适用于所有平台。例如服务管理、`git worktree`、本机调度。
- 确实做不到。例如订阅额度。

如果把前两种都当成"没有"来降级，dsh 上就达不到 Paseo 的体验；如果让每个适配器各自去补，同一份实现会被重复写好几遍。

另外，Paseo 的审批由人在 Paseo 界面里完成，引擎只负责轮询。而 dsh（以及内部平台的 HITL，见 [internal-platform-adapter §4](../design/internal-platform-adapter.md)）需要有一方主动作答。现有契约里没有"作答"这项能力。

## 决定

1. **每项能力标明来源**，按以下顺序选用：
   - `platform`：平台原生提供；
   - `plugin`：laoshi 为该平台写的插件，运行在平台进程内；
   - `builtin`：laoshi 内置实现，与平台无关；
   - `none`：降级，行为同契约中的"现状"一栏。

   运行时层负责按这个顺序选择，调用点不再各写各的降级。`laoshi doctor` 的能力矩阵显示每项能力实际使用的来源。"和 Paseo 一样的体验"的判断标准是：矩阵中除了契约允许缺失的项以外，没有 `none`。

2. **平台插件是适配器的正式组成部分。** 适配器由运行时、对话通道、词汇表、体检组成，平台允许时再加一个插件。插件只提供能力（创建子 agent、预约、审批、凭据），**不编排流程**；顺序、轮数、质量门仍然只在引擎里（ADR 0006）。插件和运行时一起锁定版本（ADR 0003）。

3. **以下能力由 laoshi 内置实现**，适配器可以用平台原生能力替换：
   - worktree（`git worktree`）；
   - 服务管理（读取代码库配置中的服务，分配端口，健康检查，保留输出）；
   - 本机调度器（平台和插件都没有定时任务时，到点调用 `notifyAgent`）。

   Paseo 适配器继续使用 Paseo 自己的工作区、`paseo.json` 服务和定时任务。

4. **审批作为一项正式能力**：
   - 契约新增可选能力"回答待处理的请求"，以及项目级的**审批策略**（允许、拒绝、交给人）。
   - 策略没有写到的请求一律交给人；不能默认允许。
   - 只处理 laoshi 步骤的请求，不干预使用者自己的会话。
   - 交给人时，在对话里提醒"某个步骤在等批准"。

   这同时回答了内部平台适配器 §4 的问题：方案 B（由 laoshi 转交）对应 `plugin` 或 `platform` 来源，方案 A（人在平台界面里处理）就是交给人的那一支。

5. **契约修订，与实现一起提交**（这里只定方向，不单独先改契约文件）：
   - `listPaseoProfiles` 改名为 `listProfiles`；
   - `attachAgent` 的语义改为"恢复步骤会话"：能恢复原会话就恢复，不能就按结果文件重做这一步；
   - 引入 agent 事件模型（消息、工具调用、工具结果、权限请求、用量、回合结束），由核心从事件推导 `wait`、`recentActivity`、`runningTool`、`toolCalls` 和用量，适配器只需提供事件。轮询式平台由解释器把状态变化转换成事件；
   - 把 `verifyOrigin`、`notifyAgent`、定时消息、步骤显示在对话下等能力归入单独的"对话通道"，便于组合，例如"平台运行时 + 外部通知器通道"。

6. **dsh 适配器的形态是"外部引擎 + laoshi dsh 插件"**：
   - 引擎通过 web host 的 `/api` 创建、下发、取消、列出、追问会话；
   - 插件负责在对话下创建子 agent、创建定时任务、回答审批，以及引擎的认证。
   - `dsh headless` 和 `dsh acp` 不作为 dsh 的主路径：步骤在 web 界面里看不到。它们可以作为"无头 CLI 运行时"（M3）的后端。

## 理由

- 摸底中，dsh 所有影响体验的能力（对话下的子 agent、定时消息、插件审批）都已实测可用，只是要经由插件。不把插件当作正式来源，这些能力就只能放弃。
- worktree、服务和调度与平台无关，在 req-kit 中原本就由 Paseo 代劳；换到其他平台时，没有理由由每个适配器各写一遍。
- 只有声明了来源，`doctor` 才能如实说明"这项能力由谁提供"，使用者也才能判断体验差在哪里。

## 待验证

1. 子会话在 host 重启后的冷恢复（`attachAgent`）。
2. 插件与引擎之间的通道和认证方式（[dsh-adapter §4](../design/dsh-adapter.md)）。
3. 真实模型下的端到端评估，以及"夸大"指标为零。
4. 事件模型能否同样覆盖 Paseo（时间线）和内部平台（轮询状态），从而让三个适配器共用同一套一致性测试。

## 影响

- [adapter-guide](../design/adapter-guide.md) 的适配器形状增加 `plugin` 一项，能力声明增加来源；[architecture](../design/architecture.md) 的运行时层负责按来源选择，核心增加内置能力。
- [plan](../extraction/plan.md) 新增 dsh 适配器里程碑，内置能力并入 M2。
- 契约修订（决定 5）属于格式变更，按 [contracts/agent-runtime.md](../../contracts/agent-runtime.md) 末尾的规则，与实现、迁移和 CHANGELOG 一起提交。
