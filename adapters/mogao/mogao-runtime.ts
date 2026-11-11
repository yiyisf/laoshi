// The engine's runtime for 摸高 (docs/design/mogao-expert.md, form B1). Each step agent is a run of the
// platform's command line, `aimax run` (a new agent with tools, synchronous, JSON output), continued
// with `-s <sessionId>`; approvals are the platform's HITL (`paused`, then `aimax resume`). Tool
// calls and usage come from the platform's progress callback (`--callback-url`), received here.
//
// The platform keeps a container for one chat turn only, so the engine runs in the chat's command
// and every agent's state is kept on disk (<install root>/mogao/agents/<id>/): a later turn's engine
// picks an agent up again, and continues its session when the turn ended in the middle of a run.
//
// Worktrees and services are laoshi's builtin ones; there is no scheduling and no way to send the
// chat a message, so notifications go to the chat's command output (LAOSHI_CHAT_OUT, see launch.ts).
import { type ChildProcess, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { ToolCall } from "../../engine/src/danger-guard.js";
import { homeOf } from "../../engine/src/locations.js";
import { isAlive as engineProcessAlive } from "../../engine/src/state.js";
import type { AgentRuntime, RuntimeFactory, StepAgent, WaitOutcome } from "../../engine/src/runtime.js";
import type { RunningTool } from "../../engine/src/scan-guard.js";
import type { AgentUsage } from "../../engine/src/usage.js";

/** Settings from the install-level config's platform.mogao. */
export interface MogaoSettings {
  /** The platform's command line; LAOSHI_AIMAX overrides it (tests). */
  command: string;
  /** The platform's data directory (`-d`), where its sessions live. */
  dataDir: string;
  /** Hard limit of one `aimax run`, in minutes (the engine keeps its own step limits). */
  runTimeoutMinutes: number;
  /** `--plugins-config` for step agents (the platform's plugins, e.g. its knowledge base), or null. */
  pluginsConfig: string | null;
}

export function mogaoSettings(config: unknown, env: NodeJS.ProcessEnv = process.env): MogaoSettings {
  const raw = ((config as { platform?: { mogao?: Record<string, unknown> } } | null)?.platform?.mogao ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const minutes = typeof raw.runTimeoutMinutes === "number" && raw.runTimeoutMinutes > 0 ? raw.runTimeoutMinutes : 240;
  return {
    command: text(env.LAOSHI_AIMAX) ?? text(raw.command) ?? "aimax",
    dataDir: text(raw.dataDir) ?? "/data",
    runTimeoutMinutes: minutes,
    pluginsConfig: text(raw.pluginsConfig),
  };
}

/** The platform's result of a run (`--output json`), as far as the engine reads it. */
export interface RunResult {
  sessionId?: string;
  text?: string;
  usage?: { input?: number; output?: number; total?: number; cacheReadTokens?: number } | null;
  paused?: { requestId: string; kind?: string; title?: string } | null;
  error?: string | null;
}

export function toAgentUsage(u: RunResult["usage"]): AgentUsage | null {
  if (!u) return null;
  // The platform counts tokens read from its prompt cache apart from `input` (cacheReadTokens).
  const cached = u.cacheReadTokens ?? 0;
  return { inputTokens: (u.input ?? 0) + cached, cachedInputTokens: cached, outputTokens: u.output ?? 0 };
}

/** Takes the JSON object out of a run's standard output (the last line that parses). */
export function parseRunOutput(stdout: string): RunResult | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as RunResult;
  } catch {
    for (const line of trimmed.split("\n").reverse()) {
      try {
        const value = JSON.parse(line.trim()) as unknown;
        if (value && typeof value === "object") return value as RunResult;
      } catch {
        // Not this line.
      }
    }
    return null;
  }
}

/** Platform credentials and tokens are never written to laoshi's files. */
export function redact(text: string): string {
  return text
    .replace(/(authorization["']?\s*[:=]\s*["']?(?:bearer\s+)?)[^\s"',}]+/gi, "$1***")
    .replace(/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1***")
    .replace(/((?:token|secret|password|api[_-]?key|credential)[A-Za-z_]*["']?\s*[:=]\s*["']?)[^\s"',}]{4,}/gi, "$1***")
    .replace(/(AIMAX_[A-Z_]*(?:TOKEN|KEY|SECRET)[A-Z_]*=)\S+/g, "$1***");
}

/** What laoshi keeps about one step agent between engine processes. */
interface AgentRecord {
  id: string;
  cwd: string;
  title: string;
  sessionId: string | null;
  /** Number of runs so far (run-<n>.out is the latest's output). */
  runs: number;
  /** The latest run's process, and the machine (container) it ran in. */
  pid: number | null;
  host: string | null;
  /** The HITL request a decision was sent for (decision.json), so it is answered once. */
  answered: string | null;
  /** When the latest run started: its callback events are the ones after this. */
  runStartedAt?: string | null;
}

/** A decision on a pending approval, written by `laoshi permission` (answerPermission). */
interface Decision {
  requestId: string;
  approve: boolean;
  reason: string;
}

const CONTINUE_MESSAGE = "上一次运行被中断了（对话轮次结束）。请接着完成原来的任务：先看一下已经做了什么，不要重复已经完成的部分。";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** How long a run may stay after printing its result before it counts as lingering. */
const LINGER_GRACE_MS = 2_000;

const isAlive = (pid: number) => engineProcessAlive(pid);

/** The callback receiver: one local HTTP server for all step agents of this engine process. */
class CallbackServer {
  private server: http.Server | null = null;
  private port = 0;
  constructor(private readonly onEvent: (agentId: string, event: Record<string, unknown>) => void) {}

  async url(agentId: string): Promise<string> {
    if (!this.server) {
      this.server = http.createServer((req, res) => {
        const agentId = decodeURIComponent((req.url ?? "").replace(/^\/cb\//, "").split("?")[0]);
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
          if (body.length < 4_000_000) body += chunk;
        });
        req.on("end", () => {
          res.writeHead(204).end();
          try {
            const event = JSON.parse(body) as Record<string, unknown>;
            if (agentId) this.onEvent(agentId, event);
          } catch {
            // Not an event.
          }
        });
      });
      await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
      this.port = (this.server.address() as { port: number }).port;
      this.server.unref();
    }
    return `http://127.0.0.1:${this.port}/cb/${encodeURIComponent(agentId)}`;
  }

  close(): Promise<void> {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}

/** An event's type and payload, whatever envelope the platform wraps them in. */
export function eventParts(event: Record<string, unknown>): { type: string; data: Record<string, unknown> } {
  const type = String(event.type ?? (typeof event.event === "string" ? event.event : "") ?? "");
  const data = (event.data ?? event.payload ?? event) as Record<string, unknown>;
  return { type, data: data && typeof data === "object" ? data : {} };
}

/**
 * The callback's events (the platform's CallbackEventPayload, discriminated by `type`): start,
 * progress (an agent progress event inside, e.g. a tool call), usage, done, error, hitl,
 * title_updated, … A progress event is unwrapped to the event it carries.
 */
export function callbackEvent(event: Record<string, unknown>): { type: string; data: Record<string, unknown>; progress: boolean } {
  const outer = eventParts(event);
  if (outer.type !== "progress") return { ...outer, progress: false };
  const inner = (outer.data.event ?? event.event) as unknown;
  if (!inner || typeof inner !== "object") return { ...outer, progress: true };
  const parts = eventParts(inner as Record<string, unknown>);
  return { type: parts.type || "progress", data: parts.data, progress: true };
}

export interface MogaoRuntimeOptions {
  settings: MogaoSettings;
  /** Where agents' records live: <install root>/mogao/agents. */
  agentsDir: string;
  log: (message: string) => void;
  /** Where notifications for the chat go (the chat's command output); null: the log only. */
  chatOut: string | null;
  env?: NodeJS.ProcessEnv;
  pollMs?: number;
}

export function createMogaoRuntime(options: MogaoRuntimeOptions): AgentRuntime {
  const { settings, agentsDir, log } = options;
  const env = options.env ?? process.env;
  const pollMs = options.pollMs ?? 500;
  const children = new Map<string, ChildProcess>();
  const dir = (id: string) => path.join(agentsDir, id);
  const recordFile = (id: string) => path.join(dir(id), "agent.json");
  const read = (id: string): AgentRecord | null => {
    try {
      return JSON.parse(fs.readFileSync(recordFile(id), "utf8")) as AgentRecord;
    } catch {
      return null;
    }
  };
  const write = (record: AgentRecord) => {
    fs.mkdirSync(dir(record.id), { recursive: true });
    fs.writeFileSync(recordFile(record.id), `${JSON.stringify(record, null, 2)}\n`);
  };
  const eventsFile = (id: string) => path.join(dir(id), "events.jsonl");

  const callbacks = new CallbackServer((agentId, event) => {
    if (!fs.existsSync(dir(agentId))) return;
    const { type, data, progress } = callbackEvent(event);
    if (type === "start" && typeof data.sessionId === "string") {
      const record = read(agentId);
      if (record && !record.sessionId) write({ ...record, sessionId: data.sessionId });
    }
    // Tool output can hold anything the agent printed: keep a redacted, shortened copy.
    const keep: Record<string, unknown> = { at: new Date().toISOString(), type };
    if (type === "tool_start") {
      const input = (data.input ?? {}) as Record<string, unknown>;
      Object.assign(keep, { callId: data.toolCallId, name: data.name, command: typeof input.command === "string" ? redact(input.command) : null, riskLevel: input.riskLevel ?? null });
    } else if (type === "tool_end") {
      const details = (data.details ?? {}) as Record<string, unknown>;
      Object.assign(keep, { callId: data.toolCallId, exitCode: details.exitCode ?? null, output: typeof data.output === "string" ? redact(data.output).slice(-2000) : null });
    } else if (type === "usage") {
      // { type: "usage", usage: UsagePayload }; earlier probes saw the numbers at the top level.
      const u = (data.usage && typeof data.usage === "object" ? data.usage : data) as Record<string, unknown>;
      Object.assign(keep, { input: u.input ?? null, output: u.output ?? null, total: u.total ?? null, cacheReadTokens: u.cacheReadTokens ?? null });
    } else if (type === "done") {
      const result = (data.result ?? {}) as Record<string, unknown>;
      Object.assign(keep, { usage: result.usage ?? null, text: typeof result.text === "string" ? redact(result.text).slice(0, 4000) : null });
    } else if (type === "error") {
      Object.assign(keep, { message: typeof data.message === "string" ? redact(data.message).slice(0, 2000) : null });
    } else if (progress) {
      // A progress event laoshi does not use yet: keep its kind only, to learn the platform's events.
      Object.assign(keep, { type: "progress", kind: type });
    } else if (type !== "start" && type !== "title_updated" && type !== "hitl") {
      return;
    }
    fs.appendFileSync(eventsFile(agentId), `${JSON.stringify(keep)}\n`);
  });

  const events = (id: string): Array<Record<string, unknown>> => {
    try {
      return fs
        .readFileSync(eventsFile(id), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
    } catch {
      return [];
    }
  };

  const toolCalls = async (id: string): Promise<ToolCall[] | null> => {
    if (!read(id)) return null;
    const calls = new Map<string, ToolCall>();
    for (const e of events(id)) {
      const callId = String(e.callId ?? "");
      if (!callId) continue;
      if (e.type === "tool_start") calls.set(callId, { callId, kind: e.name === "exec" ? "shell" : String(e.name ?? "tool"), text: String(e.command ?? ""), status: "running", startedAt: String(e.at) });
      else if (e.type === "tool_end" && calls.has(callId)) calls.get(callId)!.status = "completed";
    }
    return [...calls.values()];
  };

  /** Starts one `aimax` process for an agent: a new run, its continuation, or an approval's answer. */
  async function launch(record: AgentRecord, args: string[]): Promise<void> {
    const n = record.runs + 1;
    const out = fs.openSync(path.join(dir(record.id), `run-${n}.out`), "w");
    const err = fs.openSync(path.join(dir(record.id), `run-${n}.err`), "w");
    const callback = await callbacks.url(record.id);
    const child = spawn(settings.command, [...args, "--output", "json", "--callback-url", callback], { cwd: record.cwd, env, stdio: ["ignore", out, err], windowsHide: true });
    fs.closeSync(out);
    fs.closeSync(err);
    children.set(record.id, child);
    // A lingering run stopped after its result can exit after the next run started: forget only itself.
    const forget = () => {
      if (children.get(record.id) === child) children.delete(record.id);
    };
    child.on("exit", forget);
    child.on("error", (e) => {
      fs.appendFileSync(path.join(dir(record.id), `run-${n}.err`), `\n${e.message}\n`);
      forget();
    });
    write({ ...record, runs: n, pid: child.pid ?? null, host: os.hostname(), runStartedAt: new Date().toISOString() });
  }

  const runArgs = (record: AgentRecord, message: string) => [
    "run",
    ...(record.sessionId ? ["-s", record.sessionId] : ["--project-dir", record.cwd]),
    "-d",
    settings.dataDir,
    "--message",
    message,
    "--timeout",
    String(settings.runTimeoutMinutes * 60_000),
    ...(settings.pluginsConfig ? ["--plugins-config", settings.pluginsConfig] : []),
  ];

  /**
   * The latest run's result; null while it runs (here, or in another live process of this machine).
   * A run whose agent is done but whose `aimax run` process has not exited (seen in the sandbox:
   * the engine then waited until the platform ended its command) counts as finished once its
   * result is complete in its output or the platform's callback reported "done"; the lingering
   * process is stopped.
   */
  function finished(record: AgentRecord): { result: RunResult | null; stderr: string } | null {
    const read = (suffix: string) => {
      try {
        return fs.readFileSync(path.join(dir(record.id), `run-${record.runs}.${suffix}`), "utf8");
      } catch {
        return "";
      }
    };
    // Only the latest run's own process counts (an earlier run's may still be exiting).
    const tracked = children.get(record.id);
    const child = tracked && tracked.pid === record.pid && record.host === os.hostname() ? tracked : undefined;
    const alive = !!child || (!!record.pid && record.host === os.hostname() && isAlive(record.pid));
    const result = parseRunOutput(read("out"));
    if (!alive) return { result, stderr: read("err") };
    const complete = result && (result.paused || result.error || typeof result.text === "string");
    const done = complete ? null : doneEvent(record);
    if (!complete && !done) return null;
    // A process that has just printed its result usually exits a moment later: give it that moment.
    const since = (() => {
      try {
        return Date.now() - fs.statSync(path.join(dir(record.id), `run-${record.runs}.out`)).mtimeMs;
      } catch {
        return Infinity;
      }
    })();
    if (complete && since < LINGER_GRACE_MS) return null;
    log(`agent ${record.id} 已经做完，但 aimax run 进程还没有退出：按已完成处理，并结束这个进程`);
    if (child) child.kill("SIGTERM");
    else if (record.pid) {
      try {
        process.kill(record.pid, "SIGTERM");
      } catch {
        // Gone meanwhile.
      }
    }
    return {
      result: complete ? result : { sessionId: record.sessionId ?? undefined, ...(done!.error ? { error: done!.error } : { text: done!.text ?? "" }), usage: done!.usage ?? null },
      stderr: read("err"),
    };
  }

  /**
   * The platform's "done" (or "error") callback for the latest run, if it came: the last one after
   * the latest "start" (each run starts with one), and after the run was launched when that is known.
   */
  function doneEvent(record: AgentRecord): { text: string | null; usage: RunResult["usage"]; error: string | null } | null {
    const all = events(record.id);
    const lastStart = all.map((x) => x.type).lastIndexOf("start");
    const e = all.slice(lastStart + 1).filter((x) => (x.type === "done" || x.type === "error") && (!record.runStartedAt || String(x.at) >= record.runStartedAt)).at(-1);
    if (!e) return null;
    const usage = (e.usage ?? null) as RunResult["usage"];
    return { text: typeof e.text === "string" ? e.text : null, usage, error: e.type === "error" ? String(e.message ?? "运行出错") : null };
  }

  const stepAgent = (id: string): StepAgent => ({
    id,
    async wait(timeoutMs: number): Promise<WaitOutcome> {
      const deadline = Date.now() + timeoutMs;
      const base = { error: null, lastMessage: null, pendingPermissions: [] };
      for (;;) {
        let record = read(id);
        if (!record) return { ...base, status: "error", error: `找不到 laoshi 记录的 agent ${id}` };
        const done = finished(record);
        if (done) {
          const { result, stderr } = done;
          if (result?.sessionId && result.sessionId !== record.sessionId) {
            record = { ...record, sessionId: result.sessionId };
            write(record);
          }
          const usage = toAgentUsage(result?.usage);
          if (result?.paused?.requestId) {
            const decision = readDecision(id);
            if (decision && decision.requestId === result.paused.requestId && record.answered !== decision.requestId && record.sessionId) {
              await launch({ ...record, answered: decision.requestId }, [
                "resume",
                "-d",
                settings.dataDir,
                "-s",
                record.sessionId,
                "--request-id",
                decision.requestId,
                "--input-json",
                JSON.stringify({ action: decision.approve ? "approve" : "deny", reason: decision.reason }),
              ]);
              continue;
            }
            return { ...base, usage, status: "permission", pendingPermissions: [{ id: result.paused.requestId, title: result.paused.title ?? "需要批准的操作" }] };
          }
          if (result && !result.error) return { ...base, usage, status: "idle", lastMessage: result.text ?? null };
          if (result?.error) return { ...base, usage, status: "error", error: /timed out/i.test(result.error) ? `超过 ${settings.runTimeoutMinutes} 分钟（单次运行的上限），运行已停止` : result.error };
          // No result: the run was cut off (the chat's turn ended with the container). Continue its session.
          if (record.sessionId && record.host !== os.hostname()) {
            log(`agent ${id} 的上一次运行被中断（没有结果），接着它的会话 ${record.sessionId} 继续`);
            await launch(record, runArgs(record, CONTINUE_MESSAGE));
            continue;
          }
          return { ...base, status: "error", error: `运行没有输出结果${stderr.trim() ? `：${redact(stderr.trim()).split("\n").slice(-3).join(" ")}` : ""}` };
        }
        if (Date.now() >= deadline) return { ...base, status: "timeout", usage: latestUsage(id) };
        await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
      }
    },
    async followUp(text: string): Promise<void> {
      const record = read(id);
      if (!record?.sessionId) throw new Error(`agent ${id} 还没有会话，不能追问`);
      await launch(record, runArgs(record, text));
    },
    async archive(): Promise<void> {
      // Sessions stay with the platform (aimax sessions, export-html); nothing to archive.
    },
  });

  const readDecision = (id: string): Decision | null => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir(id), "decision.json"), "utf8")) as Decision;
    } catch {
      return null;
    }
  };

  const latestUsage = (id: string): AgentUsage | null => {
    const last = events(id).filter((e) => e.type === "usage").at(-1);
    return last ? toAgentUsage({ input: Number(last.input ?? 0), output: Number(last.output ?? 0), cacheReadTokens: Number(last.cacheReadTokens ?? 0) }) : null;
  };

  const chat = (text: string) => {
    log(`给对话的消息：${text.split("\n")[0]}`);
    if (options.chatOut) fs.appendFileSync(options.chatOut, `${text}\n\n`);
  };

  return {
    async verifyOrigin() {
      // The chat runs the engine in its own command, in the repository: nothing to check across.
    },

    async startAgent(input) {
      const record: AgentRecord = { id: `mogao-${crypto.randomBytes(6).toString("hex")}`, cwd: input.cwd, title: input.title, sessionId: null, runs: 0, pid: null, host: null, answered: null };
      write(record);
      const promptFile = path.join(dir(record.id), "prompt.md");
      fs.writeFileSync(promptFile, input.prompt);
      // One command-line argument holds at most 128 KB on Linux: a longer prompt is read from its file.
      const message = Buffer.byteLength(input.prompt) <= 100_000 ? input.prompt : `请先完整阅读文件 ${promptFile}，然后严格按照其中的要求完成任务。`;
      await launch(record, runArgs(record, message));
      return stepAgent(record.id);
    },

    attachAgent: (agentId) => stepAgent(agentId),

    async startSessionAgent() {
      throw new Error("摸高上不能为需求新开对话");
    },

    async notifyAgent(_agentId, text) {
      chat(text);
    },

    async interruptAgent(agentId, text) {
      const child = children.get(agentId);
      const record = read(agentId);
      if (child) {
        child.kill("SIGTERM");
        await new Promise((r) => child.once("exit", r));
      } else if (record?.pid && record.host === os.hostname() && isAlive(record.pid)) {
        process.kill(record.pid, "SIGTERM");
        for (let i = 0; i < 50 && isAlive(record.pid); i++) await sleep(100);
      }
      const now = read(agentId);
      if (now?.sessionId) await launch(now, runArgs(now, text));
    },

    agentDirectory: async () => null,
    listProfiles: async () => null,
    listServices: async () => null,
    startServices: async () => {
      throw new Error("摸高不管理服务");
    },
    stopServices: async () => undefined,
    createWorktree: async () => {
      throw new Error("摸高不提供工作区");
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
    scheduleMessage: async () => null,
    scheduleNewAgent: async () => null,
    cancelSchedule: async () => undefined,

    async answerPermission(agentId, requestId, approve, reason) {
      const record = read(agentId);
      if (!record) throw new Error(`找不到 laoshi 记录的 agent ${agentId}`);
      const pending = finished(record)?.result?.paused?.requestId ?? null;
      const id = requestId ?? pending;
      if (!id) throw new Error(`agent ${agentId}（${record.title}）现在没有等待批准的操作`);
      const decision: Decision = { requestId: id, approve, reason };
      fs.writeFileSync(path.join(dir(agentId), "decision.json"), `${JSON.stringify(decision, null, 2)}\n`);
    },

    async close() {
      for (const child of children.values()) child.kill("SIGTERM");
      await callbacks.close();
    },
  };
}

export const createRuntime: RuntimeFactory = async ({ config, log }) =>
  createMogaoRuntime({
    settings: mogaoSettings(config),
    agentsDir: path.join(homeOf().dir, "mogao", "agents"),
    log,
    chatOut: process.env.LAOSHI_CHAT_OUT?.trim() || null,
  });
