// laoshi's plugin for the DeepSeek Harness (dsh) host (ADR 0008, docs/design/dsh-adapter.md).
//
// The laoshi engine runs outside dsh and calls only this plugin, over a local socket guarded by a
// token (channel.mjs). The plugin does inside the host what dsh's /api cannot: start a step agent
// as a child of the chat, schedule a message into the chat, answer a step's approval request by
// policy; and it relays the rest (prompt, cancel, status, history) to dsh's session controller.
// It holds no pipeline logic: order, rounds and gates stay in the engine.
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { channelPaths, dshHome } from "./channel.mjs";

export const name = "laoshi-dsh";
export const inject = ["agents", "subagents", "schedule", "approval", "sessionController", "llm"];

const VERSION = "0.2.0-beta.1";
const SHELL_TOOLS = new Set(["bash", "pwsh"]);
const SEARCH_TOOLS = new Set(["grep", "glob"]);

/**
 * @param {any} ctx dsh's Cordis context.
 * @param {{ home?: string, approvals?: "ask" | "allow", subagentProvider?: string }} config
 *   approvals: "ask" (default) leaves a step's approval request to the person in dsh's UI and
 *   reports it to the engine; "allow" grants it once. Only laoshi's own step agents are affected.
 */
export function apply(ctx, config = {}) {
  const paths = channelPaths(config.home ? path.resolve(config.home) : dshHome());
  fs.mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  const log = (o) => {
    try {
      fs.appendFileSync(paths.log, JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n");
    } catch {}
  };
  const sessions = ctx.sessionController;
  const approvals = config.approvals === "allow" ? "allow" : "ask";
  const timeout = () => AbortSignal.timeout(60_000);

  // Step agents laoshi started, child -> parent. Kept on disk so they are known after a restart.
  const childrenFile = path.join(paths.dir, "children.json");
  /** @type {Record<string, string>} */
  const children = fs.existsSync(childrenFile) ? JSON.parse(fs.readFileSync(childrenFile, "utf8")) : {};
  const saveChildren = () => fs.writeFileSync(childrenFile, JSON.stringify(children));
  /** Activations started in this process: the first turn of a child, and how it ended. */
  const activations = new Map();
  /** Approval requests of laoshi's step agents that wait for a person, by session. */
  const pending = new Map();
  let approvalCount = 0;

  ctx.on(
    "approval/request",
    async (req, next) => {
      const sessionId = req.agent?.id;
      if (!sessionId || !(sessionId in children)) return next(); // not a laoshi step: leave it alone
      const title = [req.toolName, req.reason].filter(Boolean).join("：");
      if (approvals === "allow") {
        log({ approval: "allowed-once", sessionId, title });
        return "allowed-once";
      }
      const id = `approval-${++approvalCount}`;
      const list = pending.get(sessionId) ?? [];
      list.push({ id, title });
      pending.set(sessionId, list);
      log({ approval: "asked", sessionId, title });
      try {
        return await next();
      } finally {
        const rest = (pending.get(sessionId) ?? []).filter((p) => p.id !== id);
        if (rest.length) pending.set(sessionId, rest);
        else pending.delete(sessionId);
      }
    },
    { prepend: true }, // the Web gateway's answerer forwards to the browser and does not call next()
  );

  const address = (sessionId) =>
    sessionId in children
      ? { kind: "subagent", parentSessionId: children[sessionId], childSessionId: sessionId, mode: "continuable" }
      : { kind: "session", sessionId };

  async function summary(sessionId) {
    const { items } = await sessions.list({}, timeout());
    return items.find((i) => i.sessionId === sessionId) ?? null;
  }

  async function events(sessionId) {
    const page = await sessions.page({ address: address(sessionId), maxMessages: 1000 }, timeout());
    return page.records.filter((r) => r.type === "event").map((r) => r.event);
  }

  async function prompt(sessionId, text, mode = "queue") {
    const content = [{ type: "text", text }];
    const requestId = `laoshi-${crypto.randomUUID()}`;
    if (sessionId in children) {
      await ctx.subagents.prompt(
        { requestId, parentSessionId: children[sessionId], childSessionId: sessionId, mode: "continuable", delivery: mode, content },
        timeout(),
      );
    } else {
      await sessions.prompt({ requestId, sessionId, mode, content }, timeout());
    }
  }

  async function liveAgent(sessionId) {
    const live = ctx.agents.get(sessionId);
    if (live) return live;
    const handle = await ctx.agents.resume({ resumeSessionId: sessionId });
    return handle.agent;
  }

  const methods = {
    hello: async () => ({ plugin: VERSION, approvals }),

    /** The chat (or any session): does it exist, where does it work. */
    session: async ({ sessionId }) => {
      const s = await summary(sessionId);
      return s ? { exists: true, cwd: s.cwd ?? null, running: s.running, parentSessionId: s.parentSessionId ?? null } : { exists: false };
    },

    /** A step agent as a child of the chat, labelled, working in cwd; its result goes to the engine only. */
    spawn: async ({ parent, label, prompt: text, cwd, model }) => {
      const parentAgent = await liveAgent(parent);
      const provider = config.subagentProvider ?? "spawn";
      // The step's own model (the role's provider/model in laoshi's config); without it, the chat's.
      const agentOptions = model?.provider && model?.model ? { provider: model.provider, model: model.model, ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}) } : null;
      const activation = await ctx.subagents.startActivation({
        provider,
        label,
        request: { prompt: [{ type: "text", text }], parent: parentAgent, cwd, ...(agentOptions ? { agentOptions } : {}) },
        signal: new AbortController().signal,
        delivery: "caller",
      });
      const childId = activation.childId;
      children[childId] = parent;
      saveChildren();
      const entry = { settled: null };
      activations.set(childId, entry);
      activation.result.then(
        (result) => (entry.settled = { ok: true, stopReason: result?.stopReason ?? null }),
        (error) => (entry.settled = { ok: false, error: String(error?.message ?? error) }),
      );
      log({ spawn: childId, parent, label, provider, cwd, model: agentOptions });
      return { childId };
    },

    /** The models step agents can use: every provider route with an adapter, and its models. */
    models: async () => {
      const providers = [];
      for (const p of ctx.llm.listProviders()) {
        const models = await ctx.llm.listModels(p.id).catch(() => []);
        providers.push({ provider: p.id, name: p.name, models: models.map((m) => ({ id: m.id, name: m.name })) });
      }
      return { providers };
    },

    /** Is the session working, waiting for an approval, how much has it used. */
    status: async ({ sessionId }) => {
      const s = await summary(sessionId);
      if (!s) return { exists: false };
      const values = s.projections?.values ?? {};
      const inbox = values.inbox ?? {};
      const queued = (inbox["next-turn"]?.length ?? 0) + (inbox["next-step"]?.length ?? 0);
      const activation = activations.get(sessionId);
      const firstTurn = activation && activation.settled === null;
      return {
        exists: true,
        running: Boolean(s.running) || queued > 0 || Boolean(firstTurn),
        pendingPermissions: pending.get(sessionId) ?? [],
        usage: values.tokenUsage ?? null,
        error: activation?.settled && !activation.settled.ok ? activation.settled.error : null,
      };
    },

    /** The last thing the agent said. */
    lastMessage: async ({ sessionId }) => {
      const texts = (await events(sessionId))
        .filter((e) => e.type === "assistant/message")
        .map((e) => (e.data.message?.content ?? []).filter((p) => p.type === "text").map((p) => p.text).join(""));
      return { text: texts.at(-1) ?? null };
    },

    /** The session's tool calls, in the engine's terms (shell / search / …). */
    toolCalls: async ({ sessionId }) => {
      const evs = await events(sessionId);
      const done = new Set(evs.filter((e) => e.type === "tool/result").map((e) => e.data.message?.toolCallId));
      return {
        calls: evs
          .filter((e) => e.type === "tool/call")
          .map((e) => {
            let args = {};
            try {
              args = JSON.parse(e.data.arguments ?? "{}");
            } catch {}
            const tool = String(e.data.name ?? "");
            const kind = SHELL_TOOLS.has(tool) ? "shell" : SEARCH_TOOLS.has(tool) ? "search" : tool;
            const text = kind === "shell" ? args.command : kind === "search" ? (args.pattern ?? args.query) : (args.command ?? "");
            return {
              callId: String(e.data.callId),
              kind,
              text: String(text ?? ""),
              status: done.has(e.data.callId) ? "completed" : "running",
              startedAt: new Date(e.time).toISOString(),
            };
          }),
      };
    },

    /** A message into the session, after its current turn (never interrupting it). */
    prompt: async ({ sessionId, text }) => {
      await prompt(sessionId, text, "queue");
      return {};
    },

    /** Stop the session's current turn, then give it text. */
    interrupt: async ({ sessionId, text }) => {
      if (sessionId in children) ctx.subagents.interruptByParent(sessionId, children[sessionId], "continuable");
      else sessions.cancel({ sessionId });
      if (text) await prompt(sessionId, text, "queue");
      return {};
    },

    /** A new top-level session in cwd, given a first message (a requirement's own chat). */
    startSession: async ({ cwd, prompt: text }) => {
      const { sessionId } = await sessions.create({ cwd });
      await prompt(sessionId, text, "queue");
      return { sessionId };
    },

    /** A message into the session at a time (`at`, ISO) or on a five-field cron in a time zone. */
    schedule: async ({ sessionId, title, prompt: text, at, cron, timeZone }) => {
      const timing = cron ? { cron: { expression: cron, time_zone: timeZone } } : { at };
      const record = await ctx.schedule.create(sessionId, { title, prompt: text, ...timing });
      log({ schedule: record.id, sessionId, title });
      return { id: record.id };
    },

    cancelSchedule: async ({ sessionId, id }) => {
      await ctx.schedule.delete({ sessionId, id });
      return {};
    },
  };

  // ---- the local socket
  const token = crypto.randomBytes(32).toString("hex");
  const tokenOk = (given) => typeof given === "string" && given.length === token.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        handle(line).then((reply) => socket.write(JSON.stringify(reply) + "\n"));
      }
    });
    socket.on("error", () => {});
  });

  async function handle(line) {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return { id: null, ok: false, error: "bad request" };
    }
    if (!tokenOk(req.token)) return { id: req.id ?? null, ok: false, error: "unauthorized" };
    const method = methods[req.method];
    if (!method) return { id: req.id, ok: false, error: `unknown method ${req.method}` };
    try {
      return { id: req.id, ok: true, result: await method(req.params ?? {}) };
    } catch (e) {
      log({ method: req.method, error: String(e?.stack ?? e).slice(0, 800) });
      return { id: req.id, ok: false, error: String(e?.message ?? e) };
    }
  }

  if (process.platform !== "win32") fs.rmSync(paths.socket, { force: true });
  server.listen(paths.socket, () => {
    if (process.platform !== "win32") fs.chmodSync(paths.socket, 0o600);
    fs.writeFileSync(paths.token, token, { mode: 0o600 });
    log({ listening: paths.socket, version: VERSION, approvals });
  });
  server.on("error", (e) => log({ serverError: String(e?.message ?? e) }));

  ctx.on("dispose", () => {
    server.close();
    fs.rmSync(paths.token, { force: true });
    if (process.platform !== "win32") fs.rmSync(paths.socket, { force: true });
  });
}
