// The engine's runtime for the DeepSeek Harness (dsh), M4b prototype (docs/design/dsh-adapter.md).
// Everything goes through laoshi's dsh plugin (adapters/dsh/plugin) over its local socket; the
// engine never calls dsh's /api (ADR 0008: the plugin calls on the engine's behalf).
//
// Worktrees and services are laoshi's builtin ones (engine/src/builtin, laoshi M2b): the methods
// below are placeholders the runtime layer replaces. Not yet: provider quota, agent profiles per
// role (step agents use the chat's model), recurring schedules' expiry.
import fs from "node:fs";
import net from "node:net";
import type { RunningTool } from "../../engine/src/scan-guard.js";
import type { ToolCall } from "../../engine/src/danger-guard.js";
import { samePath } from "../../engine/src/paths.js";
import type { AgentRuntime, RuntimeFactory, StepAgent, WaitOutcome } from "../../engine/src/runtime.js";
import { localTimeZone } from "../../engine/src/schedule-time.js";
import type { AgentUsage } from "../../engine/src/usage.js";
import { channelPaths, dshHome } from "./plugin/channel.mjs";

/** One call to the plugin. */
export type PluginCall = <T = Record<string, unknown>>(method: string, params?: Record<string, unknown>) => Promise<T>;

export class PluginUnavailableError extends Error {}

/** A client for the plugin's socket: one connection per call, newline-delimited JSON. */
export function pluginClient(env: NodeJS.ProcessEnv = process.env, timeoutMs = 60_000): PluginCall {
  const paths = channelPaths(dshHome(env));
  let count = 0;
  return (method, params = {}) =>
    new Promise((resolve, reject) => {
      let token: string;
      try {
        token = fs.readFileSync(paths.token, "utf8").trim();
      } catch {
        reject(new PluginUnavailableError(`没有找到 laoshi 的 dsh 插件（${paths.token} 不存在）：请确认 dsh 已启动，并已安装、挂载 laoshi-dsh-plugin`));
        return;
      }
      const socket = net.connect(paths.socket);
      let buffer = "";
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`laoshi 的 dsh 插件没有在 ${timeoutMs / 1000} 秒内回应（${method}）`));
      }, timeoutMs);
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => {
        buffer += chunk;
        const nl = buffer.indexOf("\n");
        if (nl < 0) return;
        clearTimeout(timer);
        socket.end();
        const reply = JSON.parse(buffer.slice(0, nl)) as { ok: boolean; result?: unknown; error?: string };
        if (reply.ok) resolve(reply.result as never);
        else reject(new Error(`dsh 插件：${reply.error}`));
      });
      socket.on("error", (e) => {
        clearTimeout(timer);
        reject(new PluginUnavailableError(`连不上 laoshi 的 dsh 插件（${paths.socket}）：${e.message}。请确认 dsh 正在运行`));
      });
      socket.write(`${JSON.stringify({ id: ++count, token, method, params })}\n`);
    });
}

interface Status {
  exists: boolean;
  running?: boolean;
  pendingPermissions?: Array<{ id: string; title: string }>;
  usage?: { uncachedInputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number } | null;
  error?: string | null;
}

/** dsh's token usage in the engine's terms. */
export function toAgentUsage(u: Status["usage"]): AgentUsage | null {
  if (!u) return null;
  const cached = u.cacheReadTokens ?? 0;
  return { inputTokens: (u.uncachedInputTokens ?? 0) + cached + (u.cacheWriteTokens ?? 0), cachedInputTokens: cached, outputTokens: u.outputTokens ?? 0 };
}

/** Schedule IDs carry the session, which the plugin needs to cancel them. */
const scheduleId = (sessionId: string, id: string) => `dsh:${sessionId}/${id}`;
function parseScheduleId(id: string): { sessionId: string; id: string } | null {
  const m = /^dsh:([^/]+)\/(.+)$/.exec(id);
  return m ? { sessionId: m[1], id: m[2] } : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createRuntimeWithClient(call: PluginCall, log: (message: string) => void, pollMs = 1000): AgentRuntime {
  const stepAgent = (id: string): StepAgent => ({
    id,
    async wait(timeoutMs: number): Promise<WaitOutcome> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const s = await call<Status>("status", { sessionId: id });
        const base = { error: null, lastMessage: null, pendingPermissions: [], usage: toAgentUsage(s.usage) };
        if (!s.exists) return { ...base, status: "error", error: `dsh 中找不到会话 ${id}` };
        if (s.pendingPermissions?.length) return { ...base, status: "permission", pendingPermissions: s.pendingPermissions };
        if (!s.running) {
          const { text } = await call<{ text: string | null }>("lastMessage", { sessionId: id }).catch(() => ({ text: null }));
          if (s.error) return { ...base, lastMessage: text, status: "error", error: s.error };
          return { ...base, lastMessage: text, status: "idle" };
        }
        if (Date.now() >= deadline) return { ...base, status: "timeout" };
        await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
      }
    },
    async followUp(text: string): Promise<void> {
      await call("prompt", { sessionId: id, text });
    },
    async archive(): Promise<void> {
      // dsh keeps step agents in the chat's list of child agents; nothing to archive.
    },
  });

  const toolCalls = async (agentId: string): Promise<ToolCall[] | null> =>
    (await call<{ calls: ToolCall[] }>("toolCalls", { sessionId: agentId }).catch(() => null))?.calls ?? null;

  return {
    async verifyOrigin(agentId, cwd) {
      const s = await call<{ exists: boolean; cwd?: string | null }>("session", { sessionId: agentId });
      if (!s.exists) throw new Error(`dsh 中找不到发起流水线的对话 ${agentId}（可能已被删除）。`);
      const real = (p: string) => (fs.existsSync(p) ? fs.realpathSync(p) : p);
      if (s.cwd && !samePath(real(s.cwd), real(cwd))) {
        throw new Error(`发起流水线的对话的工作目录是 ${s.cwd}，与仓库目录 ${cwd} 不一致：请在项目目录的对话中发起。`);
      }
    },

    async startAgent(input) {
      // A requirement's own worktree (builtin, "dir:<directory>"): the step works in input.cwd, which is it.
      if (!input.parentAgentId) {
        const { sessionId } = await call<{ sessionId: string }>("startSession", { cwd: input.cwd, prompt: input.prompt });
        return stepAgent(sessionId);
      }
      const { childId } = await call<{ childId: string }>("spawn", { parent: input.parentAgentId, label: input.title, prompt: input.prompt, cwd: input.cwd });
      return stepAgent(childId);
    },

    attachAgent: (agentId) => stepAgent(agentId),

    async startSessionAgent(input) {
      return (await call<{ sessionId: string }>("startSession", { cwd: input.cwd, prompt: input.prompt })).sessionId;
    },

    async notifyAgent(agentId, text) {
      await call("prompt", { sessionId: agentId, text });
    },

    async interruptAgent(agentId, text) {
      await call("interrupt", { sessionId: agentId, text });
    },

    async agentDirectory(agentId) {
      const s = await call<{ exists: boolean; cwd?: string | null }>("session", { sessionId: agentId });
      return s.exists ? (s.cwd ?? null) : null;
    },

    listProfiles: async () => null,
    listServices: async () => null,
    startServices: async () => {
      throw new Error("dsh 不管理服务");
    },
    stopServices: async () => undefined,
    createWorktree: async () => {
      throw new Error("dsh 适配器（原型）还不支持在新建的工作区中开发（--worktree）");
    },
    waitForWorkspaceSetup: async () => ({ status: "none", error: null }),
    providerQuota: async () => null,

    async recentActivity(agentId, limit) {
      const calls = await toolCalls(agentId);
      return calls ? calls.slice(-limit).map((c) => ({ at: c.startedAt, text: c.kind === "shell" ? `运行命令：${c.text}` : `${c.kind}：${c.text}` })) : null;
    },

    async runningTool(agentId): Promise<RunningTool | null> {
      const running = (await toolCalls(agentId))?.filter((c) => c.status === "running").at(-1);
      return running ? { kind: running.kind, text: running.text, startedAt: running.startedAt, callId: running.callId } : null;
    },

    toolCalls,
    capabilities: async () => null,
    providerStatus: async () => null,

    async scheduleMessage(input) {
      if (input.expiresAt) log("dsh 的定时任务不能设截止时间：这条定时消息会一直有效，直到被取消");
      const { id } = await call<{ id: string }>("schedule", {
        sessionId: input.agentId,
        title: input.name,
        prompt: input.prompt,
        ...(input.cron ? { cron: input.cron, timeZone: localTimeZone() } : { at: input.at?.toISOString() }),
      });
      return scheduleId(input.agentId, id);
    },

    scheduleNewAgent: async () => null,

    async cancelSchedule(id) {
      const parsed = parseScheduleId(id);
      if (parsed) await call("cancelSchedule", { sessionId: parsed.sessionId, id: parsed.id });
    },

    close: async () => undefined,
  };
}

export const createRuntime: RuntimeFactory = async ({ log }) => {
  const call = pluginClient();
  await call("hello");
  return createRuntimeWithClient(call, log);
};
