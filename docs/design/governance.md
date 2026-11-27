# 组织治理与流程合规设计（P2：0.4 只报告版 → 0.5+ 演进）

- 状态：待评审（0.4 实施前置设计）
- 依据：[Roadmap 第 4.2、5 节](../roadmap.md#42-管理方团队负责人技术领导质量负责人-04p2重点)、[ADR 0004](../adr/0004-external-contracts-stay-stable.md)、[ADR 0007](../adr/0007-one-install-many-repos.md)、[ADR 0008](../adr/0008-capability-sources-and-platform-plugin.md)
- 覆盖范围：`G1` 流程合规审计、`G2` 组织策略、`G3` 合规与效能报告页、`G4` 团队汇总第一步、`G5` 安全事件汇总

---

## 1. 定位、原则与分期

laoshi 已经能把单个需求稳定跑完，并记下了每次运行的用时、token、返工与人工评审/验收事件（`usage/runs.jsonl`，见 [usage-record.md](../../contracts/usage-record.md)）。当团队规模扩大或纳入正式研发流程后，团队负责人与质量负责人还需要回答四个问题：

1. **过程是否合规**：有没有跳过阶段、跳过质量门、绕过人工评审、改需求后未重审、或带着失败检查强行通过？
2. **安全边界是否守住**：密钥扫描命中、危险命令拦截、步骤审批批准/拒绝发生在谁、哪个仓、是什么原因？
3. **团队是否偏离预设规范**：各代码库使用的模型、预算、必选检查与扩展步骤是否符合组织约定？
4. **如何跨人、跨仓汇总**：在不搭建复杂中心服务的前提下，团队版（共享安装根）与多台个人机如何拉出同一口径的报告？

### 核心设计原则

1. **0.4 第一版只做报告，不改变默认流水线行为**：只记录事实、评估策略并展示报告；**不因策略拦截或拒绝运行**（"禁止/强拦"模式留给 `0.5+` 基于真实数据误报率再决定）。
2. **事实与裁决分离**：底层永远先记客观事件（发生了什么、谁触发、何时、附带什么依据），再由纯函数对照当下的 `policy` 判定是否偏离。即使团队调整了 `policy`，历史事实仍然可按新旧策略重算，不丢失上下文。
3. **以现有契约与组件为基础，不另起炉灶**：
   - 沿用 [ADR 0007](../adr/0007-one-install-many-repos.md) 的安装根模型：个人机默认在 `~/.laoshi/`，团队版共用一个持久安装根，天然共享同一份 `audit/`；
   - 沿用 [ADR 0004](../adr/0004-external-contracts-stay-stable.md)：对外 JSON 与事件契约维持 `schema: 1`，只增不删；
   - 沿用 `M3` 受控流程扩展（`extensions`）：组织要求的必选检查或流程扩展直接作为策略检查基线；
   - 沿用 `0.3` 抽出的共享视图层（`ui/shared/view-model.ts`、`ui/web/board.ts`、`adapters/paseo/plugin/`），避免为 Paseo 与 dsh 写两套报告 UI。
4. **失败隔离与最小采集**：审计写入保持 best-effort（写入异常最多记本地警告，绝不阻断正在开发的流水线）；禁止写入源码片段、会话原文与密钥明文，复用 [diagnose.ts](../../engine/src/diagnose.ts) 的 `redactText` 对自由文本脱敏。

### 0.4 与 0.5+ 分期边界

| 能力 | 0.4（只报告版，本次设计主体） | 0.5+（按 0.4 反馈决定是否开启） |
| --- | --- | --- |
| 审计日志 | `audit/events.jsonl` 追加写，`schema: 1` | 可选追加哈希链（`prevHash` / `hash`）防事后手工篡改 |
| 组织策略 | `policy.mode = "report"`（校验配置 + 标注偏离 + 在 `doctor` 与报告页展示） | 新增 `policy.mode = "enforce"`（对未满足策略的操作拒绝启动或要求输入覆盖理由） |
| 审批策略收敛 | 将 dsh 插件的 `approvals` 与 `config.json` 的 `policy.approvals` 对齐展示，提示差异 | 由安装级 `policy.approvals` 统一收口并覆盖平台插件策略 |
| 团队汇总 | 同安装根直接按 `user`/`codebase` 分组；个人机支持 `--export` / `--merge` | 若出现多个团队安装根再评估只读汇总服务（`G4` 第二步） |

---

## 2. G1：流程合规审计（`<LAOSHI_HOME>/audit/events.jsonl`）

### 2.1 存储与写入约定

- **文件位置**：`<LAOSHI_HOME>/audit/events.jsonl`（每行一个独立 JSON 对象，UTF-8，仅追加 `fs.appendFileSync`，不回改已有行）。
  - **为什么不混写入 `usage/runs.jsonl`**：运行与效能统计允许 `outcomes` 扫描补记和去重裁剪，关注耗时与用量；合规与安全事件需要独立保留（即使未跑完流水线也要立即落盘，例如在 `laoshi permission` 或危险命令发生当下就记录），且便于后续 `0.5+` 单独施加只读追加权限或哈希链。
- **不记入的情况**：`REQ_KIT_NO_RECORD=1` 或 `true` 时不写（`evals` 与隔离测试不污染本机审计账本）。
- **并发与顺序**：单行短 JSON（通常 `< 2 KB`）一次 `appendFileSync` 写入；以全局递增或高熵 `id` + ISO-8601 UTC `at` 标识每条事件，归并时按 `id` 幂等去重。
- **禁止落盘内容**：
  - 不写私钥/口令/环境变量值（命令行参数与提示信息经过 `redactText` 脱敏）；
  - 不写代码 diff 或需求原文，只写文件路径、规则名、数值摘要或截断并脱敏后的简短理由（`<= 500` 字符）。

### 2.2 审计事件结构（`schema: 1`）

```json
{
  "schema": 1,
  "id": "aud_20261127T011500Z_8f3a1c2b",
  "at": "2026-11-27T01:15:00.412Z",
  "machine": "dev-win-01",
  "kitVersion": "0.4.0",
  "user": "zhangsan",
  "codebase": { "root": "D:/work/orders", "remote": "git@git.internal:core/orders.git" },
  "requirement": {
    "key": "3f2a9c1e5b7d4e8a",
    "project": "orders",
    "name": "20261127-refund",
    "title": "退款接口幂等改造",
    "type": "standard",
    "profile": "quick"
  },
  "category": "deviation",
  "code": "quality_gate_skipped_checks",
  "severity": "warn",
  "actor": "pipeline",
  "reason": "项目未配置 qualityGate 检查命令（checks 为空），跳过自动门禁",
  "details": {
    "attempt": 1,
    "configuredChecks": 0
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `schema` / `id` / `at` | 固定为 `1`；唯一事件 ID（用于合并去重）；ISO UTC 时间 |
| `machine` / `kitVersion` | 主机名与运行时的 laoshi 版本 |
| `user` / `codebase` | 与 `usage/runs.jsonl` 保持完全同源（`engine/src/identity.ts`）；安装级/无仓库事件时 `codebase` 和 `requirement` 可为 `null` |
| `requirement` | 关联需求的 `{ key, project, name, title, type, profile }`，便于按仓库和需求反查 |
| `category` | `"deviation"`（流程偏离，G1）、`"security"`（安全事件，G5）、`"policy"`（策略状态快照/背离，G2） |
| `code` | 稳定的机器可读事件码（见下表） |
| `severity` | `"info"`（事实记录，如批准了一次普通权限）、`"warn"`（偏离或告警命中）、`"high"`（高风险命中，如密钥未清除即收尾、生产环境危险命令、带着失败门禁放行） |
| `actor` | 谁引发了该事件：`"requester"` / `"reviewer"` / `"operator"` / `"agent"` / `"pipeline"` / `<具体用户名>` |
| `reason` | 人类可读原因或操作人填写的说明（经 `redactText` 脱敏）；若人未填理由则记为 `null` 并在报告中显式标记"未说明理由" |
| `details` | 按 `code` 约定的结构化负载（见 §2.3） |

### 2.3 事件码清单（0.4 首版）

#### A. 流程偏离事件（`category: "deviation"`）

| `code` | 默认级别 | 何时写入（对应现有代码位置） | 关键 `details` 字段 |
| --- | --- | --- | --- |
| `phase_skipped` | `warn` | `launch.ts` / `main.ts`：启动或完成时采用 `phases.mode = "develop-only"` 跳过集成验证阶段，或 `verify` 阶段直接跳过未跑完的必需步骤 | `{ mode, skippedPhase }` |
| `design_approval_bypassed` | `warn` | `pipeline.ts`：`designApproval.mode = "off"` 时未做方案确认即进入实现；或 `autoContinueHours` 超时后由系统自动放行（`approval.auto === true`） | `{ mode, autoContinued, autoContinueHours }` |
| `quality_gate_not_configured` | `warn` | `pipeline.ts`：进入编码步骤时 `config.checks.length === 0`（无自动门禁） | `{ attempt }` |
| `quality_gate_failed_continue` | `high` | `pipeline.ts`：`gate` 检查存在新失败且超出 `qualityGate.fixAttempts` 后仍继续向下一阶段推进或结束 | `{ attempt, failedChecks: string[] }` |
| `review_skipped_or_bypassed` | `warn` | `main.ts` / `pipeline.ts`：`specReview = "off"`，或配置了 `reviewPanel` 但首轮实际未运行，或未通过 AI/人工评审即直接合并 | `{ step, configFlag }` |
| `forced_pass` | `high` | `outcomes.ts` / `checklist-cmd.ts` / 看板操作：存在未关闭失败项或 `outcome !== "completed"`（如 `completed_with_issues`），仍提交通过结论或手工标记合入主干（`--merged`） | `{ outcome, unchecked, failed }` |
| `requirement_changed_no_reapproval` | `warn` | `reply.ts`（`--change`）/ `pipeline.ts`：需求已通过 `designApproval` 后发生需求变更（生成 `changes.md`），后续却绕过重新确认方案继续编码 | `{ changeAt, specVersion }` |
| `extension_skipped_or_failed` | `warn` | `extensions.ts` / `pipeline.ts`：配置的受控流程扩展（`extensions`）在对应钩子执行失败但继续流水线，或因配置错误未能执行 | `{ extensionId, kind, after, error }` |
| `policy_mismatch` | `warn` | `main.ts` 启动运行与 `governance` 求值：本机/项目生效配置与组织策略 `policy` 不符（如模型不在白名单、未开启人工评审等，详见 §3） | `{ rule, expected, actual }` |

#### B. 安全事件（`category: "security"`，支撑 G5）

| `code` | 默认级别 | 何时写入（对应现有代码位置） | 关键 `details` 字段 |
| --- | --- | --- | --- |
| `secret_scan_hit` | `warn` / `high` | `pipeline.ts`（`secretScans` 写入时）：密钥扫描发现潜在密钥/凭据；若历经修复轮次后 `passed === false`，级别升为 `high` | `{ stepKey, attempt, findingsCount, rules: string[], fixRounds, passed }`（绝不记录匹配原文） |
| `danger_command` | `warn` / `high` | `pipeline.ts`（`dangerGuard` 命中时）：步骤 agent 运行或尝试运行匹配危险命令规则的命令；若 `ran === true` 或命中 `dangerGuard.production` 主机列表，级别为 `high` | `{ stepKey, label, ran, matchedRule, commandPreview }`（`commandPreview` 经 `redactText` 脱敏并截断至 200 字） |
| `permission_decision` | `info` / `warn` | `permission-cmd.ts` / `dsh-runtime.ts`（`answerPermission` 与自动审批策略）：产生审批决定——包括人在终端批准/拒绝，以及由插件策略自动放行（`approvals: "allow"`）；自动放行时记为 `warn`，人为拒绝记为 `info` | `{ stepKey, decision: "approve" \| "deny", mode: "manual" \| "policy_allow", requestsCount }` |

> **说明**：`review`、`acceptance`、`merge`、`issue` 这 4 类"正常研发轨迹事件"继续记在 `usage/runs.jsonl`；只有当它们涉及偏离（如带未决问题强行验收/标记合入 -> `forced_pass`）或安全命中时，才向 `audit/events.jsonl` 追加审计事件，避免双份冗余。

---

## 3. G2：组织策略配置（`policy`，仅安装级配置）

### 3.1 放置层级与覆盖约束

- 按 [ADR 0007](../adr/0007-one-install-many-repos.md)，**`policy` 只能写在安装级配置（`<LAOSHI_HOME>/config.json`）中**（团队版中安装级配置由团队管理员维护）。
- 在 [engine/src/config.ts](../../engine/src/config.ts) 中把 `"policy"` 加入 `NOT_IN_PROJECT_KEYS`（与 `notifiers`、`integrations`、`push`、`factory`、`people` 同级）：项目仓库里的 `.laoshi.json` 如果试图改写 `policy`，加载器直接忽略并在 `laoshi doctor` 与审计事件中记录忽略项。

### 3.2 `policy` 配置结构（0.4 Schema）

```json
{
  "policy": {
    "mode": "report",
    "requireHumanReview": ["standard"],
    "requireQualityGate": true,
    "requireDesignApproval": "ui",
    "requireExtensions": ["compliance-check"],
    "allowedModels": ["deepseek/*", "claude/*"],
    "maxBudgetTokens": 4000000,
    "approvals": "ask"
  }
}
```

| 字段 | 类型与默认值 | 0.4 行为（只报告） |
| --- | --- | --- |
| `mode` | `"off" \| "report"`，默认 `"off"`（未配置 `policy` 等效关闭；`0.5+` 预留 `"enforce"`） | `"off"` 时仅写事实与安全事件，不做策略比对；`"report"` 时启用全部规则比对，记录 `policy_mismatch` 并展示在报告与 `doctor` 中 |
| `requireHumanReview` | `ProfileName[]`（如 `["standard"]`），默认 `[]` | 检查对应档位已完成需求是否至少有 1 条人工代码评审或验收记录，缺失则计为偏离 |
| `requireQualityGate` | `boolean`，默认 `false` | 为 `true` 时，启动流水线发现 `checks` 为空或出现 `quality_gate_failed_continue` 时记录 `policy_mismatch` |
| `requireDesignApproval` | `"off" \| "ui" \| "always"`，默认 `"off"` | 当实际配置的 `designApproval.mode` 低于要求等级（顺序：`always > ui > off`）时，记录 `policy_mismatch` |
| `requireExtensions` | `string[]`（必填扩展步骤 ID），默认 `[]` | 启动前检查合并后的 `extensions` 是否包含这些 `id`；缺席或执行失败记 `policy_mismatch` / `extension_skipped_or_failed` |
| `allowedModels` | `string[] \| null`（支持末尾 `*` 通配前缀，匹配 `provider/model`），默认 `null`（不限制） | 检查生效的 `builder` / `reviewer` / `fallback` / `reviewPanel`；不在白名单内的直配模型记录 `policy_mismatch`（若使用 `platformProfile` 且无法预解析模型名称，则在步骤记录实际 `agent` 时补充判定） |
| `maxBudgetTokens` | `number \| null`，默认 `null`（不限制） | 当 `config.budget.tokens === null` 或大于 `maxBudgetTokens`，以及单需求实际消耗超过上限时记录 `policy_mismatch` |
| `approvals` | `"ask" \| "allow" \| null`，默认 `null` | 预期审批策略；0.4 阶段如 `dsh` 插件侧配置为 `allow` 而策略要求 `ask`，在 `laoshi doctor` 与报告页高亮提示 |

### 3.3 策略求值器（`engine/src/governance.ts`）

- 新增纯函数 `evaluatePolicy({ config, runtimeAgents, runs, events, extensions })`：
  - **运行前静检**：输入生效后的 `PipelineConfig` 与扩展列表，返回当下静态合规问题（供 `laoshi doctor` 展示，供 `main.ts` 在启动时记录 `policy_mismatch`）；
  - **报告期动态核算**：输入指定周期内的 `RunRecord[]`、`AuditEvent[]` 与 `policy`，统计"完全合规需求数 / 有偏离需求数 / 偏离分布 / 违例明细"，保证即使 `policy` 是后来配上的，也能立即在历史运行上算出合规率（0.4 只读求值，零副作用）。

---

## 4. G3 & G5：合规与效能报告（CLI + API + Paseo / dsh 共用视图）

### 4.1 命令行与程序接口（CLI / `cli-json`）

遵循既有 `laoshi stats` 与 `contracts/cli-json.md` 约定，新增只读子命令 `laoshi governance` 与 `laoshi api governance`：

```sh
laoshi governance [--since 30d|2026-10-01] [--month 2026-10] [--by user|codebase|requirement] [--json] [--report [--out <目录>]]
laoshi governance --export [<文件>]
laoshi governance --merge <文件…> [--report [--out <目录>]]
laoshi api governance [--since 30d] [--month 2026-10]
```

- **时间窗口**：复用 `engine/src/stats.ts` 的 `parsePeriod`，与 `laoshi stats` 完全一致（默认最近 30 天，支持 `--since` / `--month` / `all`）。
- **JSON 输出契约（`schema: 1`）**：

```json
{
  "schema": 1,
  "period": { "from": "…", "to": "…", "label": "最近 30 天" },
  "policy": { "configured": true, "mode": "report" },
  "summary": {
    "requirementsTotal": 18,
    "compliantCount": 14,
    "complianceRate": 0.778,
    "deviationCount": 6,
    "highSeverityCount": 1,
    "security": { "secretHits": 2, "secretUnresolved": 0, "dangerCommands": 1, "autoApprovedPermissions": 3 }
  },
  "byDimension": {
    "users": [ /* { user, requirements, deviations, highSeverity, cycleMedianHours, reworkRate, securityHits } */ ],
    "codebases": [ /* { project, remote, requirements, deviations, gateFailRate, securityHits } */ ],
    "codes": [ /* { code, label, category, severity, count, lastAt } */ ]
  },
  "events": [ /* 按时间倒序的脱敏 AuditEvent 列表（默认最近 200 条） */ ]
}
```

- **`--report` 导出**：生成 `governance-report.md`（管理汇总：合规率、高危事件、按人与代码库矩阵、效能对比）与 `governance-events.csv`（每条审计事件一行，UTF-8 BOM 兼容 Windows Excel 打开）。
- **与 IM 定时播报打通（G3 + 已有 `notifiers`）**：在 `laoshi digest --notify`（可选加 `--with-governance`）及 `digest` 周期任务中，可选附带本期合规率与高危安全事件条数摘要，直接走已有的 [notifier-event.md](../../contracts/notifier-event.md) `digest` 通道发往企业内部 IM，无需新建一套通知协议。

### 4.2 Paseo 与 dsh 共用界面接入（共享视图层 + Web 看板 / Paseo 插件）

延续 `M4` 共用设计，报告页挂在现有的 **「使用统计」** 顶栏页签内部，拆分为两个清晰分段，**同时服务于 `laoshi board`（及 `dsh` 内嵌 `/laoshi/` 看板）和 Paseo 插件**：

1. **后端只读数据通道**：
   - 看板服务端（`engine/src/board.ts`）新增 `GET /api/governance?since=30d&user=...&project=...`，直接调用 `engine/src/governance.ts`；
   - Paseo 插件合约（`adapters/paseo/plugin/shared/contracts.ts` 与 `handlers.ts`）新增只读 RPC，转调 `laoshi api governance`。
2. **界面信息架构（「使用统计 → 合规与安全」分栏）**：
   - **顶部筛选器**：时间范围（7 天 / 30 天 / 本月 / 全部）、人员（`全部 / 张三 / …`）、代码库（`全部 / orders / …`）、事件类型（`全部 / 偏离 / 安全`）。
   - **4 张 Bento 核心卡片**：合规率（及达标/总需求数）、流程偏离次数（标注高危数）、安全命中（密钥拦截/危险命令/自动审批次数）、合规需求与偏离需求的中位交付周期对比。
   - **按人 / 按代码库对比表**：同屏对照效能指标（需求数、交付周期、返工率、平均等待）与合规指标（偏离次数、高危数、主要偏离类型）。
   - **事件明细流（倒序，点击展开摘要）**：展示时间、操作人/发起人、代码库、关联需求（支持直接点击跳进需求全宽详情页）、事件码中文说明、级别徽章与经脱敏的触发理由；在 `readOnly` 只读模式下保持完整可查，不暴露任何改写动作。

---

## 5. G4：团队汇总（0.4 第一步）

依据 [ADR 0007](../adr/0007-one-install-many-repos.md)，laoshi 的个人版与团队版共用同一套数据结构，0.4 的团队汇总采用零运维的"两条路径、同一套聚合引擎"：

1. **场景 A：团队版（多人共用一个安装根，如团队共享沙箱或集中目录）**
   - 每个人的每一次运行都由适配器的 `userEnv` 或 `LAOSHI_USER` 写入各自 `user` 字段，`audit/events.jsonl` 与 `usage/runs.jsonl` 原生汇聚在同一个 `<LAOSHI_HOME>` 中；
   - 在本机（或团队任意成员界面上）打开「合规与安全」页或执行 `laoshi governance --by user`，直接看到全团队数据，无需任何导入导出。
2. **场景 B：分散在多台个人开发机 / 内网 Windows**
   - 各成员定期执行导出：
     - `laoshi governance --export team-zhangsan.json --since 30d`（导出对象含 `schema: 1`、`machine`、`user`、`period`、`runs`、`events`、`auditEvents`，**复用并向后兼容 `stats --export` 的 JSON 格式**——若只传给旧版 `stats --merge` 也能平滑忽略 `auditEvents`）；
   - 团队负责人统一合并出报告：
     - `laoshi governance --merge ./exports/*.json --report --out ./monthly-report`
     - 合并引擎在内存中按 `auditEvent.id` 与 `run.requirement.key + startedAt + machine` 幂等去重，生成同一口径的团队合规率与安全汇总。

---

## 6. 边界、脱敏与非目标

1. **严格守住平台隔离与测试红线**：`engine/src/governance.ts` 与相关模块严禁出现任何平台名称（Paseo / dsh / 摸高），确保 `engine/test/platform.test.ts` 持续通过；审批配置差异等平台侧展示通过适配器接口或通用文案表达。
2. **安全与隐私边界**：
   - 不记录代码片段、不记录聊天原文、不记录匹配到的密钥值、不记录仓库外任意文件路径；
   - `reason` 与 `commandPreview` 写入前强制经 `redactText()` 处理并限制长度。
3. **0.4 明确不做**：
   - 不搭建中心化 Web 收集服务器或数据库（G4 第二步留到 P4）；
   - 不实施硬阻断式拦截（`enforce` 模式与强制写覆盖理由留到 `0.5+`）；
   - 不做复杂的哈希链/数字签名校验（留到 `0.5+` 按需开启）；
   - 不回写 ALM / 外部需求管理系统的合规字段（属于 `G6`，留待后续评估）。

---

## 7. 0.4 分阶段实施拆解与验收标准

建议拆成 **4 个小粒度 PR** 顺序合入 `main`，每个 PR 独立可测、可合并：

| 阶段 | 包含范围 | 核心文件 | 验收重点 |
| --- | --- | --- | --- |
| **PR 1（G1 审计底座）** | `audit/events.jsonl` 读写与导出结构、9 类偏离 + 3 类安全事件打点、脱敏与 `REQ_KIT_NO_RECORD=1` 开关 | `engine/src/audit.ts`、`main.ts`、`pipeline.ts`、`permission-cmd.ts`、`reply.ts`、`outcomes.ts` | 单元测试覆盖全部 12 类事件码落盘与 `redactText` 脱敏；现有全量测试零回归 |
| **PR 2（G2 组织策略）** | `config.ts` 新增 `policy` 结构与校验（加入 `NOT_IN_PROJECT_KEYS`）、`governance.ts` 静/动态求值器、`doctor.ts` 策略与冲突检查展示 | `engine/src/config.ts`、`engine/src/governance.ts`、`engine/src/doctor.ts` | 单测验证项目配置覆盖 `policy` 被忽略并告警、模型白名单通配符、需求分级检查判定准确 |
| **PR 3（G4/G5 聚合、CLI 与 API）** | `laoshi governance` 与 `laoshi api governance`、按人/仓/规则聚合、`.md` / `.csv` 报告生成、`--export` / `--merge` 跨机去重合并 | `engine/src/governance.ts`、`engine/src/api.ts`、`bin/req.mjs`、`contracts/cli-json.md` | 模拟多机含重复事件的导出合并包，验证去重幂等性、BOM CSV 编码及 JSON `schema: 1` |
| **PR 4（G3 Paseo & dsh 共用报告视图）** | 共享统计数据结构扩展、Web 看板 `/api/governance` 与「合规与安全」子视图、Paseo 插件只读 RPC 与同构展示 | `ui/shared/view-model.ts`、`engine/src/board.ts`、`ui/web/board.ts`、`adapters/paseo/plugin/` | Web 看板与 Paseo 插件同步展示合规率、按人/仓对比表及筛选，只读模式完全可用 |

### 0.4 完成标准（对照 Roadmap §5）

使用一个团队的多人/多代码库真实（或回放）数据，在 **命令行（`laoshi governance --report`）、Web 看板 / dsh 内嵌面板、Paseo 插件** 三处都能看到按人和代码库维度的合规与效能汇总，清晰列出阶段完成情况、安全事件统计以及各类偏离明细（谁、何时、做了什么、理由是什么）。

---

## 8. 待评审拍板的问题（进入 0.4 PR 1 前确认）

1. **`policy` 配置归属与示例规则默认值**：默认未写 `policy` 时仅记录安全事件与客观事实（`policy.mode = "off"`），还是即使未写 `policy` 也默认按基础规范记录偏离（`requireHumanReview` 为空，但跳过质量门/跳过阶段/带问题强行通过仍记 `deviation`）？（建议：**基础流程偏离事件默认始终客观记录，不受 `policy` 开关影响；`policy` 仅控制组织级规则如模型白名单、强制评审档位、强制扩展 ID 的 `policy_mismatch` 判定**。）
2. **多台机器团队汇总的默认采集方式**：`0.4` 先只支持手工/脚本定时 `laoshi governance --export` 后再用 `--merge` 汇总，是否足够覆盖当前内网团队场景，还是需要同时在安装级配置里支持一个可选的 `audit.exportDir`（如指向团队共享盘目录，每次运行结束顺便追加一份导出）？
3. **`laoshi doctor` 的策略提醒粒度**：当项目配置或本机模型不符合 `policy` 时，`0.4` 只报告模式下 `doctor` 统一输出为 `⚠`（警告，不失败退出 code=1），以免阻塞日常使用，是否符合预期？
