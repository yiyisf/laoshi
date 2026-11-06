# 自定义编排流程（Custom Flows）

- 状态：已实现（[ADR 0009](../adr/0009-custom-flows-and-dual-mode.md)）
- 代码：`engine/src/flows.ts`、`engine/src/flow-runner.ts`、`engine/src/flow-cmd.ts`、`engine/flows/`

## 1. 目标与设计原则

laoshi 的默认流程（`orchestration.flow = "default"`）会根据档位（`quick` / `standard`）和需求类型（新需求、缺陷、重构、评估）自动选择步骤。当团队或项目需要**按自己的研发规范裁剪步骤、调整顺序，或加入专属步骤（如安全审计、合规检查、接口契约审阅）**时，可以用声明式 JSON 定义编排流程，而无需修改引擎代码。

核心原则：
1. **声明式且可静态校验**：流程文件是纯 JSON（`schema: 1`），`laoshi flow validate` 和 `laoshi doctor` 在运行前就能检查出未知步骤、重复步骤、条件引用了未出现在前面的步骤、缺少收尾步骤（`report`）等问题。
2. **不削弱确定性保障**：无论是内置步骤还是自定义步骤，提示词组装、结果文件 schema 校验、质量门（`checks`）和密钥扫描（`secretScan`）都由引擎确定性执行。
3. **两种编排模式无缝共用**：同一个流程定义既可以由后台引擎自动驱动（模式 A，`laoshi start --flow <名称>`），也可以在会话内一步步推进（模式 B，`laoshi run next --flow <名称>`）。

## 2. 发现路径与选择优先级

### 查找顺序（同名时前者覆盖后者）
1. **项目级**：`<repo>/.laoshi/flows/<name>.json`（随项目仓库提交，团队共享）
2. **安装级**：`<LAOSHI_HOME>/flows/<name>.json`（本机所有项目共用）
3. **内置模板**：`engine/flows/<name>.json`（随安装包提供：`standard`、`quick`、`hotfix`、`doc-only`）

### 选择优先级
1. 命令行参数：`--flow <名称>`
2. 续跑状态：已存在的 `state.flow`（保证续跑或模式 B 下一步不会中途换流程）
3. 需求说明 `spec.md` 头部：`- 流程：<名称>`
4. 配置项：`orchestration.flow`（支持本机、团队、项目 `.laoshi.json` 三层配置，默认 `"default"`）

## 3. 流程定义 Schema（`schema: 1`）

```json
{
  "schema": 1,
  "name": "sec-standard",
  "title": "带安全审计的标准流程",
  "description": "在代码实现后增加安全审计步骤，高危问题直接进修复循环。",
  "steps": {
    "security_audit": {
      "title": "5b-安全审计",
      "role": "reviewer",
      "prompt": "prompts/security-audit.md",
      "gate": false,
      "timeoutMinutes": 20,
      "result": {
        "status": ["pass", "needs_fix"],
        "summary": "string"
      }
    }
  },
  "flow": [
    { "step": "design" },
    {
      "loop": {
        "check": "design_review",
        "fix": "design_revise",
        "rounds": "profile.designReview",
        "until": { "status": ["pass"] },
        "order": "check-first"
      }
    },
    { "checkpoint": "approval", "mode": "config" },
    { "step": "implement" },
    {
      "step": "security_audit",
      "when": { "profile": ["standard"] }
    },
    {
      "loop": {
        "check": "code_review",
        "fix": "review_fix",
        "rounds": "profile.codeReview",
        "until": { "status": ["pass"], "blocking_count": [0] },
        "order": "check-first"
      }
    },
    { "step": "handoff" },
    { "checkpoint": "phase" },
    { "step": "service_start", "when": { "profile": ["standard"] } },
    { "step": "verify" },
    {
      "loop": {
        "check": "verify",
        "fix": "defect_fix",
        "rounds": "profile.defectFix",
        "until": { "status": ["pass"] },
        "order": "fix-first"
      },
      "when": {
        "result": { "step": "verify", "field": "status", "equals": "fail" }
      }
    },
    { "step": "report" }
  ]
}
```

### 3.1 节点类型（`flow` 数组）
- **单步节点（`StepNode`）**：`{ "step": "<id>", "when"?: FlowCondition, "gate"?: boolean }`
  - 内置步骤 ID：`design`、`design_review`、`design_revise`、`implement`、`code_review`、`review_fix`、`handoff`、`service_start`、`verify`、`defect_fix`、`report`。
  - 也可引用 `steps.<id>` 中声明的自定义步骤。
  - `gate: true` 会在该步完成后运行质量门（`checks`）与密钥扫描（`secretScan`）。
- **循环节点（`LoopNode`）**：
  - `order: "check-first"`：先运行 `check`，未满足 `until` 时运行 `fix`，最多 `rounds` 轮（如 `design_review ⇄ design_revise`、`code_review ⇄ review_fix`）。若 `check` 返回 `status: "blocked"`，立即按需求方待决定（`waiting_for_business`）暂停。
  - `order: "fix-first"`：在首次 `verify` 失败后使用，先运行 `fix`（如 `defect_fix`）再复验 `check`（如 `verify`），直至满足 `until` 或达到 `rounds` 上限。
  - `rounds` 可以是正整数（`1`–`10`），或引用当前档位配置：`"profile.designReview"`、`"profile.codeReview"`、`"profile.defectFix"`。
- **检查点节点（`CheckpointNode`）**：
  - `{ "checkpoint": "approval", "mode"?: "config" | "always" }`：方案确认点（`preview.md`），等待需求方执行 `laoshi approve` 或 `laoshi run approve`。
  - `{ "checkpoint": "phase" }`：研发阶段与测试验证阶段的分界点；`phases.mode` 为 `gated` 时停在 `phase_done` 等待提测，为 `develop-only` 时直接跳去写报告。

### 3.2 条件守卫（`when`）
节点上的 `when` 全部满足时才执行，否则跳过：
- `profile`: `["quick"]` 或 `["standard"]`
- `type`: `Array<"feature" | "defect" | "refactor" | "assessment">`（`"feature"` 代表普通新需求/小改动，即 `state.type === null`）
- `result`: `{ "step": "<前序步骤 ID>", "field": "<结果字段>", "equals"?: Scalar, "in"?: Scalar[] }`（取该步骤最新一轮的结果字段比较）

### 3.3 自定义步骤（`steps.<id>`）
- `title`：显示在状态、日志和子 agent 标题中的名称（如 `"5b-安全审计"`）。
- `role`：`"builder"` 或 `"reviewer"`（决定使用哪个配置的 agent profile）。
- `prompt`：提示词内容或相对路径（依次在 `<repo>/.laoshi/`、`<repo>/.requirement-pipeline/prompts.local/`、`<LAOSHI_HOME>/` 下查找 `.md` 文件；找不到文件时将字符串本身作为内联 Markdown 提示词）。支持 `{{FEATURE_DIR}}`、`{{REPO_DIR}}`、`{{RESULT_FILE}}`、`{{STEP_ID}}`、`{{STEP_TITLE}}`、`{{PROFILE}}` 占位符。
- `result`：结果 JSON 文件的字段校验契约，键为字段名，值为：
  - `"string"` | `"number"` | `"boolean"` | `"string[]"`
  - 非空字面量数组（枚举，如 `["pass", "needs_fix"]`）
- `optional`（默认 `false`）：为 `true` 时该步骤失败只记录警告，不中断整条流水线。
- `gate`（默认 `false`）：为 `true` 时在该步骤结束后执行质量门与密钥扫描。
- `timeoutMinutes`（可选）：该步骤的超时时间（分钟）。

## 4. CLI 命令（`laoshi flow`）

```bash
laoshi flow list [--repo <dir>] [--json]                 # 列出当前项目可用的所有流程及来源
laoshi flow show <name> [--repo <dir>] [--json]          # 查看流程的节点、步骤与条件详情
laoshi flow validate <name-or-file> [--repo <dir>]       # 校验流程定义是否合法
laoshi flow init <name> [--from standard|quick|hotfix|doc-only] [--force]
                                                         # 在 .laoshi/flows/<name>.json 生成可编辑的流程文件
```
