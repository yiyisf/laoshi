// Mode B — in-chat orchestration (ADR 0002, ADR 0009, docs/design/in-chat-orchestration.md).
//
// On a platform with skills and a subagent tool in the chat, but no programmatic agent API, the
// chat agent drives the pipeline by calling `laoshi run` one step at a time while the CLI keeps
// the state machine, the prompt assembly, the result validation and the quality gate:
//
//   laoshi run next   --feature <req>            → the step(s) to run now (promptFile, resultFile)
//   laoshi run record --feature <req> --step <k> → validates the result, runs the gate, returns next
//   laoshi run approve / verify / status / mode
//
// Each invocation runs the same `runPipeline` as the background engine (with `mode: "chat"`):
// steps that already have a result in `state.results` are skipped, and the first step without one
// writes its prompt to `.pipeline/requests/<key>.md`, records a StepRequest in `state.json` and
// stops the run. Both the builtin flow and any custom flow (.laoshi/flows/<name>.json) work
// unchanged in mode B.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  ConfigError,
  DEFAULT_CONFIG,
  type DefectHandling,
  loadConfig,
  PHASE_MODE_LABELS,
  PHASE_MODES,
  type PhaseMode,
  type PipelineConfig,
  PROFILE_LABELS,
  PROFILE_NAMES,
  type ProfileName,
  projectConfigPath,
  REQUIREMENT_TYPE_LABELS,
  type VerifyEnvironment,
} from "./config.js";
import { describeStatus } from "./control.js";
import { featuresWithRuns, findWorktreeRun, resolveFeatureArg } from "./features.js";
import { DEFAULT_FLOW, loadFlow } from "./flows.js";
import { jointProblem } from "./joint.js";
import { defaultConfigPath, localPromptsDir, PRINCIPLES_INDEX, PROMPTS_DIR } from "./locations.js";
import { runPipeline } from "./pipeline.js";
import { builtinServices } from "./builtin/services.js";
import { builtinWorkspaces } from "./builtin/workspace.js";
import {
  normalizeFeatureDir,
  preflight,
  specFlow,
  specOrchestrationMode,
  verifyPhaseProblem,
} from "./preflight.js";
import { appendRun, runRecord } from "./records.js";
import type { AgentRuntime } from "./runtime.js";
import { describeProfile, loadRuntimeFactory, originFromEnv, wordsFor } from "./runtime-loader.js";
import {
  acquireLock,
  ensurePipelineDir,
  hashFile,
  type PipelineState,
  pipelineDir,
  readState,
  type RunPhases,
  STATE_VERSION,
  statePath,
  type StepRequest,
  writeState,
} from "./state.js";

const USAGE = `用法：
  laoshi run next [--feature <功能目录>] [--profile quick|standard] [--phases continuous|gated|develop-only] [--flow <流程名>] [--restart] [--json]
                  推进到下一步：写出步骤提示词文件，返回要执行的步骤（已有未完成步骤时原样返回，不会跳步）
  laoshi run record [--feature <功能目录>] --step <步骤键> [--json]
                  校验子 agent 写好的结果文件、运行质量门与密钥扫描；通过则记录并给出下一步，不通过则说明原因
  laoshi run approve [--feature <功能目录>] [--json]
                  方案确认点：需求方看过 preview.md 并确认后继续，返回下一步
  laoshi run verify [--feature <功能目录>] [--verify-env local|deployed] [--defects fix|handback|report] [--json]
                  分阶段执行时，研发完成后开始测试验证阶段，返回下一步
  laoshi run status [--feature <功能目录>] [--json]
                  查看当前状态和待执行的步骤
  laoshi run mode [--feature <功能目录>] [--json]
                  查看这个需求使用的编排模式（engine 或 chat）和流程名称`;

export interface RunStepView {
  key: string;
  stepId: string;
  title: string;
  role: "builder" | "reviewer";
  promptFile: string;
  promptAbs: string;
  resultFile: string;
  resultAbs: string;
  followUp: string | null;
  followUps: number;
  gateFixes: number;
  secretFixes: number;
}

export interface RunCommandOutput {
  schema: 1;
  mode: "chat";
  featureDir: string;
  repo: string;
  flow: string;
  /**
   * - "step":    run the step(s) in `steps` with a subagent, then call `laoshi run record --step <key>`
   * - "rejected": the recorded step's result or quality gate failed; send `followUp` to the subagent and record again
   * - "waiting":  a person must decide (`waitingFor`: approval | business | phase)
   * - "done":     the pipeline finished (`report.md` is ready)
   * - "failed":   the pipeline stopped on an error
   */
  status: "step" | "rejected" | "waiting" | "done" | "failed";
  recorded?: string[];
  rejectedStep?: string;
  reason?: string;
  steps?: RunStepView[];
  waitingFor?: "approval" | "business" | "phase";
  questions?: string[];
  previewFile?: string;
  handoffFile?: string;
  continueCommand?: string;
  outcome?: string | null;
  summary?: string | null;
  reportFile?: string;
  notices?: string[];
}

function headCommit(repo: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Mode B runs on platforms that may have no daemon and no configured provider/model (the chat's own
 * subagent tool runs the steps). When `config.json` is missing or still has the `CHANGE-ME`
 * placeholder, loads the project's `.laoshi.json` over a neutral base config so checks, rounds,
 * custom flows and slices still apply.
 */
export function loadConfigLenient(configPath: string, repo: string): PipelineConfig {
  try {
    return loadConfig(configPath, repo).config;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    const projectFile = projectConfigPath(repo);
    const tmpDir = fs.mkdtempSync(path.join(ensurePipelineDir(repo, ".laoshi-tmp"), "cfg-"));
    const tmpFile = path.join(tmpDir, "config.json");
    try {
      const raw = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
      const patched = {
        ...raw,
        agents: {
          builder: { provider: "chat/builder", ...(raw.agents?.builder ?? {}), ...(String(raw.agents?.builder?.provider ?? "").includes("CHANGE-ME") || !raw.agents?.builder?.provider ? { provider: "chat/builder" } : {}) },
          reviewer: { provider: "chat/reviewer", ...(raw.agents?.reviewer ?? {}), ...(String(raw.agents?.reviewer?.provider ?? "").includes("CHANGE-ME") || !raw.agents?.reviewer?.provider ? { provider: "chat/reviewer" } : {}) },
        },
      };
      fs.writeFileSync(tmpFile, JSON.stringify(patched));
      return loadConfig(tmpFile, fs.existsSync(projectFile) ? repo : undefined).config;
    } catch {
      return {
        ...DEFAULT_CONFIG,
        agents: { builder: { provider: "chat/builder" }, reviewer: { provider: "chat/reviewer" } },
      };
    } finally {
      fs.rmSync( path.join(repo, ".laoshi-tmp"), { recursive: true, force: true });
    }
  }
}

/**
 * A runtime for mode B: uses the configured runtime when it can be created (so builtin services,
 * worktrees and platform schedules work), and falls back to laoshi's builtin services + worktrees
 * when the platform has no daemon.
 */
async function createChatRuntime(config: PipelineConfig, repo: string, log: (msg: string) => void): Promise<AgentRuntime> {
  const services = builtinServices({ log, agentDirectory: async () => repo });
  const workspaces = builtinWorkspaces({ log });
  const fallback: AgentRuntime = {
    verifyOrigin: async () => undefined,
    startAgent: async () => {
      throw new Error("模式 B 由对话中的子 agent 执行步骤，不调用 runtime.startAgent");
    },
    attachAgent: (id) => ({
      id,
      wait: async () => ({ status: "idle", error: null, lastMessage: null, pendingPermissions: [] }),
      followUp: async () => undefined,
      archive: async () => undefined,
    }),
    startSessionAgent: async () => {
      throw new Error("模式 B 不支持自动新开会话");
    },
    notifyAgent: async () => undefined,
    interruptAgent: async () => undefined,
    agentDirectory: async () => repo,
    listProfiles: async () => null,
    listServices: services.listServices,
    startServices: services.startServices,
    stopServices: services.stopServices,
    createWorktree: workspaces.createWorktree,
    openWorkspace: workspaces.openWorkspace,
    waitForWorkspaceSetup: workspaces.waitForWorkspaceSetup,
    providerQuota: async () => null,
    recentActivity: async () => null,
    runningTool: async () => null,
    toolCalls: async () => null,
    capabilities: async () => null,
    providerStatus: async () => null,
    scheduleMessage: async () => null,
    scheduleNewAgent: async () => null,
    cancelSchedule: async () => undefined,
    close: async () => undefined,
  };
  if (!process.env.REQ_PIPELINE_FAKE_RUNTIME) return fallback;
  try {
    const factory = await loadRuntimeFactory();
    return await factory({ config, log });
  } catch {
    return fallback;
  }
}

function stepRepoOf(state: PipelineState, repo: string, key: string): string {
  const slug = key.includes("@") ? key.split("@").pop() : null;
  return (slug && state.joint?.find((j) => j.slug === slug)?.repo) || repo;
}

function toStepView(state: PipelineState, repo: string, req: StepRequest): RunStepView {
  const stepRepo = stepRepoOf(state, repo, req.key);
  return {
    key: req.key,
    stepId: req.stepId,
    title: req.title,
    role: req.role,
    promptFile: req.promptFile,
    promptAbs: path.join(stepRepo, req.promptFile),
    resultFile: req.resultFile,
    resultAbs: path.join(stepRepo, req.resultFile),
    followUp: req.followUp,
    followUps: req.followUps,
    gateFixes: req.gateFixes,
    secretFixes: req.secretFixes,
  };
}

function formatHuman(out: RunCommandOutput): string {
  const lines: string[] = [];
  lines.push(`需求：${out.featureDir}（编排模式：会话内编排 / 模式 B，流程：${out.flow}）`);
  if (out.recorded?.length) lines.push(`已记录完成：${out.recorded.join("、")}`);
  if (out.status === "rejected") {
    lines.push(`结果未通过校验或质量门（步骤 ${out.rejectedStep}）：`);
    if (out.reason) lines.push("", out.reason, "");
    const step = out.steps?.find((s) => s.key === out.rejectedStep) ?? out.steps?.[0];
    if (step) {
      lines.push(
        `请让执行「${step.title}」的子 agent 按上面的说明修正，更新结果文件 ${step.resultFile}，然后再次运行：`,
        `  laoshi run record --feature ${out.featureDir} --step ${step.key}`,
      );
    }
    return lines.join("\n");
  }
  if (out.status === "step" && out.steps && out.steps.length > 0) {
    lines.push(
      out.steps.length === 1
        ? `下一步：${out.steps[0].title}（${out.steps[0].key}，角色：${out.steps[0].role}）`
        : `当前有 ${out.steps.length} 个可并行执行的步骤：`,
    );
    for (const s of out.steps) {
      lines.push(
        `- 步骤键：${s.key}（${s.title}，角色：${s.role}）`,
        `  提示词文件：${s.promptFile}`,
        `  结果文件：${s.resultFile}`,
      );
      if (s.followUp) lines.push(`  追问/修复要求：\n${s.followUp}`);
    }
    lines.push(
      "",
      "做法：用子 agent 工具执行上面的步骤（让子 agent 完整阅读提示词文件，按要求完成任务并把 JSON 写进结果文件），完成后运行：",
      ...out.steps.map((s) => `  laoshi run record --feature ${out.featureDir} --step ${s.key}`),
    );
    return lines.join("\n");
  }
  if (out.status === "waiting") {
    if (out.waitingFor === "approval") {
      lines.push(
        "状态：等待需求方确认方案（方案确认点）",
        `请把 ${out.previewFile ?? `${out.featureDir}/preview.md`} 的要点讲给需求方，请需求方确认：`,
        `- 确认后继续：${out.continueCommand}`,
        `- 需要修改：更新 spec.md 并确认后运行 laoshi run next --feature ${out.featureDir}`,
      );
    } else if (out.waitingFor === "business") {
      lines.push("状态：等待需求方决定", "需要需求方回答的问题：");
      for (const q of out.questions ?? []) lines.push(`- ${q}`);
      lines.push(`回答并更新 spec.md 后继续：${out.continueCommand}`);
    } else if (out.waitingFor === "phase") {
      lines.push(
        "状态：研发完成，待测试验证（分阶段执行）",
        `提测说明：${out.handoffFile ?? `${out.featureDir}/handoff.md`}`,
        `开始测试验证：${out.continueCommand}`,
      );
    }
    return lines.join("\n");
  }
  if (out.status === "done") {
    lines.push(
      `状态：已完成（结论：${out.outcome ?? "completed"}）`,
      ...(out.summary ? [`摘要：${out.summary}`] : []),
      `完成报告：${out.reportFile ?? `${out.featureDir}/report.md`}`,
    );
    return lines.join("\n");
  }
  lines.push(`状态：已中断（${out.reason ?? "原因见日志"}）`, `继续：laoshi run next --feature ${out.featureDir}`);
  return lines.join("\n");
}

function buildOutput(state: PipelineState, repo: string, featureDir: string, extra: Partial<RunCommandOutput> = {}): RunCommandOutput {
  const flow = state.flow?.name ?? DEFAULT_FLOW;
  const steps = (state.stepRequests ?? []).map((r) => toStepView(state, repo, r));
  if (state.status === "running" && steps.length > 0) {
    return { schema: 1, mode: "chat", featureDir, repo, flow, status: "step", steps, ...extra };
  }
  if (state.status === "waiting_for_approval") {
    return {
      schema: 1,
      mode: "chat",
      featureDir,
      repo,
      flow,
      status: "waiting",
      waitingFor: "approval",
      previewFile: `${featureDir}/preview.md`,
      continueCommand: `laoshi run approve --feature ${featureDir}`,
      ...extra,
    };
  }
  if (state.status === "waiting_for_business") {
    return {
      schema: 1,
      mode: "chat",
      featureDir,
      repo,
      flow,
      status: "waiting",
      waitingFor: "business",
      questions: state.pendingQuestions ?? [],
      continueCommand: `laoshi run next --feature ${featureDir}`,
      ...extra,
    };
  }
  if (state.status === "phase_done") {
    return {
      schema: 1,
      mode: "chat",
      featureDir,
      repo,
      flow,
      status: "waiting",
      waitingFor: "phase",
      handoffFile: `${featureDir}/handoff.md`,
      continueCommand: `laoshi run verify --feature ${featureDir}`,
      ...extra,
    };
  }
  if (state.status === "completed") {
    const report = state.results.report as { outcome?: string; summary?: string } | undefined;
    return {
      schema: 1,
      mode: "chat",
      featureDir,
      repo,
      flow,
      status: "done",
      outcome: state.outcome ?? report?.outcome ?? "completed",
      summary: report?.summary ?? null,
      reportFile: `${featureDir}/report.md`,
      ...extra,
    };
  }
  return {
    schema: 1,
    mode: "chat",
    featureDir,
    repo,
    flow,
    status: "failed",
    reason: state.stopReason ?? "流水线已中断",
    ...extra,
  };
}

export interface RunCliOptions {
  action: "next" | "record" | "approve" | "verify" | "status" | "mode";
  repo: string;
  featureDir: string;
  configPath?: string | null;
  steps?: string[];
  profile?: ProfileName | null;
  phases?: PhaseMode | null;
  verifyEnv?: VerifyEnvironment | null;
  defects?: DefectHandling | null;
  flow?: string | null;
  restart?: boolean;
  originAgentId?: string | null;
}

/**
 * Executes one mode-B command and returns the structured result. Used by the `laoshi run` CLI
 * and by the tests.
 */
export async function executeRunCommand(opts: RunCliOptions): Promise<RunCommandOutput> {
  const configPath = opts.configPath ?? defaultConfigPath();
  let repo = fs.realpathSync(opts.repo);
  let featureArg = opts.featureDir;
  if (!featureArg) {
    const ran = featuresWithRuns(repo);
    if (ran.length === 1) featureArg = ran[0];
    else throw new Error("请用 --feature <需求> 指定是哪个需求（可用 laoshi list 查看）");
  }
  const here = (() => {
    try {
      return resolveFeatureArg(repo, featureArg);
    } catch {
      return null;
    }
  })();
  const hasRunHere = here !== null && fs.existsSync(statePath(repo, here));
  const away = hasRunHere ? null : findWorktreeRun(repo, here ?? featureArg);
  let sourceRepo: string | null = null;
  let workspaceId: string | null = null;
  if (away) {
    sourceRepo = repo;
    repo = away.repo;
    featureArg = away.featureDir;
    workspaceId = away.workspaceId;
  } else {
    featureArg = here ?? normalizeFeatureDir(repo, featureArg);
  }
  const featureDir = normalizeFeatureDir(repo, featureArg);
  const config = loadConfigLenient(configPath, repo);
  const stateFile = statePath(repo, featureDir);
  const existing = readState(stateFile);

  if (opts.action === "status") {
    if (!existing) {
      return {
        schema: 1,
        mode: "chat",
        featureDir,
        repo,
        flow: opts.flow ?? config.orchestration.flow,
        status: "failed",
        reason: `需求 ${featureDir} 还没有开始运行。执行 laoshi run next --feature ${featureDir} 开始第一步。`,
      };
    }
    return buildOutput(existing, repo, featureDir);
  }

  const specPath = path.join(repo, featureDir, "spec.md");
  const specText = fs.existsSync(specPath) ? fs.readFileSync(specPath, "utf8") : "";

  if (opts.action === "mode") {
    const mode = existing?.mode ?? specOrchestrationMode(specText) ?? config.orchestration.mode;
    const flowName = opts.flow ?? existing?.flow?.name ?? specFlow(specText) ?? config.orchestration.flow;
    const flowDef = loadFlow(flowName, repo);
    return {
      schema: 1,
      mode: mode as "chat",
      featureDir,
      repo,
      flow: flowDef?.name ?? DEFAULT_FLOW,
      status: existing ? buildOutput(existing, repo, featureDir).status : "step",
      steps: existing?.stepRequests?.map((r) => toStepView(existing, repo, r)),
    };
  }

  // `record` must name a step that is currently requested; prevents out-of-order or invented steps.
  const recordKeys = (opts.steps ?? []).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  if (opts.action === "record") {
    if (recordKeys.length === 0) throw new Error("laoshi run record 需要 --step <步骤键>");
    if (!existing || existing.status !== "running") {
      throw new Error(`需求 ${featureDir} 当前没有待记录的步骤（状态：${existing?.status ?? "未启动"}）。请先运行 laoshi run next --feature ${featureDir}`);
    }
    const pendingKeys = new Set((existing.stepRequests ?? []).map((r) => r.key));
    const unknown = recordKeys.filter((k) => !pendingKeys.has(k));
    if (unknown.length > 0) {
      const expected = [...pendingKeys].join("、") || "（无）";
      return {
        schema: 1,
        mode: "chat",
        featureDir,
        repo,
        flow: existing.flow?.name ?? DEFAULT_FLOW,
        status: "rejected",
        rejectedStep: unknown[0],
        reason: `步骤 ${unknown.join("、")} 不在当前待执行的步骤中（当前待执行：${expected}）。不能跳步或乱序记录。`,
        steps: (existing.stepRequests ?? []).map((r) => toStepView(existing, repo, r)),
      };
    }
  }

  // When the run is already waiting on a step in mode B and `next` is called again without changing
  // the spec or asking for `--restart`, return the same pending step(s) immediately (idempotent).
  if (
    opts.action === "next" &&
    !opts.restart &&
    existing?.status === "running" &&
    existing.mode === "chat" &&
    (existing.stepRequests?.length ?? 0) > 0 &&
    fs.existsSync(specPath) &&
    hashFile(specPath) === existing.specHash
  ) {
    return buildOutput(existing, repo, featureDir);
  }

  const resuming = existing !== null && !opts.restart;
  const checked = preflight(
    {
      repo,
      featureDir,
      originAgentId: opts.originAgentId ?? null,
      resume: resuming,
      restart: opts.restart ?? false,
      configPath: opts.configPath ?? null,
      profile: opts.profile ?? null,
      status: false,
      stop: false,
      list: false,
      specReview: false,
      worktree: false,
      sourceRepo,
      workspaceId,
      at: null,
      phases: opts.phases ?? null,
      phase: opts.action === "verify" ? "verify" : null,
      verifyAt: null,
      verifyEnv: opts.verifyEnv ?? null,
      defects: opts.defects ?? null,
      approve: opts.action === "approve",
      flow: opts.flow ?? null,
    },
    hashFile,
  );

  ensurePipelineDir(repo, featureDir);
  const release = acquireLock(repo, featureDir);
  const logFile = path.join(pipelineDir(repo, featureDir), "pipeline.log");
  const log = (message: string) => {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] [chat] ${message}\n`);
  };

  try {
    const previous = checked.mode.kind === "fresh" ? null : checked.mode.previous;
    const reuse = checked.mode.kind === "resume-reuse";
    const flowName =
      opts.flow ?? (reuse ? previous?.flow?.name : null) ?? checked.specFlow ?? previous?.flow?.name ?? config.orchestration.flow;
    const flowDef = loadFlow(flowName, repo);

    let phaseMode =
      opts.phases ?? (reuse ? previous?.phases?.mode : null) ?? checked.specPhases ?? previous?.phases?.mode ?? config.phases.mode;
    const type = checked.specType && config.requirementTypes.includes(checked.specType) ? checked.specType : null;
    if (type === "assessment") phaseMode = "continuous";
    const jointNames = type === "assessment" ? [] : checked.specJoint;
    const phases: RunPhases = {
      mode: phaseMode,
      environment: opts.verifyEnv ?? previous?.phases?.environment ?? config.phases.verify.environment,
      defects: opts.defects ?? previous?.phases?.defects ?? config.phases.verify.defects,
    };

    const chatDir = sourceRepo ?? previous?.worktree?.sourceRepo ?? repo;
    const jointIssue = jointProblem(jointNames, config.relatedRepos, chatDir);
    if (jointIssue) throw new Error(jointIssue);
    if (checked.entersVerify) {
      const problem = verifyPhaseProblem(repo, featureDir, phases.environment);
      if (problem) throw new Error(problem);
    }

    const now = new Date().toISOString();
    const specHash = hashFile(checked.specPath);
    const originAgentId = opts.originAgentId ?? previous?.originSessionId ?? originFromEnv()?.id ?? null;
    const profile = opts.profile ?? (reuse ? previous?.profile : null) ?? checked.specProfile ?? config.defaultProfile;

    let state: PipelineState;
    const chatContinuing = reuse && previous?.status === "running" && previous.mode === "chat" && !checked.entersVerify;
    if (checked.mode.kind === "fresh") {
      state = {
        version: STATE_VERSION,
        repo,
        featureDir,
        status: "running",
        attempt: 1,
        specHash,
        originSessionId: originAgentId,
        adapter: { id: config.platform.adapter },
        mode: "chat",
        stepRequests: [],
        flow: flowDef ? { name: flowDef.name, hash: flowDef.hash, source: flowDef.source } : null,
        pid: process.pid,
        startedAt: now,
        updatedAt: now,
        results: {},
        history: [],
        stopReason: null,
        outcome: null,
        profile,
        branch: checked.branch,
        milestones: [],
        incremental: null,
        worktree: sourceRepo && workspaceId ? { workspaceRef: workspaceId, sourceRepo } : null,
        phases,
        phase: "develop",
        verifyAt: null,
        handbacks: 0,
        type,
      };
      log(
        `开始会话内编排（模式 B）：${featureDir}（${PROFILE_LABELS[profile]}档，${type ? `类型：${REQUIREMENT_TYPE_LABELS[type]}，` : ""}${flowDef ? `流程：${flowDef.name}，` : ""}执行方式：${PHASE_MODE_LABELS[phases.mode]}）`,
      );
    } else {
      const startOver = checked.mode.kind !== "resume-reuse";
      const previousImplemented =
        Object.keys(previous!.results).some((k) => k === "implement" || k.startsWith("implement-s")) ||
        previous!.history.some((h) => h.stepId === "implement" && h.outcome === "completed");
      state = {
        ...previous!,
        status: "running",
        attempt: startOver ? previous!.attempt + 1 : previous!.attempt,
        specHash,
        originSessionId: originAgentId,
        adapter: { id: config.platform.adapter },
        mode: "chat",
        stepRequests: startOver ? [] : (previous!.stepRequests ?? []),
        flow: flowDef ? { name: flowDef.name, hash: flowDef.hash, source: flowDef.source } : null,
        pid: process.pid,
        results: startOver ? {} : previous!.results,
        stopReason: null,
        outcome: null,
        profile,
        branch: checked.branch,
        milestones: startOver ? [] : (previous!.milestones ?? []),
        incremental:
          checked.mode.kind === "resume-from-design"
            ? { fromAttempt: previous!.attempt, reason: checked.mode.reason, baseCommit: headCommit(repo), hadImplementation: previousImplemented }
            : checked.mode.kind === "restart"
              ? null
              : (previous!.incremental ?? null),
        phases,
        phase: checked.entersVerify ? "verify" : startOver ? "develop" : (previous!.phase ?? "develop"),
        verifyAt: null,
        handbacks: checked.mode.kind === "restart" ? 0 : (previous!.handbacks ?? 0),
        type,
        codeBase: startOver ? null : (previous!.codeBase ?? null),
        approval:
          opts.action === "approve" && previous!.status === "waiting_for_approval"
            ? { attempt: previous!.attempt, status: "approved", at: now }
            : startOver
              ? null
              : (previous!.approval ?? null),
        gate: checked.mode.kind === "restart" ? null : (previous!.gate ?? null),
      };
      if (checked.entersVerify) delete state.results.report;
    }
    writeState(stateFile, state);

    const runtime = await createChatRuntime(config, repo, log);
    const notices: string[] = [];
    const requested = new Map<string, StepRequest>();
    try {
      const outcome = await runPipeline({
        repo,
        featureDir,
        config,
        runtime,
        state,
        statePath: stateFile,
        prompts: { promptsDir: PROMPTS_DIR, localPromptsDir: localPromptsDir(), principlesFile: PRINCIPLES_INDEX, words: wordsFor(config) },
        logPath: logFile,
        resumeCommand: `laoshi run next --feature ${featureDir}`,
        statusCommand: `laoshi run status --feature ${featureDir}`,
        verifyCommand: `laoshi run verify --feature ${featureDir}`,
        approveCommand: `laoshi run approve --feature ${featureDir}`,
        jointNames,
        mode: "chat",
        flowDef,
        chatRecord: opts.action === "record" ? new Set(recordKeys) : undefined,
        chatContinuing,
        notices,
        requested,
        log,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      });

      if (outcome !== "step_requested") {
        // The run reached a stopping point or finished: record it in the usage log.
        const title = (/^#\s+(.+)$/m.exec(specText)?.[1] ?? path.basename(featureDir)).trim();
        appendRun(
          runRecord({
            state,
            runStartedAt: state.startedAt,
            title,
            agents: { builder: describeProfile(config, config.agents.builder), reviewer: describeProfile(config, config.agents.reviewer) },
          }),
        );
      }

      if (opts.action === "record") {
        // If a step the chat just recorded is still in stepRequests, its result or gate check was rejected.
        const rejected = recordKeys.map((k) => (state.stepRequests ?? []).find((r) => r.key === k)).find(Boolean);
        if (rejected) {
          return {
            schema: 1,
            mode: "chat",
            featureDir,
            repo,
            flow: state.flow?.name ?? DEFAULT_FLOW,
            status: "rejected",
            rejectedStep: rejected.key,
            reason: rejected.followUp ?? "结果文件未通过校验",
            steps: (state.stepRequests ?? []).map((r) => toStepView(state, repo, r)),
            ...(notices.length > 0 ? { notices } : {}),
          };
        }
      }

      return buildOutput(state, repo, featureDir, {
        ...(opts.action === "record" ? { recorded: recordKeys } : {}),
        ...(notices.length > 0 ? { notices } : {}),
      });
    } finally {
      await runtime.close().catch(() => undefined);
    }
  } finally {
    release();
  }
}

async function main(): Promise<number> {
  const rawArgs = process.argv.slice(2);
  const first = rawArgs[0];
  if (!first || first === "help" || first === "--help" || first === "-h") {
    console.log(USAGE);
    return 0;
  }
  const actions = ["next", "record", "approve", "verify", "status", "mode"] as const;
  const action = (actions as readonly string[]).includes(first) ? (first as (typeof actions)[number]) : null;
  if (!action) {
    console.error(`未知的子命令 "${first}"。\n\n${USAGE}`);
    return 2;
  }
  const rest = rawArgs.slice(1);
  // Allow `laoshi run next <feature>` as shorthand for `laoshi run next --feature <feature>`.
  const normalized = rest[0] && !rest[0].startsWith("-") ? ["--feature", rest[0], ...rest.slice(1)] : rest;
  const { values } = parseArgs({
    args: normalized,
    options: {
      feature: { type: "string" },
      repo: { type: "string" },
      config: { type: "string" },
      step: { type: "string", multiple: true },
      profile: { type: "string" },
      phases: { type: "string" },
      "verify-env": { type: "string" },
      defects: { type: "string" },
      flow: { type: "string" },
      restart: { type: "boolean", default: false },
      "origin-agent": { type: "string" },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const profile = values.profile?.trim().toLowerCase();
  if (profile && !PROFILE_NAMES.includes(profile as ProfileName)) {
    throw new Error(`--profile 只能是 quick 或 standard，收到 "${values.profile}"`);
  }
  const phases = values.phases?.trim().toLowerCase();
  if (phases && !PHASE_MODES.includes(phases as PhaseMode)) {
    throw new Error(`--phases 只能是 ${PHASE_MODES.join("、")}，收到 "${values.phases}"`);
  }
  const verifyEnv = values["verify-env"]?.trim().toLowerCase();
  if (verifyEnv && verifyEnv !== "local" && verifyEnv !== "deployed") {
    throw new Error(`--verify-env 只能是 local 或 deployed，收到 "${values["verify-env"]}"`);
  }
  const defects = values.defects?.trim().toLowerCase();
  if (defects && !["fix", "handback", "report"].includes(defects)) {
    throw new Error(`--defects 只能是 fix、handback 或 report，收到 "${values.defects}"`);
  }
  const chat = originFromEnv(process.env);
  const repo = path.resolve(values.repo ?? chat?.cwd ?? process.cwd());

  if (action === "status" && !values.json) {
    const featureArg = values.feature ?? (featuresWithRuns(repo).length === 1 ? featuresWithRuns(repo)[0] : "");
    if (!featureArg) {
      console.error("请用 --feature <需求> 指定要查看哪个需求。");
      return 2;
    }
    const featureDir = resolveFeatureArg(repo, featureArg);
    const state = readState(statePath(repo, featureDir));
    console.log(describeStatus(state, featureDir));
    if (state?.mode === "chat" && (state.stepRequests?.length ?? 0) > 0) {
      console.log("");
      console.log(formatHuman(buildOutput(state, repo, featureDir)));
    }
    return 0;
  }

  const out = await executeRunCommand({
    action,
    repo,
    featureDir: values.feature ?? "",
    configPath: values.config ? path.resolve(values.config) : null,
    steps: values.step,
    profile: (profile as ProfileName | undefined) ?? null,
    phases: (phases as PhaseMode | undefined) ?? null,
    verifyEnv: (verifyEnv as VerifyEnvironment | undefined) ?? null,
    defects: (defects as DefectHandling | undefined) ?? null,
    flow: values.flow?.trim().toLowerCase() || null,
    restart: values.restart ?? false,
    originAgentId: (values["origin-agent"] ?? chat?.id)?.trim() || null,
  });

  if (values.json) {
    console.log(JSON.stringify(out, null, 2));
  } else if (action === "mode") {
    console.log(
      `编排模式：${(out.mode as string) === "chat" ? "chat（模式 B：会话内编排，用 laoshi run next / record 推进）" : "engine（模式 A：后台引擎，用 start-pipeline 启动）"}\n流程：${out.flow}`,
    );
  } else {
    console.log(formatHuman(out));
  }
  return out.status === "failed" || out.status === "rejected" ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || path.resolve(process.argv[1] ?? "") === path.resolve(new URL(import.meta.url).pathname)) {
  main().then(
    (code) => process.exit(code),
    (error: Error) => {
      console.error(`错误：${error.message}`);
      process.exit(2);
    },
  );
}
