# 设计决定（ADR）

每条记录一个关键取舍：背景、决定、理由和影响。改动已有的决定时新增一条，并在旧的一条中注明被哪条取代。从 paseo-req-kit 继承的决定见它自己的 ADR；这里的编号从 laoshi 建库开始。

| 决定 | 状态 |
| --- | --- |
| [0001 新建 laoshi 库：核心与平台适配器分开](0001-new-repo-core-and-adapters.md) | 已采纳 |
| [0002 两种编排模式：外部引擎与会话内编排](0002-two-orchestration-modes.md) | 提议（模式 B 依赖一个待验证的假设） |
| [0003 适配器只在安装时生成一次并锁定](0003-generate-once-then-lock.md) | 提议 |
| [0004 对外契约在迁移中保持稳定](0004-external-contracts-stay-stable.md) | 提议 |
| [0005 入口 skill 命名](0005-skill-names.md) | 已采纳（2026-10-21，由项目负责人确认） |
| [0006 确定性引擎 + 平台能力层：先手写，后生成](0006-deterministic-engine-platform-capabilities.md) | 提议（项目负责人已同意方向，待摸底实验结果确认） |
| [0007 一次安装，多库共用；库内只放专属配置](0007-one-install-many-repos.md) | 提议（待摸底实验 A、实验 5 确认平台上的可行性）；决定 1、4、5、6 的引擎部分已在 M2c 实现（见文末"实现"） |
| [0008 能力按来源分层，平台插件作为适配器的一部分](0008-capability-sources-and-platform-plugin.md) | 提议 |
