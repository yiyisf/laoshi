// The coding-agent command lines the cli adapter runs (docs/design/cli-adapter.md): how to start and
// continue a run, and how to read the JSON events each prints on standard output (one per line).
import type { AgentUsage } from "../../engine/src/usage.js";

/** What one line of a run's output says, as far as laoshi reads it. */
export interface LineEvent {
  sessionId?: string;
  toolStart?: { callId: string; kind: string; text: string };
  toolEnd?: { callId: string; exitCode: number | null };
  /** An assistant message (the last one is the run's reply). */
  text?: string;
  usage?: AgentUsage;
  /** The run ended: ok, with the reply or the error. */
  final?: { ok: boolean; text: string | null; error: string | null };
}

export interface RunRequest {
  cwd: string;
  /** null: the command line's default model. */
  model: string | null;
  modeId: string | null;
  /** Continue this session (follow-up, interrupt, a cut-off run); null for a new one. */
  sessionId: string | null;
}

export interface Driver {
  id: "claude" | "codex";
  /** For people, e.g. in doctor. */
  label: string;
  /** Arguments; the prompt goes to standard input. */
  args(request: RunRequest): string[];
  /** One line of standard output. */
  line(value: Record<string, unknown>): LineEvent;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A tool call in one line, e.g. a shell command or the file a tool reads. */
function toolText(name: string, input: Record<string, unknown>): string {
  for (const key of ["command", "file_path", "path", "pattern", "url", "query"]) {
    const v = str(input[key]);
    if (v) return v;
  }
  const json = JSON.stringify(input);
  return `${name} ${json.length > 200 ? `${json.slice(0, 200)}…` : json}`;
}

/** Claude Code: `claude -p --output-format stream-json --verbose`. */
export const claudeDriver: Driver = {
  id: "claude",
  label: "Claude Code",
  args({ model, modeId, sessionId }) {
    return [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      modeId ?? "bypassPermissions",
      ...(model ? ["--model", model] : []),
      ...(sessionId ? ["--resume", sessionId] : []),
    ];
  },
  line(v) {
    const event: LineEvent = {};
    const session = str(v.session_id);
    if (session) event.sessionId = session;
    const content = ((v.message as { content?: unknown } | undefined)?.content ?? []) as Array<Record<string, unknown>>;
    if (v.type === "assistant" && Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "tool_use") {
          const name = str(part.name) ?? "tool";
          event.toolStart = { callId: str(part.id) ?? "", kind: name === "Bash" ? "shell" : name.toLowerCase(), text: toolText(name, (part.input ?? {}) as Record<string, unknown>) };
        } else if (part.type === "text" && str(part.text)) {
          event.text = str(part.text)!;
        }
      }
    } else if (v.type === "user" && Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "tool_result") event.toolEnd = { callId: str(part.tool_use_id) ?? "", exitCode: part.is_error ? 1 : 0 };
      }
    } else if (v.type === "result") {
      const u = (v.usage ?? {}) as Record<string, unknown>;
      event.usage = { inputTokens: num(u.input_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens), cachedInputTokens: num(u.cache_read_input_tokens), outputTokens: num(u.output_tokens), ...(typeof v.total_cost_usd === "number" ? { totalCostUsd: v.total_cost_usd } : {}) };
      const ok = v.is_error !== true && (v.subtype === undefined || v.subtype === "success");
      event.final = { ok, text: str(v.result), error: ok ? null : (str(v.result) ?? str(v.subtype) ?? "运行出错") };
    }
    return event;
  },
};

/** Codex: `codex exec --json`, continued with `codex exec … resume <thread>`. */
export const codexDriver: Driver = {
  id: "codex",
  label: "Codex",
  args({ cwd, model, modeId, sessionId }) {
    const mode = modeId ?? "full-access";
    const permissions =
      mode === "full-access" ? ["--dangerously-bypass-approvals-and-sandbox"] : mode === "read-only" ? ["--sandbox", "read-only"] : ["--full-auto"];
    return [
      "exec",
      "--json",
      "--skip-git-repo-check",
      ...permissions,
      ...(model ? ["--model", model] : []),
      ...(sessionId ? ["resume", sessionId, "-"] : ["--cd", cwd, "-"]),
    ];
  },
  line(v) {
    const event: LineEvent = {};
    if (v.type === "thread.started" && str(v.thread_id)) event.sessionId = str(v.thread_id)!;
    const item = (v.item ?? {}) as Record<string, unknown>;
    if (item.type === "command_execution") {
      const callId = str(item.id) ?? "";
      if (v.type === "item.started") event.toolStart = { callId, kind: "shell", text: str(item.command) ?? "" };
      else if (v.type === "item.completed") {
        event.toolStart = { callId, kind: "shell", text: str(item.command) ?? "" };
        event.toolEnd = { callId, exitCode: typeof item.exit_code === "number" ? item.exit_code : null };
      }
    } else if (item.type === "agent_message" && v.type === "item.completed" && str(item.text)) {
      event.text = str(item.text)!;
    }
    if (v.type === "turn.completed") {
      const u = (v.usage ?? {}) as Record<string, unknown>;
      event.usage = { inputTokens: num(u.input_tokens), cachedInputTokens: num(u.cached_input_tokens), outputTokens: num(u.output_tokens) };
      event.final = { ok: true, text: null, error: null };
    } else if (v.type === "turn.failed") {
      event.final = { ok: false, text: null, error: str((v.error as { message?: unknown } | undefined)?.message) ?? "运行失败" };
    } else if (v.type === "error") {
      event.final = { ok: false, text: null, error: str(v.message) ?? "运行出错" };
    }
    return event;
  },
};

export const DRIVERS: Record<string, Driver> = { claude: claudeDriver, codex: codexDriver };

/** "claude/opus" → the Claude driver and model "opus"; "default" (or none) → the command line's own default. */
export function driverOf(provider: string | undefined): { driver: Driver; model: string | null } {
  const [id, ...rest] = (provider ?? "").split("/");
  const driver = DRIVERS[id];
  if (!driver) throw new Error(`命令行适配器不认识 agent "${provider ?? ""}"：provider 写成 claude/<模型> 或 codex/<模型>（模型写 default 表示用命令行自己的默认模型）`);
  const model = rest.join("/").trim();
  return { driver, model: model && model !== "default" ? model : null };
}
