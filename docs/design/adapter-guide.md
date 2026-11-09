# 适配器指南

- 状态：提议
- 前置阅读：[agent-runtime.md](../../contracts/agent-runtime.md)（能力契约）、[architecture.md](architecture.md)

为一个新的 agent 平台写适配器，需要交付五样东西：**运行时、能力声明、会话识别、体检、词汇表**。

## 1. 适配器的形状

M2a 起已实现，类型在 [`engine/src/platform.ts`](../../engine/src/platform.ts)，以代码为准：

```ts
interface PlatformAdapter {
  id: string;                        // 配置中 platform.adapter 的值，例如 "paseo"
  displayName: string;               // 面向使用者，例如 "Paseo"
  createRuntime: RuntimeFactory;
  /** 可选能力的来源；未声明的是 "none"，由核心统一降级 */
  capabilities: Partial<Record<CapabilityName, "platform" | "plugin" | "builtin">>;
  /** 平台对话的环境变量：id 标识对话（发起者），cwd 是对话的工作目录（平台提供时） */
  originEnv: { id: string; cwd?: string };
  resolveProfiles?(config, runtime): Promise<PipelineConfig>;   // 平台的 agent profile
  describeProfile?(profile): string;                            // 体检、日志里的一行描述
  doctorTitle: string;                                          // 体检中平台一节的标题
  doctorPlatform?({ config, configPath, tools }): Promise<void>; // 连接、版本、profile……
  doctorProject?({ repo, isRepo, tools }): void;               // 项目里平台自己的文件
  agentCatalog?(settings, progress): Promise<{ catalog; close() }>; // 配置向导可选的 agent
  words?: Partial<PlatformWords>;                               // 平台的说法（M2e，engine/src/words.ts）
}
```

能力来源写 `builtin` 时，运行时层用 laoshi 的内置实现替换对应方法（`engine/src/builtin/`，见 [builtin-capabilities](builtin-capabilities.md)；目前有 `services`、`worktree`）。内置服务要知道对话的工作目录时，调用运行时可选的 `agentDirectory(agentId)`。

适配器放在 `adapters/<id>/`，由 [`runtime-loader.ts`](../../engine/src/runtime-loader.ts) 登记，这是核心中唯一引用适配器的文件（`engine/test/platform.test.ts` 检查）。草案中的 `vocabulary` 已在 M2e 实现为 `words`；`skillTargets`、`configSchema`、`compatibleWith` 以后补上。

## 2. 能力声明

> [ADR 0008](../adr/0008-capability-sources-and-platform-plugin.md)（提议）对本节有两处补充：每项能力要标明来源（`platform` / `plugin` / `builtin` / `none`），运行时层按这个顺序选择；适配器可以带一个运行在平台进程内的插件，用来补上外部 API 调不到的能力。dsh 的实例见 [dsh-adapter](dsh-adapter.md)。

必需能力（`verifyOrigin`、`startAgent`、`StepAgent.*`、`attachAgent`、`notifyAgent`、`interruptAgent`、`close`）必须全部实现，不需要声明。可选和按需能力用名称声明：

| 名称 | 对应方法 |
| --- | --- |
| `profiles` | `listProfiles` |
| `services` | `listServices`、`startServices`、`stopServices` |
| `worktree` | `createWorktree`、`openWorkspace`、`waitForWorkspaceSetup` |
| `scheduling` | `scheduleMessage`、`cancelSchedule` |
| `scheduleAgent` | `scheduleNewAgent` |
| `sessionAgent` | `startSessionAgent` |
| `quota` | `providerQuota` |
| `activity` | `recentActivity` |
| `runningTool` | `runningTool` |
| `toolCalls` | `toolCalls` |
| `toolInfo` | `capabilities` |
| `providerStatus` | `providerStatus` |

运行时层按声明包装适配器（`withCapabilities`，M2a 已实现）：**未声明的能力，可选读取统一返回 `null`，定时返回"没有安排"，按需操作报"<平台> 不支持……"**。调用点里已有的 `.catch(() => null)` 在 M2e 收敛词汇时逐步去掉。

## 3. 会话识别

req-kit 靠环境变量 `PASEO_AGENT_ID`、`PASEO_AGENT_CWD` 识别"当前对话"。适配器用 `originEnv` 声明自己的变量名（dsh 是 `DSH_SESSION_ID`）；核心用 `originFromEnv` 识别，为不属于对话的子进程用 `scrubOriginEnv` 去掉所有平台的变量。没有"会话"概念的平台：返回 `null`，引擎仍可运行，只是进展写日志而不发回会话；或者由适配器自行定义一个"发起者"。

## 4. 体检

`laoshi doctor` 分两部分：

- **通用体检**：安装、本机配置、项目配置、进行中的流水线、状态文件版本、集成（这些来自现在 `doctor.ts` 中与平台无关的部分）。
- **适配器体检**：`doctorPlatform` 写平台一节（Paseo：SDK 与 daemon 版本、连接、provider、profile、额度、各 agent；dsh：插件连接），`doctorProject` 写项目一节中平台的文件（Paseo：`paseo.json`）。M2a 已从 `doctor.ts` 拆到 `adapters/paseo/doctor.ts`。
- **能力表**：通用体检列出每项可选能力的来源（平台 / laoshi 插件 / laoshi 内置 / 无）。

体检项的输出格式沿用 ✓ / ⚠ / ✗ 加修复建议。

## 5. 一致性测试

新适配器必须通过：

1. **运行时一致性测试**（`engine/test/conformance.ts` 的 `runConformance`，M3 起）：在适配器的测试目录里写一个 `conformance.test.ts`，给出"用假的平台后端建一个运行时"的方法（`setup`）和适配器的能力声明，就会跑同一组用例：`startAgent` → `wait` 为 idle 且文件写在 `cwd` 下；`followUp` 开始新回合；出错时为 error 且有原因；没等到时为 timeout、之后能等到结束；另一个进程的运行时用 `attachAgent` 接上；`interruptAgent` 改做新指令；声明了工具调用的看得到命令；可选方法不抛出、不支持的返回 `null`。假后端要认识三种提示词：`WRITE:<文件>:<内容>`、`SLEEP:<毫秒>`、`FAIL`。现在四个适配器都已接入（`adapters/*/test/conformance.test.ts`）：Paseo（假的 SDK 客户端）、dsh（真实的 laoshi dsh 插件配假的 dsh 服务）、摸高（假的 `aimax`）、命令行（假的 `claude`、`codex`）。平台自己的假后端可以用 `engine/test/scripted-session.ts`：它按这三种提示词在工作目录里"做事"，记下工具调用和回复，由假后端换成平台的格式（Paseo 的时间线、dsh 的会话记录等）。
   编排测试（`engine/test` 中基于 `fake-runtime.ts` 的用例）测的是核心本身，适配器不需要再跑。
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
