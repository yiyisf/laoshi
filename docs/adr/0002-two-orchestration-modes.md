# 0002 两种编排模式：外部引擎与会话内编排

- 状态：提议（模式 B 依赖一个待验证的假设）
- 详见：[architecture.md §4](../design/architecture.md)、[in-chat-orchestration.md](../design/in-chat-orchestration.md)

## 背景

req-kit 的引擎是外部进程，经 SDK 驱动步骤 agent，流程保证最强，但要求平台有程序化 agent API。团队的内部 agent 平台是否具备，目前未知。

## 决定

- **模式 A（外部引擎）**为默认，也是流程保证最强的模式。
- 提供**模式 B（会话内编排）**覆盖只能接入 skill 的平台：状态机仍在 CLI 里，会话 agent 通过 `laoshi run next / record` 推进。
- 两种模式共用状态文件、结果文件和步骤提示词。
- 实现顺序：先做**无头 CLI 运行时**（模式 A 的一个适配器，不改 `flow`），再做模式 B，且以"续跑机制可复用"的假设验证通过为前提。

## 影响

- 文档必须说明模式 B 的流程保证弱于模式 A，让团队按场景选择。
- 需要用 `fake-runtime` 写"外包执行器"来验证假设；验证不通过则需要把 `flow` 改成显式状态机，工作量显著增加，届时重新评估是否做模式 B。
