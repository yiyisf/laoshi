# 抽取与实施计划

依据：[资产清单](asset-inventory.md)（基于 req-kit 1.13.0，commit `4bdb338`）与 [设计文档](../design/)。每个里程碑的完成标准都是：**行为与 req-kit 1.13 等价，回归通过**，不是"代码搬完"。

npm 包名：**`laoshi`（已确认可用）**。

## 实施前的准备（本文档集之后、写代码之前）

- [x] 能力契约：[contracts/agent-runtime.md](../../contracts/agent-runtime.md)
- [x] 设计：[internal-platform-adapter](../design/internal-platform-adapter.md)（草案）、[architecture](../design/architecture.md)、[adapter-guide](../design/adapter-guide.md)、[platform-vocabulary](../design/platform-vocabulary.md)、[init-bootstrap](../design/init-bootstrap.md)、[in-chat-orchestration](../design/in-chat-orchestration.md)、[state-v2](../design/state-v2.md)、[compat-migration](../design/compat-migration.md)
- [x] 决策：ADR 0001~0005；[ADR 0006](../adr/0006-deterministic-engine-platform-capabilities.md)（确定性引擎 + 平台能力层，先手写后生成，提议）
- [x] 分工与阶段门槛：[workstreams.md](workstreams.md)（5~6 人小队）
- [ ] **团队评审设计文档**，重点是各文档末尾的"待定"项（见本文末尾汇总）
- [ ] **一个能访问 npm 的开发环境**：`npm install`、`npm run typecheck`、`npm test` 在 req-kit 1.13 上跑通，并记录基线结果（通过数、耗时）
- [ ] 为 req-kit 1.13 补一份 `evals` 基线（`evals/baselines/1.13.0.md`），作为"对等"的比较对象
- [ ] 拿到**内部 agent 平台的 CLI 说明**：已知能启动任务、恢复暂停的 HITL 会话并传入输入、取消等待中的 HITL 请求；待确认的五个问题见 [internal-platform-adapter §6](../design/internal-platform-adapter.md)（状态与 HITL 语义最关键）；平台方暂无详细信息，改用[平台摸底清单](../design/platform-discovery.md)自行实验

## 里程碑

### M0 契约与文档（进行中）
契约导入完成；设计与 ADR 完成。剩余：契约里的 Paseo 字样逐份中性化（文件格式契约不涉及流程语义，改动小）。

### M1 搬运核心，行为不变
- 搬：方法类 skill 与原则、步骤提示词、`engine/src` 的核心文件、`engine/test`、`evals/`。**文件路径和名字保持不变**（见 [architecture §5](../design/architecture.md)）。
- 把 Paseo 实现（`paseo-runtime`、`paseo-profiles`、`paseo-json`、`daemon-check`、`daemon-version`）移到 `adapters/paseo/`；`runtime-loader.ts` 改成按配置选适配器。
- 完成标准：`typecheck` 和 `npm test` 与基线一致；Paseo 适配器下 `evals/` 自检通过。

### M2 拆耦合
- `launch.ts`、`doctor.ts`、`configure.ts`、`factory.ts`：把"连 Paseo"的部分移进适配器；体检拆成通用 + 适配器。
- 运行时层：适配器声明能力，未声明能力统一返回 `null`，去掉调用点各自的降级写法。
- 配置：`platform.adapter` / `platform.<id>`；`AgentProfile` 拆通用与私有；旧字段继续读取并提示。
- 状态 v2：迁移函数与测试；对外契约保持 `schema: 1`（[ADR 0004](../adr/0004-external-contracts-stay-stable.md)）。
- 平台词汇表：先收敛 `messages.ts`、`launch.ts`、`control.ts`；加 CI 检查，核心里不得出现平台名。
- 完成标准：核心目录中搜不到平台名；M1 的回归全部通过。

> **顺序说明（ADR 0006）**：摸高平台就是内部平台，M4 优先于原计划，与 M3 并行；M5 的"生成"排在两个手写适配器之后。

### M3 无头 CLI 运行时（第一个非 Paseo 适配器）
- 每个步骤 agent 是一个编码 agent 命令行的子进程；通知写文件或走外部通知器。
- 同时抽出 `runConformance(adapter)`，让新适配器复用编排测试的期望。
- 完成标准：不依赖 Paseo，在一台只有编码 agent 命令行的机器上跑通一个 `evals/` 用例，"夸大"为零。

### M4 内部平台适配器
- 平台是 CLI 形态（轮询式 `wait`、HITL 映射），映射与缺口见 [internal-platform-adapter](../design/internal-platform-adapter.md)；据此选择声明式描述（[init-bootstrap](../design/init-bootstrap.md)）或手写适配器。
- 前置：该文档 §6 前两个问题（状态来源、HITL 语义）有答案，且已确认引擎进程能在哪里运行。
- 第一版**手写**，不生成；生成实验见 M5。
- 完成标准：能力矩阵、探针测试、至少一个端到端用例通过。

### M5 初始化 skill 与自检
- `laoshi init`（detect → probe → generate → review → lock → verify）、锁定文件、`laoshi doctor` 的哈希校验与能力矩阵。
- 先做探针与锁定校验，再做"LLM 起草适配器"：以 M3、M4 手写适配器为真值，要求生成版本通过同一套一致性测试，并与手写版本能力矩阵一致。
- 完成标准：对 M3、M4 的平台各跑一次 init，生成物经审阅后锁定，`doctor` 通过。

### M6 会话内编排（模式 B，有条件）
- 前提：[in-chat-orchestration §3](../design/in-chat-orchestration.md) 的"续跑机制可复用"假设验证通过（用 `fake-runtime` 的外包执行器跑通现有编排用例）。
- 不通过则暂停，重新评估是否值得把 `flow` 改成显式状态机。

### M7 兼容与发布
- `laoshi migrate`（预览 / 应用 / 回滚演练），`paseo-req-kit` 2.0 薄分发包，发布到公网 npm 供内网镜像同步，站点与内网 Git Pages 同步。
- 完成标准：[compat-migration §4](../design/compat-migration.md) 的"对等"五条全部满足。

## 风险登记

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 内部平台没有可用的接口 | M4、M5 受阻 | 无头 CLI 运行时（M3）兜底；模式 B（M6）作为第二选择 |
| 引擎无法在平台沙箱内运行（无 Node、后台进程被回收、不能调命令行） | 引擎位置需重新设计 | 摸底实验最先验证；备选：引擎放在使用者机器或服务器，沙箱只作步骤执行环境 |
| LLM 生成的适配器质量无先例保证 | 生成实验失败 | 先手写；一致性测试为唯一准入；失败时保留手写适配器 |
| 声明式描述表达力不够 | M5 退化为手写适配器 | 保留"手写适配器"出口；参考适配器作模板 |
| 模式 B 假设不成立 | M6 工作量大增 | M6 设为有条件；先验证再投入 |
| 抽取过程中 1.x 仍在修缺陷，两边漂移 | 回归、缺陷重复 | 路径保持一致；`docs/porting-log.md` 登记；"只接收严重缺陷"的规则 |
| 对外契约被改名破坏插件/IM/汇总 | 现网使用受影响 | [ADR 0004](../adr/0004-external-contracts-stay-stable.md) |
| 内网模型较弱，生成阶段质量差 | 适配器生成失败 | 描述 schema 校验 + 探针；失败时明确提示手写 |

## 待定项汇总（评审时逐条定）

1. ~~skill 名~~：已决定 `/laoshi*`，`paseo-req-kit` 2.0 额外装转发薄 skill（[ADR 0005](../adr/0005-skill-names.md)）。
2. **laoshi 版本号**：`0.1.0` 起、对等时 `1.0.0`，是否接受？
3. **模式 B 的命令集**与"谁调用 `record`"。（[in-chat-orchestration §7](../design/in-chat-orchestration.md)）
4. **锁定文件**放机器配置目录还是项目仓库。（[init-bootstrap §6](../design/init-bootstrap.md)）
5. **文档站**：laoshi 站点与 req-kit 站点并存还是替换；内网 Git Pages 同步流程。
6. 探针对内部平台的用量与副作用是否可接受。
