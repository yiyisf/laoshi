# 适配器指南

- 状态：提议
- 前置阅读：[agent-runtime.md](../../contracts/agent-runtime.md)（能力契约）、[architecture.md](architecture.md)

为一个新的 agent 平台写适配器，需要交付五样东西：**运行时、能力声明、会话识别、体检、词汇表**。

## 1. 适配器的形状（草案）

```ts
interface PlatformAdapter {
  id: string;                       // 例如 "paseo"
  displayName: string;              // 面向使用者，例如 "Paseo"
  /** 平台版本范围，体检时检查，不强制 */
  compatibleWith?: string;

  createRuntime(input: RuntimeFactoryInput): Promise<AgentRuntime>;

  /** 声明实现了哪些可选/按需能力（名称见下表），未声明的视为不支持 */
  capabilities: CapabilityName[];

  /** 从环境识别"发起会话"；识别不了返回 null（此时只写日志，不发通知） */
  identifyOrigin(env: NodeJS.ProcessEnv, cwd: string): { sessionId: string; cwd: string } | null;

  /** 适配器自己的体检项，由通用体检调用 */
  doctor(ctx: DoctorContext): Promise<DoctorItem[]>;

  vocabulary: PlatformVocabulary;   // 见 platform-vocabulary.md

  /** 入口 skill 要安装到哪些目录 */
  skillTargets(): SkillTarget[];

  /** 适配器私有配置（platform.<id>）的 JSON Schema，用于校验与 `laoshi configure` */
  configSchema?: object;
}
```

这是设计草案，字段以实现时 `src/runtime/adapter.ts` 的类型为准。

## 2. 能力声明

必需能力（`verifyOrigin`、`startAgent`、`StepAgent.*`、`attachAgent`、`notifyAgent`、`interruptAgent`、`close`）必须全部实现，不需要声明。可选和按需能力用名称声明：

| 名称 | 对应方法 |
| --- | --- |
| `profiles` | `listPaseoProfiles`（将更名为中性名） |
| `services` | `listServices`、`startServices`、`stopServices` |
| `worktree` | `createWorktree`、`waitForWorkspaceSetup` |
| `scheduling` | `scheduleMessage`、`cancelSchedule` |
| `scheduleAgent` | `scheduleNewAgent` |
| `sessionAgent` | `startSessionAgent` |
| `quota` | `providerQuota` |
| `activity` | `recentActivity` |
| `runningTool` | `runningTool` |
| `toolInfo` | `capabilities` |
| `providerStatus` | `providerStatus` |

运行时层按声明包装适配器：**未声明的能力，对应方法统一返回 `null`**（或按契约文档中标 ⚠ 的方式处理），调用点不再各写各的 `.catch(() => null)`。这是把 req-kit 里分散的降级收拢到一处。

## 3. 会话识别

req-kit 靠环境变量 `PASEO_AGENT_ID`、`PASEO_AGENT_CWD` 识别"当前对话"。适配器通过 `identifyOrigin` 提供同样的信息。没有"会话"概念的平台：返回 `null`，引擎仍可运行，只是进展写日志而不发回会话；或者由适配器自行定义一个"发起者"。

## 4. 体检

`laoshi doctor` 分两部分：

- **通用体检**：安装、本机配置、项目配置、进行中的流水线、状态文件版本、集成（这些来自现在 `doctor.ts` 中与平台无关的部分）。
- **适配器体检**：由 `adapter.doctor` 返回。Paseo 适配器会包含 daemon 连接、版本区间、profile 解析、`paseo.json` 检查这四块（现在都在 `doctor.ts` 里，与通用检查混在一起，需要拆开）。

体检项的输出格式沿用 ✓ / ⚠ / ✗ 加修复建议。

## 5. 一致性测试

新适配器必须通过：

1. **编排测试**（`engine/test` 中基于 `fake-runtime.ts` 的用例）。注意它测的是核心对运行时的期望，适配器作者应当用同一套期望检查自己的实现（计划抽成可复用的 `runConformance(adapter)`）。
2. **探针测试**（真实平台上运行，需要一个临时目录和少量用量）：
   - 创建一个子 agent，要求它写一个文件，`wait` 到 idle，检查文件落在 `cwd` 下；
   - `followUp` 一次；`notifyAgent` 一次且不打断；`interruptAgent` 一次；
   - 声明了 `scheduling` 的，预约一条 1 分钟后的消息并取消；
   - 声明了 `worktree` / `services` 的，各创建并清理一次。
3. **端到端评估**（`evals/`）：至少跑一个用例，要求"夸大"指标为零。

通过结果写入 `laoshi doctor` 的能力矩阵（实现了什么、探针是否通过），并作为 [init-bootstrap.md](init-bootstrap.md) 中锁定文件的一部分。

## 6. 版本与兼容

- 适配器声明 `compatibleWith`（平台版本范围）。req-kit 对 Paseo 是 `>=0.11.0 <0.12.0`，只检查、不强制。
- 使用平台非公开接口的地方（req-kit 中 Paseo 的工作区脚本与定时任务经 `internal/daemon-client`）必须隔离在适配器内，并在不可用时返回 `null`，不得让核心知道。
- 适配器自带的界面插件（例如 Paseo 插件）读取 `laoshi api` 的 JSON 输出（`contracts/cli-json.md`），不直接读状态文件。
