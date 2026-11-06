# 0009 自定义编排流程与双编排模式（外部引擎 + 会话内编排）

- 状态：已采纳（2026-11-06）
- 关联：[0002 两种编排模式](0002-two-orchestration-modes.md)、[0006 确定性引擎 + 平台能力层](0006-deterministic-engine-platform-capabilities.md)、[custom-flows.md](../design/custom-flows.md)、[in-chat-orchestration.md](../design/in-chat-orchestration.md)

## 背景

1. **原固定流程缺乏按项目/团队裁剪的声明式能力**：虽然 `pipeline.ts` 的默认 `flow(ctx)` 支持快速档/标准档、缺陷/重构/评估三类需求，但团队在实际落地时经常需要：
   - 裁剪步骤（如热修复跳过方案审核与提测说明，纯文档需求只做设计与评审）；
   - 插入团队特定的检查或合规步骤（如安全审计、合规审查、性能基线检查），且具备独立提示词、结果 schema 校验和质量门；
   - 按档位、需求类型或前序步骤的结果字段做条件分支与审校循环。
2. **双编排模式（ADR 0002）的待验证假设需要落地**：模式 A（后台外部引擎）依赖平台的程序化 agent API；而只有"skill + 会话内子 agent 工具"的平台需要模式 B（会话内编排，`laoshi run`），且两种模式必须能无差别地运行内置默认流程和任何自定义编排流程。

## 决定

1. **声明式自定义编排流程（`schema: 1`）**：
   - 支持三类流程节点：`step`（内置或自定义步骤）、`loop`（`check-first` 审查循环与 `fix-first` 缺陷修复循环，支持固定轮数或引用档位轮数 `profile.designReview | codeReview | defectFix`）、`checkpoint`（`approval` 方案确认点与 `phase` 研发/验证阶段闸口）。
   - 支持 `when` 条件守卫（按 `profile`、`type` 或前序步骤结果 `result: { step, field, equals | in }` 判断）。
   - 支持在流程文件 `steps.<id>` 中声明自定义步骤（`title`、`role`、`prompt`、`result` 字段契约、`optional`、`gate`、`timeoutMinutes`），与内置步骤享有完全相同的提示词组装、结果校验、质量门和密钥扫描。
   - 按优先级查找流程：`<repo>/.laoshi/flows/<name>.json` → `<LAOSHI_HOME>/flows/<name>.json` → `engine/flows/<name>.json`（随包提供 `standard`、`quick`、`hotfix`、`doc-only` 四个模板）。`default` 保持原有的自适应内置流程。
   - 选择优先级：`--flow <名称>` → 续跑时 `state.flow` → `spec.md` 的 `- 流程：<名称>` → 配置 `orchestration.flow`（默认 `"default"`）。
2. **复用 `runPipeline` 与 `state.results` 实现会话内编排（模式 B）**：
   - 验证通过 ADR 0002 / `in-chat-orchestration.md §3` 的核心假设：不重写 `flow(ctx)` 或 `runCustomFlow`，而是在 `runStepOnce` 中当 `ctx.mode === "chat"` 且目标步骤尚无结果时，将组装好的提示词写入 `.pipeline/requests/<key>.md`，向 `state.stepRequests` 登记请求并抛出 `StepRequested` 信号。
   - 并行步骤（如 `reviewPanel`、`designProposals`、联合需求的跨仓库并行步骤）通过 `Promise.allSettled` 一次性收集所有并发分支的 `StepRequest` 写入 `state.stepRequests`，让会话 agent 可以同时派发多个子 agent。
   - `laoshi run next / record / approve / verify / status / mode` 作为确定性 CLI：首次启动运行启动生命周期（预检、加锁、登记开始），后续步骤携带 `chatContinuing: true` 跳过重复的启动副作用；`record` 对结果文件执行与模式 A 完全相同的契约校验、质量门与密钥扫描，不合格时自动生成跟进提示词并保持在 `step_requested` 状态。
3. **双模式状态互通**：
   - 模式 A 与模式 B 读写同一份 `state.json`（`STATE_VERSION = 2`）和 `state.results`。同一需求可以在模式 B 完成前序步骤后用模式 A `--resume` 接手，反之亦然。

## 影响

- 新增 `engine/src/flows.ts`、`engine/src/flow-runner.ts`、`engine/src/flow-cmd.ts`、`engine/src/run-cmd.ts` 及 `engine/flows/*.json`。
- `state.json` 新增可选字段 `flow`（流程名称）与 `stepRequests`（支持单步与并行多步请求，兼容保留单数 `stepRequest` 指向首个请求）。
- `laoshi doctor` 自动校验项目中 `.laoshi/flows/*.json` 与 `orchestration.flow`，并对模式 B 中超过 2 小时无进展的运行给出提醒。
