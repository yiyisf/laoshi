# laoshi（老师）

**让非专职开发的同事，在任何 agent 平台上，把一个需求从对齐做到可验收。**

laoshi 是从 [paseo-req-kit](https://github.com/yiyisf/paseo-req-kit)（req-kit）中抽取出来的、与 agent 平台无关的需求开发体系：用对话对齐需求，由一组分工明确的 agent 完成方案设计、实现、评审和验证，每一步都有产出文件和验收门，流程由程序保证，而不是由 AI 或人即兴发挥。

> **状态：起步阶段，还不能使用。** 现在库里只有契约文档、抽取计划和决策记录。req-kit 1.x 继续在原库维护，直到 laoshi 达到对等。

## 设计思路

- **核心（core）**：流程剧本、步骤与结果文件、状态机、质量门、使用数据、集成。不依赖任何 agent 平台。
- **能力契约**：核心对平台的要求，写在 [contracts/agent-runtime.md](contracts/agent-runtime.md)，分必需 / 可选 / 按需三级，并写明没有某项能力时的降级行为。
- **适配器（adapter）**：每个平台一个（Paseo、你们内部的 agent 平台、Claude Code 等）。内置的初始化 skill 会探测平台现状，生成适配并自检，由人确认后锁定版本，而不是每次运行时现场生成。

## 目录

| 路径 | 内容 |
| --- | --- |
| `contracts/` | 文件格式与平台能力契约（从 req-kit 1.13.0 导入，尚待中性化） |
| `docs/design/` | 架构、适配器指南、平台词汇表、初始化与自生长、会话内编排、状态 v2、兼容迁移 |
| `docs/adr/` | 设计决定 |
| `docs/extraction/` | 从 req-kit 抽取的资产清单与[实施计划](docs/extraction/plan.md) |
| [SCOPE.md](SCOPE.md) | 范围 |

## 与 req-kit 的关系

- 抽取完成并回归通过前，req-kit 只修缺陷，新功能先进 laoshi。
- 之后 `paseo-req-kit` 会成为依赖 laoshi 与 Paseo 适配器的薄分发包，保留 `req` 命令，已安装的用户通过升级迁移。

## 许可证

MIT
