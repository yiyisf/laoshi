# 会话内编排（模式 B）

- 状态：已实现（[ADR 0002](../adr/0002-two-orchestration-modes.md)、[ADR 0009](../adr/0009-custom-flows-and-dual-mode.md)，代码见 `engine/src/run-cmd.ts` 与 `engine/src/pipeline.ts`）
- 背景：[architecture.md §4](architecture.md)。模式 A（外部引擎）要求平台有程序化 agent API；模式 B 让只有"skill + 会话内子 agent 工具"的平台也能用同一套流程（包括默认流程与所有自定义编排流程）。

## 1. 要解决的问题

req-kit 的引擎是一个后台进程，通过 SDK 创建步骤 agent、等待结果。如果平台没有这样的 API，就没有进程可以"创建 agent 并等它结束"。但这类平台通常允许会话里的 agent 自己起子 agent、执行命令。模式 B 把"谁来推进"交给会话里的 agent，把"下一步是什么、结果合不合格"留给确定性的 CLI。

## 2. 交互形状

```text
会话 agent                                laoshi CLI（确定性）
   │  laoshi run next --feature X  ──────►  读 state.json，决定下一步
   │  ◄──────  { step, role, promptFile, resultFile, context }
   │  用平台的子 agent 工具执行这一步（读 promptFile，写 resultFile）
   │  laoshi run record --feature X --step K ──►  校验结果文件，更新状态，质量门
   │  ◄──────  { accepted | rejected(reason), next }
   │  …直到 { done | waiting(reason, command) }
```

- `next` 只返回一个步骤，并写入"等待结果"的状态；重复调用返回同一步骤，不会跳步。
- `record` 校验结果文件的字段和取值（与现在引擎相同的规则，`engine/src/steps.ts`）；不合格返回原因，让会话 agent 要求子 agent 补写。
- 需要人决定的点（方案确认、需求方决定、研发完成待测试）返回 `waiting`，附上使用者该做什么和继续用的命令。
- 质量门、范围检查、预算、集成（卡片状态）、使用数据照常由 CLI 执行，因为它们本来就在引擎里，不依赖 agent。

## 3. 关键假设：复用现有的"续跑"机制，而不是重写流程

req-kit 的 `flow(ctx)`（`engine/src/pipeline.ts`，`runPipeline` 在 2198 行附近）是一个命令式的 async 函数：顺序、循环（审核 ⇄ 修订）、异常（如 `PhaseGate`）与 `runtime` 调用交织在一起。把它改写成显式状态机工作量大、回归风险高。

但引擎已经支持续跑：`state.results` 按步骤键（如 `code_review-r2`）保存结果，重新运行时已完成的步骤会被复用。因此可以：

1. 提供一个"外包执行"的步骤执行器：流程运行到需要执行某一步、而该步没有结果时，**记录"请求执行步骤 K"并抛出一个类似 `PhaseGate` 的信号，进程保存状态后退出**。
2. `laoshi run next` = 以模式 B 重新运行 `flow`：已有结果的步骤被跳过，到达下一个没有结果的步骤时再次发出请求。
3. `laoshi run record` 把结果写入 `state.results[K]`，并执行与现在 `runStepOnce` 相同的校验。

这样 `flow` 的流程逻辑一行不改，只替换"执行一步"这个动作。

**该假设已验证通过并实现：**
- （a）每个步骤键（包括循环轮次 `design_review-r1`、切片 `implement-s1`、评审小组 `code_review-r1-panel-1`、联合开发 `implement@backend`、自定义步骤）在续跑时完全由 `state.results` 决定；
- （b）当 `ctx.mode === "chat"` 时，`chatStep` 将组装好的提示词写入 `.pipeline/requests/<key>.md`，在 `state.stepRequests` 中登记请求（包含 `followUps`、`gateFixes`、`secretFixes` 计数），并抛出 `StepRequested`；并行步骤通过 `Promise.allSettled` 一次性登记所有并发分支的 `StepRequest`；
- （c）首次 `laoshi run next` 执行完整的启动准备（分支检查、`checkQuota`、`integrate(started)`），后续 `next` / `record` 传入 `chatContinuing: true`，不重复触发启动副作用。

## 4. 保证的强弱

| 保证 | 模式 A | 模式 B |
| --- | --- | --- |
| 步骤顺序、轮数、质量门 | 引擎保证 | CLI 保证（`record` 拒绝乱序和不合格结果） |
| agent 是否按流程走 | 无法绕开 | 会话 agent **可以不调用 `next`**，自己随意发挥 |
| 兜底 | — | `laoshi doctor` 对进行中需求检查"有没有长时间无记录的改动"；评估里的"夸大"指标；使用者可见的状态 |

模式 B 的流程保证弱于模式 A，不适合作为"流程必须严格执行"场景的默认模式。文档和 `laoshi doctor` 的输出要把这点写清楚，让团队按场景选择。

## 5. 以后再做与等待

没有引擎进程，"预约开始""等待提醒""限流后自动继续"没有地方运行。模式 B 的做法：

- 平台有定时任务（`scheduling` 能力）：和模式 A 一样，到点向会话发消息，让会话 agent 执行 `laoshi run next`。
- 没有：`next` 返回 `waiting`，把"到什么时候再执行什么命令"原样告诉使用者；不假装能自动继续。

## 6. 更轻的替代：无头 CLI 运行时（模式 A 的一个适配器）

对"没有 API，但编码 agent 有无头命令行（如 `claude -p`、`codex exec`）"的平台，另一条路是写一个运行时：每个步骤 agent 是一个子进程，`wait` 等进程结束，`followUp` 在同一会话里继续。这仍是模式 A，**流程保证最强**，且不需要改 `flow`。它覆盖不了需要"挂在发起会话下"的体验，通知只能写文件或发外部通知器。

建议实现顺序：先做无头 CLI 运行时（它也是 [init-bootstrap.md](init-bootstrap.md) 中声明式适配器的天然落点），模式 B 作为第二步，在 §3 的假设验证通过后再做。

## 7. 待定

- 命令集最小化：`run next / record / status`，是否需要 `run abort`、`run answer`（需求方回答问题）。
- 子 agent 完成后是由会话 agent 调用 `record`，还是让步骤提示词末尾要求子 agent 自己调用（后者更省事，但让执行者自己"批改"，削弱了独立性——倾向前者）。
