// The engine's runtime for coding-agent command lines (docs/design/cli-adapter.md, M3). Each step
// agent is a run of `claude -p` or `codex exec` (drivers.ts) in the step's directory, the prompt on
// standard input, JSON events on standard output; follow-ups and interrupts continue the session.
// There is no platform: no chat to message, no approvals, no schedules. Worktrees and services are
// laoshi's builtin ones; notifications go to the log, <install root>/cli/messages.log and the
// external notifiers.
//
// Every agent's state is on disk (<install root>/cli/agents/<id>/), so another engine process can
// pick it up; a run cut off without a result (the engine or the machine went away) is continued
// in its session instead of being done again.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentProfile } from "../../engine/src/config.js";
import type { ToolCall } from "../../engine/src/danger-guard.js";
import { homeOf } from "../../engine/src/locations.js";
import type { AgentRuntime, RuntimeFactory, StepAgent, WaitOutcome } from "../../engine/src/runtime.js";
import type { RunningTool } from "../../engine/src/scan-guard.js";
import { isAlive } from "../../engine/src/state.js";
import type { AgentUsage } from "../../engine/src/usage.js";
import { type Driver, DRIVERS, driverOf, type LineEvent } from "./drivers.js";

/** Settings from the install-level config's platform.cli. */
export interface CliSettings {
  /** Command of each command line ("claude", "codex"); LAOSHI_CLI_CLAUDE / LAOSHI_CLI_CODEX override them (tests). */
  commands: Record<string, string>;
  /** Hard limit of one run, in minutes (the engine keeps its own step limits). */
  runTimeoutMinutes: number;
}

export function cliSettings(config: unknown, env: NodeJS.ProcessEnv = process.env): CliSettings {
  const raw = ((config as { platform?: { cli?: Record<string, unknown> } } | null)?.platform?.cli ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const commands: Record<string, string> = {};
  for (const id of Object.keys(DRIVERS)) commands[id] = text(env[`LAOSHI_CLI_${id.toUpperCase()}`]) ?? text(raw[id]) ?? id;
  const minutes = typeof raw.runTimeoutMinutes === "number" && raw.runTimeoutMinutes > 0 ? raw.runTimeoutMinutes : 120;
  return { commands, runTimeoutMinutes: minutes };
}

/** Credentials and tokens are never written to laoshi's files. */
export function redact(text: string): string {
  return text
    .replace(/(authorization["']?\s*[:=]\s*["']?(?:bearer\s+)?)[^\s"',}]+/gi, "$1***")
    .replace(/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1***")
    .replace(/((?:token|secret|password|api[_-]?key|credential)[A-Za-z_]*["']?\s*[:=]\s*["']?)[^\s"',}]{4,}/gi, "$1***")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, "sk-***");
}

/** What laoshi keeps about one step agent between engine processes. */
interface AgentRecord {
  id: string;
  cwd: string;
  title: string;
  driver: string;
  model: string | null;
  modeId: string | null;
  sessionId: string | null;
  /** Number of runs so far (run-<n>.* are the latest's files). */
  runs: number;
  /** The latest run's process and the machine it ran on. */
  pid: number | null;
  host: string | null;
  /** Times a cut-off run was continued in its session. */
  continued: number;
}

/** The latest run's outcome, read from its output. */
interface RunOutcome {
  sessionId: string | null;
  final: LineEvent["final"] | null;
  text: string | null;
  usage: AgentUsage | null;
}

const CONTINUE_MESSAGE = "上一次运行被中断了（进程意外结束）。请接着完成原来的任务：先看一下已经做了什么，不要重复已经完成的部分。";
const MAX_CONTINUES = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Stops a run with what it started (on Windows the command line runs under cmd.exe: stop the tree). */
function stop(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Already gone.
  }
}

/** Each line of a run's standard output as an object; lines that are not JSON are skipped. */
function lines(text: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      out.push(JSON.parse(t) as Record<string, unknown>);
    } catch {
      // Not a whole JSON line.
    }
  }
  return out;
}

export function outcomeOf(driver: Driver, stdout: string): RunOutcome {
  const outcome: RunOutcome = { sessionId: null, final: null, text: null, usage: null };
  for (const value of lines(stdout)) {
    const e = driver.line(value);
    if (e.sessionId) outcome.sessionId = e.sessionId;
    if (e.text) outcome.text = e.text;
    if (e.usage) outcome.usage = e.usage;
    if (e.final) outcome.final = e.final;
  }
  return outcome;
}

export interface CliRuntimeOptions {
  settings: CliSettings;
  /** The roles' agent settings, for a step started without its own. */
  agents: Partial<Record<"builder" | "reviewer", AgentProfile>>;
  /** Where agents' records live: <install root>/cli/agents. */
  agentsDir: string;
  /** Where messages for people go: <install root>/cli/messages.log. */
  messagesFile: string;
  log: (message: string) => void;
  env?: NodeJS.ProcessEnv;
  pollMs?: number;
}

export function createCliRuntime(options: CliRuntimeOptions): AgentRuntime {
  const { settings, agentsDir, log } = options;
  const env = options.env ?? process.env;
  const pollMs = options.pollMs ?? 500;
  const children = new Map<string, ChildProcess>();
  const dir = (id: string) => path.join(agentsDir, id);
  const file = (id: string, name: string) => path.join(dir(id), name);
  const read = (id: string): AgentRecord | null => {
    try {
      return JSON.parse(fs.readFileSync(file(id, "agent.json"), "utf8")) as AgentRecord;
    } catch {
      return null;
    }
  };
  const write = (record: AgentRecord) => {
    fs.mkdirSync(dir(record.id), { recursive: true });
    fs.writeFileSync(file(record.id, "agent.json"), `${JSON.stringify(record, null, 2)}\n`);
  };
  const readText = (p: string) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };

  /** Tool calls as they happen, with the time laoshi saw them (redacted). */
  const recordTool = (id: string, e: LineEvent, seen: Set<string>) => {
    const at = new Date().toISOString();
    const events = file(id, "events.jsonl");
    if (e.toolStart && !seen.has(`s:${e.toolStart.callId}`)) {
      seen.add(`s:${e.toolStart.callId}`);
      fs.appendFileSync(events, `${JSON.stringify({ at, type: "tool_start", callId: e.toolStart.callId, kind: e.toolStart.kind, text: redact(e.toolStart.text).slice(0, 2000) })}\n`);
    }
    if (e.toolEnd && !seen.has(`e:${e.toolEnd.callId}`)) {
      seen.add(`e:${e.toolEnd.callId}`);
      fs.appendFileSync(events, `${JSON.stringify({ at, type: "tool_end", callId: e.toolEnd.callId, exitCode: e.toolEnd.exitCode })}\n`);
    }
  };

  /** Starts one run of the agent's command line: a new session, or a continuation of its session. */
  function launch(record: AgentRecord, message: string): void {
    const driver = DRIVERS[record.driver];
    const n = record.runs + 1;
    const out = file(record.id, `run-${n}.out`);
    const err = file(record.id, `run-${n}.err`);
    fs.writeFileSync(out, "");
    fs.writeFileSync(err, "");
    const args = driver.args({ cwd: record.cwd, model: record.model, modeId: record.modeId, sessionId: record.sessionId });
    const child = spawn(settings.commands[record.driver], args, { cwd: record.cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, shell: process.platform === "win32" });
    children.set(record.id, child);
    write({ ...record, runs: n, pid: child.pid ?? null, host: os.hostname() });
    const seen = new Set<string>();
    let pending = "";
    child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
      fs.appendFileSync(out, chunk);
      pending += chunk;
      const parts = pending.split("\n");
      pending = parts.pop() ?? "";
      for (const value of lines(parts.join("\n"))) {
        const e = driver.line(value);
        if (e.sessionId) {
          const now = read(record.id);
          if (now && now.sessionId !== e.sessionId) write({ ...now, sessionId: e.sessionId });
        }
        recordTool(record.id, e, seen);
      }
    });
    child.stderr!.setEncoding("utf8").on("data", (chunk: string) => fs.appendFileSync(err, chunk));
    const limit = setTimeout(() => {
      fs.writeFileSync(file(record.id, `run-${n}.timeout`), new Date().toISOString());
      stop(child.pid);
    }, settings.runTimeoutMinutes * 60_000);
    limit.unref();
    child.on("exit", (code, signal) => {
      clearTimeout(limit);
      fs.writeFileSync(file(record.id, `run-${n}.exit`), JSON.stringify({ code, signal }));
      children.delete(record.id);
    });
    child.on("error", (e) => {
      clearTimeout(limit);
      fs.appendFileSync(err, `\n${e.message}\n`);
      fs.writeFileSync(file(record.id, `run-${n}.exit`), JSON.stringify({ code: null, signal: null, error: e.message }));
      children.delete(record.id);
    });
    child.stdin!.on("error", () => undefined);
    child.stdin!.end(message);
  }

  const running = (record: AgentRecord) =>
    children.has(record.id) || (!!record.pid && record.host === os.hostname() && !fs.existsSync(file(record.id, `run-${record.runs}.exit`)) && isAlive(record.pid));

  const stepAgent = (id: string): StepAgent => ({
    id,
    async wait(timeoutMs: number): Promise<WaitOutcome> {
      const deadline = Date.now() + timeoutMs;
      const base = { error: null, lastMessage: null, pendingPermissions: [] };
      for (;;) {
        const record = read(id);
        if (!record) return { ...base, status: "error", error: `找不到 laoshi 记录的 agent ${id}` };
        if (!running(record)) {
          const driver = DRIVERS[record.driver];
          const done = outcomeOf(driver, readText(file(id, `run-${record.runs}.out`)));
          if (done.sessionId && done.sessionId !== record.sessionId) write({ ...record, sessionId: done.sessionId });
          if (done.final?.ok) return { ...base, status: "idle", usage: done.usage, lastMessage: done.final.text ?? done.text };
          if (fs.existsSync(file(id, `run-${record.runs}.timeout`))) {
            return { ...base, status: "error", usage: done.usage, error: `超过 ${settings.runTimeoutMinutes} 分钟（单次运行的上限），运行已停止` };
          }
          if (done.final) return { ...base, status: "error", usage: done.usage, error: redact(done.final.error ?? "运行出错") };
          const exit = readText(file(id, `run-${record.runs}.exit`));
          const sessionId = done.sessionId ?? record.sessionId;
          // No result and no exit record: the run was cut off with the process that watched it.
          if (!exit && sessionId && record.continued < MAX_CONTINUES) {
            log(`agent ${id} 的上一次运行被中断（没有结果），接着它的会话 ${sessionId} 继续`);
            const next = { ...(read(id) ?? record), sessionId, continued: record.continued + 1 };
            write(next);
            launch(next, CONTINUE_MESSAGE);
            continue;
          }
          const stderr = redact(readText(file(id, `run-${record.runs}.err`)).trim()).split("\n").slice(-3).join(" ");
          const how = exit ? (JSON.parse(exit) as { code: number | null; error?: string }) : null;
          return { ...base, status: "error", usage: done.usage, error: `${driver.label} 没有给出结果${how?.error ? `（${how.error}）` : how?.code != null ? `（退出码 ${how.code}）` : ""}${stderr ? `：${stderr}` : ""}` };
        }
        if (Date.now() >= deadline) return { ...base, status: "timeout", usage: outcomeOf(DRIVERS[record.driver], readText(file(id, `run-${record.runs}.out`))).usage };
        await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
      }
    },
    async followUp(text: string): Promise<void> {
      const record = read(id);
      if (!record?.sessionId) throw new Error(`agent ${id} 还没有会话，不能追问`);
      launch(record, text);
    },
    async archive(): Promise<void> {
      // The command lines keep their own sessions; nothing to archive.
    },
  });

  const events = (id: string): Array<Record<string, unknown>> => lines(readText(file(id, "events.jsonl")));

  const toolCalls = async (id: string): Promise<ToolCall[] | null> => {
    if (!read(id)) return null;
    const calls = new Map<string, ToolCall>();
    for (const e of events(id)) {
      const callId = String(e.callId ?? "");
      if (!callId) continue;
      if (e.type === "tool_start") calls.set(callId, { callId, kind: String(e.kind ?? "tool"), text: String(e.text ?? ""), status: "running", startedAt: String(e.at) });
      else if (e.type === "tool_end" && calls.has(callId)) calls.get(callId)!.status = "completed";
    }
    return [...calls.values()];
  };

  const message = (text: string) => {
    log(`消息：${text.split("\n")[0]}`);
    fs.mkdirSync(path.dirname(options.messagesFile), { recursive: true });
    fs.appendFileSync(options.messagesFile, `[${new Date().toISOString()}]\n${text}\n\n`);
    const chatOut = env.LAOSHI_CHAT_OUT?.trim();
    if (chatOut) fs.appendFileSync(chatOut, `${text}\n\n`);
  };

  return {
    async verifyOrigin() {
      // No platform chat to check: the pipeline runs on its own and reports to the log.
    },

    async startAgent(input) {
      const profile = input.profile ?? options.agents[input.role];
      const { driver, model } = driverOf(profile?.provider);
      const record: AgentRecord = {
        id: `cli-${crypto.randomBytes(6).toString("hex")}`,
        cwd: input.cwd,
        title: input.title,
        driver: driver.id,
        model,
        modeId: profile?.modeId ?? null,
        sessionId: null,
        runs: 0,
        pid: null,
        host: null,
        continued: 0,
      };
      write(record);
      fs.writeFileSync(file(record.id, "prompt.md"), input.prompt);
      launch(record, input.prompt);
      return stepAgent(record.id);
    },

    attachAgent: (agentId) => stepAgent(agentId),

    async startSessionAgent() {
      throw new Error("命令行适配器不能为需求新开对话");
    },

    async notifyAgent(_agentId, text) {
      message(text);
    },

    async interruptAgent(agentId, text) {
      const child = children.get(agentId);
      const record = read(agentId);
      if (child) {
        const exited = new Promise((r) => child.once("exit", r));
        stop(child.pid);
        await exited;
      } else if (record?.pid && record.host === os.hostname() && isAlive(record.pid)) {
        stop(record.pid);
        for (let i = 0; i < 50 && isAlive(record.pid); i++) await sleep(100);
      }
      const now = read(agentId);
      if (now?.sessionId) launch(now, text);
    },

    agentDirectory: async (agentId) => read(agentId)?.cwd ?? null,
    listProfiles: async () => null,
    listServices: async () => null,
    startServices: async () => {
      throw new Error("命令行适配器不管理服务");
    },
    stopServices: async () => undefined,
    createWorktree: async () => {
      throw new Error("命令行适配器不提供工作区");
    },
    waitForWorkspaceSetup: async () => ({ status: "none", error: null }),
    providerQuota: async () => null,

    async recentActivity(agentId, limit) {
      const calls = await toolCalls(agentId);
      return calls ? calls.slice(-limit).map((c) => ({ at: c.startedAt, text: c.kind === "shell" ? `运行命令：${c.text}` : `${c.kind}：${c.text}` })) : null;
    },

    async runningTool(agentId): Promise<RunningTool | null> {
      const current = (await toolCalls(agentId))?.filter((c) => c.status === "running").at(-1);
      return current ? { kind: current.kind, text: current.text, startedAt: current.startedAt, callId: current.callId } : null;
    },

    toolCalls,
    capabilities: async () => null,

    async providerStatus() {
      const used = new Set(Object.values(options.agents).map((p) => (p?.provider ?? "").split("/")[0]).filter((id) => DRIVERS[id]));
      return [...used].map((id) => ({ provider: id, status: versionOf(settings.commands[id], env) ? "ready" : "missing" }));
    },

    scheduleMessage: async () => null,
    scheduleNewAgent: async () => null,
    cancelSchedule: async () => undefined,

    async close() {
      for (const child of children.values()) stop(child.pid);
    },
  };
}

/** `<command> --version`, or null when it does not run. */
export function versionOf(command: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const r = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 20_000, env, windowsHide: true, shell: process.platform === "win32" });
  if (r.error || r.status !== 0) return null;
  return (r.stdout || r.stderr || "").trim().split("\n")[0] || "?";
}

export const createRuntime: RuntimeFactory = async ({ config, log }) =>
  createCliRuntime({
    settings: cliSettings(config),
    agents: config.agents,
    agentsDir: path.join(homeOf().dir, "cli", "agents"),
    messagesFile: path.join(homeOf().dir, "cli", "messages.log"),
    log,
  });
