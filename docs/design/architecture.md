# 架构设计

- 状态：提议（待团队评审）
- 依据：[资产清单](../extraction/asset-inventory.md)、[ADR 0001](../adr/0001-new-repo-core-and-adapters.md)

## 1. 目标与非目标

目标：同一套需求开发流程（对话对齐 → 方案 → 实现 → 评审 → 验证 → 报告）能在不同 agent 平台上运行，行为一致、可验证；新平台的接入成本低，且不需要改核心。

非目标：

- 不做通用编码提效工具（见 [SCOPE.md](../../SCOPE.md)）。
- 不抹平平台差异：只有一个平台才有的体验（例如 Paseo 的插件界面）留在该平台的适配器里，不进核心。
- 不在运行时让模型临场决定流程。流程顺序、轮数、质量门由程序保证。

## 2. 沿用 req-kit 的不变量

这些在 req-kit 里已经被证明有效，laoshi 保持不变：

1. **步骤之间只通过文件交接**：每步写一个 JSON 结果文件，引擎只据此决定下一步，不解析 agent 的回复文字（[result-file.md](../../contracts/result-file.md)）。
2. **状态在文件里**：`.pipeline/state.json` 由引擎写入，可随时查看、暂停、继续；中断后从断点恢复。
3. **做事的和检查的分开**：builder 与 reviewer 可用不同模型。
4. **如实报告**：未验证的写"未验证"。评估里最重要的指标是"夸大"（报告说可验收但隐藏验收没过）为零。
5. **安全边界**：不合并、不上线、不连生产环境、只在配置允许时推送到指定前缀的分支。
6. **每个步骤都挂在发起的会话下**（ADR 0001 of req-kit）：使用者在同一个地方看到所有步骤。

## 3. 三层结构

```text
┌───────────────────────────────────────────────┐
│ 核心（platform-neutral）                       │
│  流程剧本 · 步骤与结果 · 状态机 · 质量门         │
│  使用数据 · 集成 · 通知 · 配置分层               │
└──────────────┬────────────────────────────────┘
               │ 只依赖 AgentRuntime（contracts/agent-runtime.md）
┌──────────────▼────────────────────────────────┐
│ 运行时层                                        │
│  适配器注册与加载 · 能力矩阵 · 降级策略           │
└──────────────┬────────────────────────────────┘
               │
┌──────────────▼────────────────────────────────┐
│ 适配器（每个平台一个）                           │
│  paseo · <内部平台> · dsh · generic-cli（声明式） │
└───────────────────────────────────────────────┘
```

核心不出现任何平台名字。运行时层负责：按配置选适配器、校验适配器声明的能力、对缺失的可选能力提供统一的降级行为（而不是让每个调用点各写一套）。

按 [ADR 0008](../adr/0008-capability-sources-and-platform-plugin.md)（提议），运行时层还要按来源选择能力：平台原生 → laoshi 平台插件 → laoshi 内置（worktree、服务管理、本机调度）→ 降级。

## 4. 两种编排模式

req-kit 只有一种：外部引擎进程通过 SDK 驱动 agent。要覆盖"平台只有 skill 和会话内子 agent 工具、没有程序化 API"的情况，laoshi 支持两种：

| | 模式 A：外部引擎 | 模式 B：会话内编排 |
| --- | --- | --- |
| 谁驱动流程 | 后台引擎进程 | 会话里的 agent，按 skill 反复调用 `laoshi run …` |
| 平台要求 | 程序化的 agent API（必需能力全部可用） | 会话内能起子 agent、能执行命令 |
| 流程保证 | 引擎强保证（agent 无法跳步） | 状态机在 CLI 里，`record` 拒绝乱序；agent 理论上可以不调用，靠评估和 doctor 抽查兜底 |
| 以后再做 | 平台定时任务或本机定时器 | 平台定时任务；否则由使用者手动继续 |
| 适合 | 能写完整适配器的平台、软件工厂 | 只能接入 skill 的平台、快速试用 |

两种模式共用同一套状态文件、结果文件和步骤提示词，因此一个需求可以在两种模式间迁移（例如先用模式 B 试用，再换模式 A）。模式 B 的设计见 [in-chat-orchestration.md](in-chat-orchestration.md)。

## 5. 仓库与包的布局（提议）

**一个 npm 包 `laoshi`，适配器先放在包内目录**，不拆成多个包——在出现第二个外部消费者之前，拆包只增加发布成本。

```text
laoshi/
  bin/                  laoshi 命令；`req`、`start-pipeline` 作为兼容别名
  engine/src/           核心（保持 req-kit 的文件名，见下）
  engine/prompts/       步骤提示词（中性化后）
  src/runtime/          AgentRuntime 类型、适配器注册、能力矩阵、降级
  adapters/paseo/       Paseo 适配器：运行时、profile、paseo.json、daemon 检查、词汇表、插件
  adapters/generic/     声明式适配器解释器（见 init-bootstrap.md）
  skills/               入口 skill、方法 skill、原则、手册
  principles/  contracts/  evals/  docs/
```

**核心文件保持 req-kit 的路径和文件名**（`engine/src/pipeline.ts` 等），只把 Paseo 实现移到 `adapters/paseo/`。理由：过渡期 req-kit 1.x 的缺陷修复要移植过来，路径一致时大多数补丁可以直接应用；等 1.x 停止维护后再考虑整理目录。

**安装位置**（[ADR 0007](../adr/0007-one-install-many-repos.md)）：一次安装服务多个代码库。安装单位是安装根（`LAOSHI_HOME`，本机默认 `~/.laoshi/`），laoshi 本体、skill、适配器与锁定文件、安装级配置、使用记录都在里面；在只有工作区持久的平台上（如摸高的 `/data/workspace`），安装根放在工作区内。代码库内只放专属配置（`.laoshi.json`、`.laoshi/`、平台要求的工作区配置）和需求产出（`docs/features/`），`laoshi-setup` 不向代码库复制 skill、提示词、脚本或引擎代码。

## 6. 配置

两层：**安装级 → 代码库级**（后者覆盖前者），不设团队层；团队版平台下安装级配置本身就是团队共享的（[ADR 0007](../adr/0007-one-install-many-repos.md)）。在此之上新增：

- `platform.adapter`：选择适配器（如 `"paseo"`）。
- `platform.<适配器名>`：适配器私有配置。req-kit 的 `daemonUrl`、`daemonPasswordEnv` 迁移到 `platform.paseo` 下，旧字段继续读取并提示迁移。
- `AgentProfile` 拆成通用字段（模型、模式、思考档位）和适配器私有字段（Paseo 的 `paseoProfile`、`featureValues`）。
- 代码库级可声明 laoshi 最低版本，由 `doctor` 检查。
- req-kit 1.x 的团队层配置继续读取，`laoshi migrate` 提示合并到安装级。
- 凭据只来自使用者自己的环境变量，不写入安装根。

## 7. 适配器如何接入

见 [adapter-guide.md](adapter-guide.md)（接口、能力声明、体检、一致性测试）、[platform-vocabulary.md](platform-vocabulary.md)（面向使用者的文案如何按平台取词）、[init-bootstrap.md](init-bootstrap.md)（让适配器"自己长出来"）。

## 8. 待定

- 声明式适配器（init-bootstrap.md）能覆盖多少平台，需要拿内部 agent 平台实际验证。
- `pipeline.ts` 的 `flow` 是命令式的"循环 + 异常 + runtime 调用"，不是显式状态机。模式 B 打算复用现有的续跑机制而不是重写它，这个假设还没有验证（见 in-chat-orchestration.md §3）。
- 实现顺序以 [抽取计划](../extraction/plan.md) 为准：先无头 CLI 运行时（模式 A 的适配器），再做模式 B。
