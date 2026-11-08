// laoshi M2a: what a platform adapter gives the core (ADR 0008, docs/design/adapter-guide.md).
// The core reaches a platform only through this interface and AgentRuntime; adapters live under
// adapters/<id>/ and are listed in runtime-loader.ts, the one core file that names them.

import type { AgentProfile, PipelineConfig } from "./config.js";
import type { Catalog } from "./configure.js";
import type { AgentRuntime, RuntimeFactory } from "./runtime.js";
import type { PlatformWords } from "./words.js";

/** Optional and on-demand AgentRuntime capabilities (contracts/agent-runtime.md). */
export const CAPABILITIES = {
  profiles: { label: "平台的 agent profile", methods: ["listProfiles"] },
  services: { label: "受管服务（端口、健康检查）", methods: ["listServices", "startServices", "stopServices"] },
  worktree: { label: "为需求新建工作区（--worktree、联合需求）", methods: ["createWorktree", "openWorkspace", "waitForWorkspaceSetup"] },
  scheduling: { label: "定时消息（预约、自动继续、等待提醒）", methods: ["scheduleMessage", "cancelSchedule"] },
  scheduleAgent: { label: "定时启动 agent（需求总览定时发送）", methods: ["scheduleNewAgent"] },
  sessionAgent: { label: "为需求新开对话（卡片接单）", methods: ["startSessionAgent"] },
  quota: { label: "额度提醒", methods: ["providerQuota"] },
  activity: { label: "最近活动", methods: ["recentActivity"] },
  runningTool: { label: "打断大目录搜索", methods: ["runningTool"] },
  toolCalls: { label: "危险命令拦截", methods: ["toolCalls"] },
  toolInfo: { label: "平台工具信息", methods: ["capabilities"] },
  providerStatus: { label: "agent 登录状态（接单器体检）", methods: ["providerStatus"] },
} as const;

export type CapabilityName = keyof typeof CAPABILITIES;

/** Who provides a capability: the platform, laoshi's plugin for it, laoshi itself, or nobody. */
export type CapabilitySource = "platform" | "plugin" | "builtin" | "none";

export const SOURCE_LABELS: Record<CapabilitySource, string> = { platform: "平台", plugin: "laoshi 插件", builtin: "laoshi 内置", none: "无" };

/** Output of `doctor`: a checked item, a problem to fix, or an informational line. */
export interface DoctorTools {
  report(level: "ok" | "warn" | "fail", text: string, fix?: string): void;
  info(text: string): void;
}

export interface PlatformAdapter {
  /** Name in the config's platform.adapter, e.g. the adapter directory's name. */
  id: string;
  /** For people, e.g. the platform's product name. */
  displayName: string;
  createRuntime: RuntimeFactory;
  /** Sources of the optional capabilities; an undeclared one is "none" and degrades as the contract says. */
  capabilities: Partial<Record<CapabilityName, Exclude<CapabilitySource, "none">>>;
  /**
   * Environment of a chat on this platform: `id` names the chat (the pipeline's origin), `cwd`
   * its working directory when the platform says. Child processes started outside a chat drop them.
   */
  originEnv: { id: string; cwd?: string };
  /** Environment variable naming the person using the chat (ADR 0007: the platform says who it is). */
  userEnv?: string;
  /** Resolve the platform's agent profiles that the config refers to, before a run. */
  resolveProfiles?(config: PipelineConfig, runtime: AgentRuntime): Promise<PipelineConfig>;
  /** One line for an agent's settings, e.g. "claude/opus（模式 bypassPermissions）". */
  describeProfile?(profile: AgentProfile): string;
  /** laoshi M2e: the platform's words in messages and prompts (engine/src/words.ts); the rest are neutral. */
  words?: Partial<PlatformWords>;
  /**
   * laoshi M2e: the file with this platform's sections of the /laoshi-setup skill ("<!-- fragment: name -->"
   * blocks, e.g. how to write its workspace configuration). Without it, laoshi's builtin sections
   * when the platform uses laoshi's builtin services.
   */
  skillSetup?: string;
  /**
   * The platform keeps a chat's machine only while the chat's turn lasts, so the engine cannot run
   * in the background: it runs in the chat's command, which shows what it tells the chat.
   */
  runsInChat?: boolean;
  /** Heading of the platform section in `doctor`. */
  doctorTitle: string;
  /** The platform section of `doctor` (connection, versions, profiles), when not --offline. */
  doctorPlatform?(input: { config: PipelineConfig | null; configPath: string; tools: DoctorTools }): Promise<void>;
  /** The platform's files in the project, for `doctor` . */
  doctorProject?(input: { repo: string; isRepo: boolean; tools: DoctorTools }): void;
  /**
   * What agents the configuration wizard can offer. `settings` is the raw machine config;
   * throws with a reason for people when the platform cannot be reached.
   */
  agentCatalog?(settings: Record<string, unknown>, progress: (text: string) => void): Promise<{ catalog: Catalog; close(): Promise<void> }>;
}

/** "claude/opus（模式 bypassPermissions）": an agent's settings, without any platform's profiles. */
export function describeProfileDefault(profile: AgentProfile): string {
  return `${profile.provider ?? "（未设置）"}${profile.modeId ? `（模式 ${profile.modeId}）` : ""}`;
}

export function sourceOf(adapter: Pick<PlatformAdapter, "capabilities">, name: CapabilityName): CapabilitySource {
  return adapter.capabilities[name] ?? "none";
}

/**
 * The runtime with every undeclared capability degraded in one place (ADR 0008, decision 1),
 * as contracts/agent-runtime.md says: optional reads give null, scheduling gives no schedule,
 * on-demand actions fail with a reason. Declared capabilities are the adapter's own.
 */
export function withCapabilities(runtime: AgentRuntime, adapter: Pick<PlatformAdapter, "capabilities" | "displayName">): AgentRuntime {
  const missing = (name: CapabilityName) => sourceOf(adapter, name) === "none";
  const unsupported = (what: string) => async () => {
    throw new Error(`${adapter.displayName} 不支持${what}`);
  };
  const r: AgentRuntime = { ...runtime };
  if (missing("profiles")) r.listProfiles = async () => null;
  if (missing("services")) {
    r.listServices = async () => null;
    r.startServices = unsupported("由平台管理服务");
    r.stopServices = async () => undefined;
  }
  if (missing("worktree")) {
    r.createWorktree = unsupported("为需求新建工作区（--worktree、联合需求）");
    r.openWorkspace = undefined;
    r.waitForWorkspaceSetup = async () => ({ status: "none", error: null });
  }
  if (missing("scheduling")) {
    r.scheduleMessage = async () => null;
    r.cancelSchedule = async () => undefined;
  }
  if (missing("scheduleAgent")) r.scheduleNewAgent = async () => null;
  if (missing("sessionAgent")) r.startSessionAgent = unsupported("为需求新开对话");
  if (missing("quota")) r.providerQuota = async () => null;
  if (missing("activity")) r.recentActivity = async () => null;
  if (missing("runningTool")) r.runningTool = async () => null;
  if (missing("toolCalls")) r.toolCalls = async () => null;
  if (missing("toolInfo")) r.capabilities = async () => null;
  if (missing("providerStatus")) r.providerStatus = async () => null;
  return r;
}
