// laoshi's plugin for the DeepSeek Harness (dsh) host (ADR 0008, docs/design/dsh-adapter.md).
//
// The laoshi engine runs outside dsh and calls only this plugin, over a local socket guarded by a
// token (channel.mjs). The plugin does inside the host what dsh's /api cannot: start a step agent
// as a child of the chat, schedule a message into the chat, answer a step's approval request by
// policy; and it relays the rest (prompt, cancel, status, history) to dsh's session controller.
// It holds no pipeline logic: order, rounds and gates stay in the engine.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { channelPaths, dshHome } from "./channel.mjs";

export const name = "laoshi-dsh";
export const inject = ["agents", "subagents", "schedule", "approval", "sessionController", "llm"];

const VERSION = "0.3.2-dev";
const SHELL_TOOLS = new Set(["bash", "pwsh"]);
const SEARCH_TOOLS = new Set(["grep", "glob"]);
const LAOSHI_WEB_PREFIX = "/laoshi";

const escapeHtmlText = (text) =>
  String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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

  const modernSubagents = typeof ctx.subagents.interrupt === "function" || typeof ctx.subagents.interruptByUser === "function";
  const modernSchedule = typeof ctx.schedule.edit === "function" && typeof ctx.schedule.delete !== "function";

  async function events(sessionId) {
    const req = { address: address(sessionId), maxMessages: 1000 };
    const page = sessions.events ? await sessions.events(req, timeout()) : await sessions.page(req, timeout());
    return page.records.filter((r) => r.type === "event").map((r) => r.event);
  }

  async function prompt(sessionId, text, mode = "queue") {
    const content = [{ type: "text", text }];
    const requestId = `laoshi-${crypto.randomUUID()}`;
    if (sessionId in children) {
      await ctx.subagents.prompt(
        {
          requestId,
          ...(modernSubagents ? {} : { parentSessionId: children[sessionId], mode: "continuable" }),
          childSessionId: sessionId,
          delivery: mode,
          content,
        },
        timeout(),
      );
    } else {
      await sessions.prompt({ requestId, sessionId, mode, content }, timeout());
    }
  }

  async function createScheduleTask({ sessionId, title, prompt: text, at, cron, timeZone }) {
    if (!modernSchedule) {
      const timing = cron ? { cron: { expression: cron, time_zone: timeZone } } : { at };
      return ctx.schedule.create(sessionId, { title, prompt: text, ...timing });
    }
    const resolvedTz = typeof timeZone === "string" && timeZone.trim() ? timeZone.trim() : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const timing = cron ? { kind: "cron", cron: { expression: cron, time_zone: resolvedTz } } : { kind: "at", at };
    return ctx.schedule.create(
      {
        title: typeof title === "string" && title.trim() ? title.trim() : "laoshi",
        prompt: text,
        timing,
        target: { kind: "session", sessionId },
      },
      sessionId,
    );
  }

  async function deleteScheduleTask({ sessionId, id }) {
    if (modernSchedule) return ctx.schedule.edit({ id, action: "delete" }, undefined);
    return ctx.schedule.delete({ sessionId, id });
  }

  async function liveAgent(sessionId) {
    const live = ctx.agents.get(sessionId);
    if (live) return live;
    const handle = await ctx.agents.resume({ resumeSessionId: sessionId });
    return handle.agent;
  }

  const methods = {
    hello: async () => ({
      plugin: VERSION,
      approvals,
      ...(process.env.DSH_VERSION?.trim() ? { dshVersion: process.env.DSH_VERSION.trim() } : {}),
    }),

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
      const content = [{ type: "text", text }];
      const spec = modernSubagents
        ? {
            provider,
            label,
            parent: parentAgent,
            prompt: content,
            cwd,
            ...(agentOptions ? { agentOptions } : {}),
            signal: new AbortController().signal,
            delivery: "caller",
          }
        : {
            provider,
            label,
            request: { prompt: content, parent: parentAgent, cwd, ...(agentOptions ? { agentOptions } : {}) },
            signal: new AbortController().signal,
            delivery: "caller",
          };
      const activation = await ctx.subagents.startActivation(spec);
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
      if (sessionId in children) {
        if (typeof ctx.subagents.interrupt === "function") ctx.subagents.interrupt(sessionId, { kind: "user" });
        else if (typeof ctx.subagents.interruptByUser === "function") ctx.subagents.interruptByUser(sessionId);
        else ctx.subagents.interruptByParent(sessionId, children[sessionId], "continuable");
      } else {
        sessions.cancel({ sessionId });
      }
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
    schedule: async ({ sessionId, title, prompt: text, at, cron, timeZone, expiresAt }) => {
      const record = await createScheduleTask({ sessionId, title, prompt: text, at, cron, timeZone });
      if (typeof expiresAt === "string" && expiresAt.trim()) {
        const ms = Date.parse(expiresAt) - Date.now();
        if (Number.isFinite(ms)) {
          const key = `${sessionId}/${record.id}`;
          const delay = Math.min(2_147_483_647, Math.max(0, ms));
          const timer = setTimeout(() => {
            scheduleTimers.delete(key);
            deleteScheduleTask({ sessionId, id: record.id }).catch(() => {});
            log({ scheduleExpired: record.id, sessionId });
          }, delay);
          timer.unref?.();
          scheduleTimers.set(key, timer);
        }
      }
      log({ schedule: record.id, sessionId, title, ...(expiresAt ? { expiresAt } : {}) });
      return { id: record.id };
    },

    /** A cron schedule that creates a dedicated session in cwd and schedules into it. */
    scheduleAgent: async ({ cwd, title, prompt: text, cron, timeZone }) => {
      if (typeof cwd !== "string" || !cwd.trim()) throw new Error("scheduleAgent: cwd is required");
      if (typeof text !== "string" || !text.trim()) throw new Error("scheduleAgent: prompt is required");
      if (typeof cron !== "string" || !cron.trim()) throw new Error("scheduleAgent: cron is required");
      const { sessionId } = await sessions.create({ cwd });
      const record = await createScheduleTask({
        sessionId,
        title: typeof title === "string" && title.trim() ? title.trim() : "laoshi",
        prompt: text,
        cron,
        timeZone,
      });
      log({ scheduleAgent: record.id, sessionId, title, cron });
      return { id: record.id, sessionId };
    },

    cancelSchedule: async ({ sessionId, id }) => {
      const key = `${sessionId}/${id}`;
      const timer = scheduleTimers.get(key);
      if (timer) {
        clearTimeout(timer);
        scheduleTimers.delete(key);
      }
      await deleteScheduleTask({ sessionId, id });
      return {};
    },

    /** Status (and optional on-demand start) of the hosted requirement board web UI. */
    board: async ({ start = false } = {}) => {
      if (start && !boardState.running && boardEnabled) await startBoard();
      return {
        enabled: boardEnabled,
        running: boardState.running,
        url: boardState.url,
        webPath: webServerMounted ? `${LAOSHI_WEB_PREFIX}/` : null,
        error: boardState.error,
      };
    },
  };

  const scheduleTimers = new Map();

  // ---- optional hosted Web requirement board (`laoshi board --no-open`)
  const defaultKitRoot = (() => {
    const candidate = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    return fs.existsSync(path.join(candidate, "bin", "req.mjs")) ? candidate : null;
  })();
  const boardEnabled = config.board !== false;
  const boardPort = Number(config.boardPort ?? 0) || 0;
  const boardReadOnly = Boolean(config.boardReadOnly);
  const kitRoot = typeof config.kitRoot === "string" && config.kitRoot.trim() ? path.resolve(config.kitRoot.trim()) : defaultKitRoot;
  const boardState = { running: false, url: null, error: null };
  let boardChild = null;
  let boardStartPromise = null;
  let boardStartTimer = null;
  let webServerMounted = false;
  let disposed = false;

  function startBoard() {
    if (disposed || !boardEnabled) return Promise.resolve(boardState);
    if (boardStartPromise) return boardStartPromise;
    const reqBin = kitRoot ? path.join(kitRoot, "bin", "req.mjs") : null;
    if (!reqBin || !fs.existsSync(reqBin)) {
      boardState.error = "未配置有效的 kitRoot，请重新运行 laoshi install --platform dsh";
      log({ boardError: boardState.error });
      return Promise.resolve(boardState);
    }
    boardStartPromise = new Promise((resolve) => {
      const args = [reqBin, "board", "--no-open", "--port", String(boardPort), ...(boardReadOnly ? ["--read-only"] : [])];
      const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
      boardChild = child;
      boardState.error = null;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (boardStartTimer) {
          clearTimeout(boardStartTimer);
          boardStartTimer = null;
        }
        resolve(boardState);
      };
      boardStartTimer = setTimeout(finish, 8_000);
      boardStartTimer.unref?.();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        const m = /(http:\/\/127\.0\.0\.1:\d+\/)/.exec(chunk);
        if (m) {
          boardState.running = true;
          boardState.url = m[1];
          log({ board: m[1] });
          finish();
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        if (!boardState.running && chunk.trim()) boardState.error = chunk.trim().slice(0, 300);
      });
      child.on("exit", (code) => {
        if (boardChild === child) {
          boardChild = null;
          boardStartPromise = null;
          boardState.running = false;
          boardState.url = null;
          if (!settled && code !== 0) boardState.error = boardState.error || `看板进程退出（${code}）`;
        }
        finish();
      });
      child.on("error", (err) => {
        boardState.error = String(err?.message ?? err);
        log({ boardError: boardState.error });
        finish();
      });
    });
    return boardStartPromise;
  }

  function renderUnavailablePage(message) {
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="color-scheme" content="light dark" />
<title>laoshi · 需求看板不可用</title>
<style>
body { margin: 0; font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; display: grid; place-items: center; min-height: 100vh; padding: 24px; }
.box { max-width: 520px; padding: 20px 24px; border-radius: 12px; border: 1px solid rgba(128,128,128,.28); }
h2 { margin: 0 0 8px; font-size: 16px; }
p { margin: 0 0 14px; opacity: .82; word-break: break-word; }
button { padding: 6px 14px; border-radius: 8px; border: 1px solid rgba(128,128,128,.35); background: transparent; color: inherit; cursor: pointer; font-weight: 600; }
</style>
</head>
<body>
<div class="box">
  <h2>需求看板暂时不可用</h2>
  <p>${escapeHtmlText(message)}</p>
  <button type="button" onclick="location.reload()">刷新重试</button>
</div>
</body>
</html>`;
  }

  async function handleBoardHttp(req, res, scope) {
    const conn = typeof scope?.get === "function" ? scope.get("connection") : typeof ctx.get === "function" ? ctx.get("connection") : null;
    if (typeof conn?.requestRejection === "function") {
      const rejection = conn.requestRejection(req);
      if (rejection !== undefined) {
        res.statusCode = rejection;
        res.end();
        return;
      }
    }
    if (!boardEnabled) {
      res.writeHead(503, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(renderUnavailablePage("dsh 插件配置中已设置 board: false（托管需求看板已关闭）。可在命令行运行 laoshi board，或改回 board: true 后重启 dsh。"));
      return;
    }
    if (!boardState.running) await startBoard();
    if (!boardState.url) {
      res.writeHead(503, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(renderUnavailablePage(boardState.error || "需求看板尚未就绪，请稍后刷新或重启 dsh。"));
      return;
    }
    const rawUrl = String(req.url || "/");
    const stripped = rawUrl.replace(/^\/laoshi(?=\/|\?|$)/, "");
    const upstreamPath = !stripped ? "/" : stripped.startsWith("?") ? `/${stripped}` : stripped;
    const upstreamUrl = new URL(upstreamPath, boardState.url);
    const headers = { ...req.headers };
    delete headers.host;
    headers["x-laoshi-prefix"] = LAOSHI_WEB_PREFIX;
    headers["x-laoshi-host"] = "dsh";
    await new Promise((resolve) => {
      const proxyReq = http.request(upstreamUrl, { method: req.method, headers }, (proxyRes) => {
        if (!res.headersSent) res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
        proxyRes.pipe(res);
        proxyRes.on("end", resolve);
        proxyRes.on("error", resolve);
      });
      res.on("close", () => {
        if (!res.writableEnded) proxyReq.destroy();
      });
      proxyReq.on("error", (err) => {
        log({ boardProxyError: String(err?.message ?? err), url: req.url });
        if (!res.headersSent) {
          res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
          res.end(`需求看板代理失败：${err?.message ?? err}`);
        } else {
          res.destroy();
        }
        resolve();
      });
      if (req.method === "GET" || req.method === "HEAD") proxyReq.end();
      else req.pipe(proxyReq);
    });
  }

  if (typeof ctx.inject === "function") {
    ctx.inject(["webServer"], (scope) => {
      const disposeRoute = scope.webServer.register({
        kind: "prefix",
        path: LAOSHI_WEB_PREFIX,
        handler: (req, res) => handleBoardHttp(req, res, scope),
      });
      webServerMounted = true;
      log({ webRoute: LAOSHI_WEB_PREFIX });
      const cleanup = () => {
        webServerMounted = false;
        disposeRoute();
      };
      if (typeof scope.on === "function") scope.on("dispose", cleanup);
      else if (typeof scope.effect === "function") scope.effect(() => cleanup);
    });
  }

  if (boardEnabled) startBoard().catch(() => {});

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
    disposed = true;
    if (boardStartTimer) {
      clearTimeout(boardStartTimer);
      boardStartTimer = null;
    }
    for (const timer of scheduleTimers.values()) clearTimeout(timer);
    scheduleTimers.clear();
    if (boardChild?.pid) {
      const pid = boardChild.pid;
      boardChild = null;
      try {
        if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore", windowsHide: true });
        else process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {}
      }
    }
    server.close();
    fs.rmSync(paths.token, { force: true });
    if (process.platform !== "win32") fs.rmSync(paths.socket, { force: true });
  });
}
