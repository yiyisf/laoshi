# 抽取计划

依据：[资产清单](asset-inventory.md)（基于 req-kit 1.13.0，commit `4bdb338`）。每一步完成的标准是：**行为与 req-kit 1.13 等价，回归通过**。

## 阶段 0：契约（已开始）

- [x] `contracts/` 从 req-kit 导入，新增 `agent-runtime.md`
- [ ] 逐份中性化契约里的 Paseo 字样；`state.md` 设计 v2（见下）

## 阶段 1：搬运核心

按资产清单第 1 节搬：方法类 skill 与原则、步骤提示词、`engine/src` 中的编排与业务逻辑、`engine/test`、`evals/`。

- 搬运前提：能安装依赖并跑通基线（`npm install`、`npm run typecheck`、`npm test`）。**需要在能访问 npm 的环境里做。**
- 先原样搬，保持 `AgentRuntime` 不变，只把 Paseo 实现放到 `adapters/paseo/`。

## 阶段 2：拆耦合

- `launch.ts`、`doctor.ts`、`configure.ts`、`factory.ts`：把"连 Paseo"的部分移进适配器，核心只依赖 `AgentRuntime`；体检分为"通用体检 + 适配器体检"。
- `AgentProfile` 拆成通用字段与适配器私有字段。
- 平台词汇表：`messages.ts`、`launch.ts`、`control.ts`、提示词中的界面指引改为从适配器取文案。
- 状态 v2：`worktree.workspaceId`、`schedules[]`、`originAgentId` 中性化，并写 v1→v2 迁移与测试。
- 会话识别：环境变量 `PASEO_AGENT_ID`、`PASEO_AGENT_CWD` 改由适配器提供。

## 阶段 3：第二个适配器

用来校验契约：优先内部 agent 平台，或 bb-app。通过 `fake-runtime` 编排测试和 `evals/`。

## 阶段 4：初始化 skill 与自检

`laoshi-init`：探测平台（外部引擎模式 / 会话内编排模式）→ 生成适配 → 人确认并锁定；`laoshi doctor` 输出能力矩阵并跑样例需求的 golden run。

## 阶段 5：兼容与发布

- `paseo-req-kit` 2.0 作为薄分发包（依赖 laoshi 与 Paseo 适配器，保留 `req` 命令，状态走 v1→v2 迁移）。
- 发布到公网 npm 以便内网镜像同步；发布前确认包名可用。
- 站点与内网 Git Pages 同步流程单独建立。

## 未决问题

- npm 包名（`laoshi` 是否可用；否则 `laoshi-cli` 或带 scope）。
- 会话内编排模式（模式 B）的命令集：`laoshi next / record / gate` 的最小集合。
- 内部 agent 平台的程序化 API 现状，决定第二个适配器走哪种模式。
