# 0001 新建 laoshi 库：核心与平台适配器分开

- 状态：已采纳

## 背景

req-kit（`paseo-req-kit`，当前 1.13.0）运行在 Paseo 上。它的引擎已经只通过 `AgentRuntime` 接口与平台交互（`engine/src/runtime.ts`，21 个方法，唯一的真实实现是 `paseo-runtime.ts`），直接绑定 Paseo 的代码约占 engine/src 的 5.7%。但名称、状态文件字段、用户文案、会话识别方式、"以后再做"的实现方式仍然写死了 Paseo，团队也需要在内部自建的 agent 平台上使用同一套流程。

## 决定

- 新建 `laoshi` 库，不在 req-kit 库里并行两个版本。原因：两个名字、两条版本线会让 tag、release、CI、站点部署和 issue 互相干扰；laoshi 需要改状态格式和目录结构，不能影响正在使用 1.x 的同事。
- 结构分三层：**核心**（平台无关）、**能力契约**（`contracts/agent-runtime.md`）、**适配器**（每个平台一个）。
- 适配器可以由内置初始化 skill 探测平台后生成，但只在安装时生成一次，经人确认后锁定版本，并由 `doctor` 自检；运行时不现场生成。
- req-kit 进入维护模式：只修缺陷。laoshi 达到对等后，`paseo-req-kit` 发布 2.0 作为薄分发包。

## 影响

- 过渡期要维护两份，严重缺陷需要按清单移植。
- 一致性验收复用 req-kit 的 `fake-runtime` 编排测试和 `evals/` 端到端评估。
- 命令保留 `req` 别名，以便老用户迁移。
