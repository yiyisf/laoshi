# 抽取与实施计划

依据：[资产清单](asset-inventory.md)（基于 req-kit 1.13.0，commit `4bdb338`）与 [设计文档](../design/)。每个里程碑的完成标准都是：**行为与 req-kit 1.13 等价，回归通过**，不是"代码搬完"。

npm 包名：**`laoshi`（已确认可用）**。

## 实施前的准备（本文档集之后、写代码之前）

- [x] 能力契约：[contracts/agent-runtime.md](../../contracts/agent-runtime.md)
- [x] dsh 摸底与适配设计：[摸底报告](../discovery/dsh/report.md)、[dsh-adapter](../design/dsh-adapter.md)、[ADR 0008](../adr/0008-capability-sources-and-platform-plugin.md)（提议）
- [x] 设计：[internal-platform-adapter](../design/internal-platform-adapter.md)（草案）、[architecture](../design/architecture.md)、[adapter-guide](../design/adapter-guide.md)、[platform-vocabulary](../design/platform-vocabulary.md)、[init-bootstrap](../design/init-bootstrap.md)、[in-chat-orchestration](../design/in-chat-orchestration.md)、[state-v2](../design/state-v2.md)、[compat-migration](../design/compat-migration.md)
- [x] 决策：ADR 0001~0005；[ADR 0006](../adr/0006-deterministic-engine-platform-capabilities.md)（确定性引擎 + 平台能力层，先手写后生成，提议）；[ADR 0007](../adr/0007-one-install-many-repos.md)（一次安装、多库共用，个人版与团队版同一设计，提议）
- [x] 分工与阶段门槛：[workstreams.md](workstreams.md)（5~6 人小队）
- [ ] **团队评审设计文档**，重点是各文档末尾的"待定"项（见本文末尾汇总）
- [x] **一个能访问 npm 的开发环境**：`npm install`、`npm run typecheck`、`npm test` 在 req-kit 上跑通，并记录基线结果（通过数、耗时）。实际按 1.15.0 记录，见[移植记录](../porting-log.md#验证)
- [ ] 为 req-kit 1.13 补一份 `evals` 基线（`evals/baselines/1.13.0.md`），作为"对等"的比较对象
- [ ] 拿到**内部 agent 平台的 CLI 说明**：已知能启动任务、恢复暂停的 HITL 会话并传入输入、取消等待中的 HITL 请求；待确认的五个问题见 [internal-platform-adapter §6](../design/internal-platform-adapter.md)（状态与 HITL 语义最关键）；平台方暂无详细信息，改用[平台摸底清单](../design/platform-discovery.md)自行实验（含 ADR 0007 的安装与团队版实验）

## 里程碑

### M0 契约与文档（进行中）
契约导入完成；设计与 ADR 完成。剩余：契约里的 Paseo 字样逐份中性化（文件格式契约不涉及流程语义，改动小）；按 ADR 0007 在使用记录、通知事件、`laoshi api` 契约中新增 `repo`、`user` 字段，状态契约增加发起人。

### M1 搬运核心，行为不变（已完成，2026-11-01，见[移植记录](../porting-log.md)）
- 搬：方法类 skill 与原则、步骤提示词、`engine/src` 的核心文件、`engine/test`、`evals/`。**文件路径和名字保持不变**（见 [architecture §5](../design/architecture.md)）。
- 把 Paseo 实现（`paseo-runtime`、`paseo-profiles`、`paseo-json`、`daemon-check`、`daemon-version`）移到 `adapters/paseo/`；`runtime-loader.ts` 改成按配置选适配器。
- 完成标准：`typecheck` 和 `npm test` 与基线一致；Paseo 适配器下 `evals/` 自检通过。
- 实际情况：按 req-kit 1.15.0（`a16e1e2`）导入。安装器、文档站、Paseo 插件界面属于分发层，留在 paseo-req-kit，到 M7 处理；`req` 中依赖它们的子命令在 laoshi 中暂不可用。验证结果和路径对照见[移植记录](../porting-log.md)。

### M2 拆耦合
- `launch.ts`、`doctor.ts`、`configure.ts`、`factory.ts`：把"连 Paseo"的部分移进适配器；体检拆成通用 + 适配器。
- 运行时层：适配器声明能力，未声明能力统一返回 `null`，去掉调用点各自的降级写法。
- 配置：`platform.adapter` / `platform.<id>`；`AgentProfile` 拆通用与私有；旧字段继续读取并提示。安装根（`LAOSHI_HOME`）与"安装级 → 代码库级"两层配置；代码库与使用者标识；`laoshi-setup` 只写代码库专属配置（[ADR 0007](../adr/0007-one-install-many-repos.md)）。
- 状态 v2：迁移函数与测试；对外契约保持 `schema: 1`（[ADR 0004](../adr/0004-external-contracts-stay-stable.md)）。
- 平台词汇表：先收敛 `messages.ts`、`launch.ts`、`control.ts`；加 CI 检查，核心里不得出现平台名。
- 能力来源与内置能力（[ADR 0008](../adr/0008-capability-sources-and-platform-plugin.md)）：运行时层按 platform → plugin → builtin → none 的顺序选择；把 worktree、服务管理、本机调度做成内置实现，Paseo 适配器继续使用 Paseo 自己的能力。
- 完成标准：核心目录中搜不到平台名；M1 的回归全部通过；同一安装根下两个代码库的需求可同时运行，使用记录能区分代码库和使用者。
- 分片：
  - **M2a 适配器接口**（已完成，2026-11-01）：`PlatformAdapter`（[platform.ts](../../engine/src/platform.ts)）；profile 解析、体检、配置向导、版本检查、会话识别放到接口后面；未声明的能力统一降级；体检列出能力来源。核心中只有 `runtime-loader.ts` 引用适配器（有测试）。
  - **M2b 内置能力**（已完成，2026-11-01）：worktree（`git worktree`，后台准备命令）、服务管理（`.laoshi/services.json`，端口、健康检查、跨进程停止，Windows 不用 PowerShell），dsh 适配器改用这两项；本机调度已设计未实现（[builtin-capabilities](../design/builtin-capabilities.md)）。
  - **M2c 配置与身份**（已完成，2026-11-02）：安装根 `LAOSHI_HOME`；安装级 → 代码库级两层（`.laoshi.json`，旧名继续读）；`platform.<id>`；代码库与使用者标识写进使用记录、通知事件和 `req api list`（[ADR 0007 实现](../adr/0007-one-install-many-repos.md#实现m2c2026-11-02)）。
  - **M2d 状态 v2 与迁移**（已完成，2026-11-02）：`STATE_VERSION` 2，去掉平台含义的字段改名，`.bak-v1`，运行中的流水线不改写，对外契约仍为 `schema: 1`（[contracts/state.md](../../contracts/state.md)）。
  - **M2e 词汇（前半，已完成，2026-11-02）**：词汇表（`engine/src/words.ts`、`PlatformAdapter.words`）；核心代码、提示词、注释中不再出现平台名，有测试检查；配置 `platformProfile`、`platformServices`（旧名继续读）。
  - **M2e 后半**（已完成，2026-11-02）：入口 skill 改名为 `/laoshi*`（ADR 0005）；skill 文案改用词汇表，平台自己的一节由适配器提供，安装时渲染（`skills-render.ts`）；skill 也纳入"不写平台名"的检查。
- 内网统一安装验证（2026-11-02 准备好）：[安装与验证清单](../intranet/install-verify.md)、安装脚本、样例项目、离线安装包。
- M2 小结（2026-11-02）：M2a–M2e 已合入。完成标准中"核心中搜不到平台名""M1 的回归全部通过"已满足（有测试）；"同一安装根下两个代码库的需求可同时运行，使用记录能区分代码库和使用者"：记录已带代码库与使用者（M2c），两个代码库同时运行的端到端检查在内网统一验证时补做。本机调度只完成设计。

> **顺序说明（ADR 0006）**：摸高平台就是内部平台，M4 优先于原计划，与 M3 并行；M5 的"生成"排在两个手写适配器之后。

### M3 无头 CLI 运行时（第一个非 Paseo 适配器）
- 每个步骤 agent 是一个编码 agent 命令行的子进程；通知写文件或走外部通知器。
- 同时抽出 `runConformance(adapter)`，让新适配器复用编排测试的期望。
- 完成标准：不依赖 Paseo，在一台只有编码 agent 命令行的机器上跑通一个 `evals/` 用例，"夸大"为零。

### M4 内部平台适配器
- 平台是 CLI 形态（轮询式 `wait`、HITL 映射），映射与缺口见 [internal-platform-adapter](../design/internal-platform-adapter.md)；据此选择声明式描述（[init-bootstrap](../design/init-bootstrap.md)）或手写适配器。
- 前置：该文档 §6 前两个问题（状态来源、HITL 语义）有答案，且已确认引擎进程能在哪里运行、安装根能否放在工作区内（ADR 0007）。
- 第一版**手写**，不生成；生成实验见 M5。
- 完成标准：能力矩阵、探针测试、至少一个端到端用例通过；安装根在工作区内，跨对话无需重装。

### M4b DeepSeek Harness（dsh）适配器
- 形态为"外部引擎 + laoshi dsh 插件"（[ADR 0008](../adr/0008-capability-sources-and-platform-plugin.md)、[dsh-adapter](../design/dsh-adapter.md)）。摸底已完成，见 [dsh 摸底报告](../discovery/dsh/report.md)。
- 引擎只调用插件（插件代为调用，2026-11-01 决定）；插件在 host 内负责会话、在对话下创建子 agent、定时任务和审批；服务与 worktree 使用 M2 的内置实现。
- 与 M4 相互独立：dsh 和摸高是两件事，摸高的底层不是 dsh。
- 前置（正式版）：M2 的运行时层能按来源选择能力。认证方式已定；内网摸底包用真实模型跑过，P02、P13 通过。
- 进展（2026-11-01）：**原型已完成**，见 [adapters/dsh](../../adapters/dsh/README.md)。实现了必需能力，以及在对话下创建子 agent、定时消息、审批；在真实 dsh 上用模拟模型跑通 quick 档流水线。下一步：在内网用真实模型跑 `evals/` 用例；补上 worktree、服务、按角色选择模型（依赖 M2）；确定 Windows 上的 shell 方案（P03c 或团队插件）。
- 进展（2026-11-04）：M2 的内置 worktree、服务已用上；按角色选择模型、列出模型、`providerStatus` 已完成（[dsh-adapter §10](../design/dsh-adapter.md)）；内网统一安装验证进行中（demo 项目全流程已通过）。
- 完成标准：能力矩阵中除契约允许缺失的项外没有 `none`；探针测试转为自动化；用真实模型跑通至少一个 `evals/` 用例，"夸大"为零。

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

## 发布 laoshi（2026-11-05 起）

目标是发布 laoshi 工具包。正式版本号从 **0.1.0** 起（待定项 2 已决定），文档站点参照 paseo-req-kit（待定项 5 已决定）。M3、M4（摸高）、M5、M6 不在 0.1.0 的范围内。

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| R1 | 与 paseo-req-kit 一样从 npm 分发：一步安装 `npx -y [--registry=<镜像>] @yiyi_zhang/laoshi@latest install`（先 npm 全局安装，再运行装好的那份）、`laoshi upgrade [版本]`。`laoshi` 命令（别名 `req`）与安装器 `laoshi install`：按平台渲染 skill 并装进平台的 skill 目录，用标记文件区分是否由 laoshi 安装，不覆盖别人的；平台各自的设置（dsh：插件与挂载）；`--check`、`--uninstall`；升级走 npm。面向使用者的文字从 req-kit 改为 laoshi（兼容用的名字保留） | 进行中 |
| R2 | 文档站点（参照 paseo-req-kit 的 VitePress 站点与指南，改写为 laoshi，覆盖 Paseo 和 dsh）、`laoshi docs` 在本机打开 | 已完成：`site/`（GitHub Pages，`/laoshi/`），指南改写，`CHANGELOG.md`、ADR 索引；内网用 `laoshi docs`（R3 把站点构建进 npm 包） |
| R3 | 发布工程：`package.json` 的发布内容、CHANGELOG、发布流程（打标签后测试并发布到 npm）、站点部署；版本 0.1.0 | 已完成：0.1.1 以 `@yiyi_zhang/laoshi` 发布到 npm（`laoshi` 这个名字 npm 不允许发布，0.1.0 只在 GitHub Release 上）；`release.yml`、`scripts/check-package.mjs`、站点构建进包、Release 附离线安装包；公共 npm 源上实装验证通过。之后的开发版本是 0.2.0-dev |
| 0.1.0 之后 | `laoshi migrate`、paseo-req-kit 2.0 薄分发包、Paseo 插件界面迁入；以 1.0 达到对等为目标（M7） | — |
| 摸高专家 | 为摸高数字工程师挑战赛把 laoshi 做成平台上的专家。沙箱摸底三轮已完成，形态定为 B1：laoshi 引擎加摸高适配器，步骤 agent 用 `aimax run` 起，审批走平台的 HITL，进度来自平台回调；设计与要做的事见 [mogao-expert](../design/mogao-expert.md) | 进行中：摸高适配器（`aimax run`、审批、进度回调、引擎在对话的命令里运行、`laoshi permission`）已完成，假 `aimax` 上端到端通过；下一步是专家的入口 skill 和沙箱里的真实运行 |

## 风险登记

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 内部平台没有可用的接口 | M4、M5 受阻 | 无头 CLI 运行时（M3）兜底；模式 B（M6）作为第二选择 |
| 引擎无法在平台沙箱内运行（无 Node、后台进程被回收、不能调命令行） | 引擎位置需重新设计 | 摸底实验最先验证；备选：引擎放在使用者机器或服务器，沙箱只作步骤执行环境 |
| 工作区外的安装被清理，或平台不能从工作区加载 skill | "一次安装、多库共用"在平台上不成立 | 实验 A 先验证；安装根放工作区内（ADR 0007）；skill 不能直接加载时由适配器在会话开始时从安装根恢复 |
| LLM 生成的适配器质量无先例保证 | 生成实验失败 | 先手写；一致性测试为唯一准入；失败时保留手写适配器 |
| 声明式描述表达力不够 | M5 退化为手写适配器 | 保留"手写适配器"出口；参考适配器作模板 |
| 模式 B 假设不成立 | M6 工作量大增 | M6 设为有条件；先验证再投入 |
| 抽取过程中 1.x 仍在修缺陷，两边漂移 | 回归、缺陷重复 | 路径保持一致；`docs/porting-log.md` 登记；"只接收严重缺陷"的规则 |
| 对外契约被改名破坏插件/IM/汇总 | 现网使用受影响 | [ADR 0004](../adr/0004-external-contracts-stay-stable.md) |
| 内网模型较弱，生成阶段质量差 | 适配器生成失败 | 描述 schema 校验 + 探针；失败时明确提示手写 |
| dsh 在内网装不上或要连外网（声明要求 Node ≥ 24.9，内网现为 22.20，但 22.20 实测可以运行；约 950 MB 的 `@deepseek-ai/*` 依赖、浏览器界面触发的外部请求） | M4b 无法在内网使用 | 先跑内网摸底包（P01 安装、P14 对外连接）；发现外部连接时在 profile 中禁用对应插件，并写进安装器 |
| 内网 Windows 禁止运行 PowerShell；dsh 在 Windows 上默认用 PowerShell 执行命令，而改用 Git Bash 时它在 dsh 的沙箱里起不来（已实测） | M4b 在内网依赖团队的 shell 插件 | 使用内网已有的 shell 插件；确认它的沙箱和审批行为（[dsh-adapter §6](../design/dsh-adapter.md)），不足的部分由 laoshi 的审批策略和危险命令拦截补上；dsh 其余调用 PowerShell 的地方，能配置的写进安装器 |
| dsh 处于开发者预览，接口和插件 API 会有不兼容变更 | M4b 返工 | 插件和运行时声明支持的 dsh 版本范围，由 `doctor` 检查；引擎尽量只和插件通信，少依赖 `/api` 的内部格式（[dsh-adapter §4](../design/dsh-adapter.md)） |

## 待定项汇总（评审时逐条定）

1. ~~skill 名~~：已决定 `/laoshi*`，`paseo-req-kit` 2.0 额外装转发薄 skill（[ADR 0005](../adr/0005-skill-names.md)）。
2. ~~laoshi 版本号~~：已决定，正式版从 `0.1.0` 起（2026-11-05）。
3. **模式 B 的命令集**与"谁调用 `record`"。（[in-chat-orchestration §7](../design/in-chat-orchestration.md)）
4. ~~锁定文件~~：已决定放安装根，不进代码库（[ADR 0007](../adr/0007-one-install-many-repos.md)）。
5. ~~文档站~~：已决定，参照 paseo-req-kit 的站点（2026-11-05）；内网通过 `laoshi docs` 离线查看（R2 决定）。
6. 探针对内部平台的用量与副作用是否可接受。
