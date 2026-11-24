// laoshi M4b: the dsh runtime talks only to laoshi's dsh plugin. These tests run the real plugin
// (adapters/dsh/plugin) against a scripted stand-in for the dsh host's services, and the engine's
// runtime against the plugin over its real socket. The real dsh host is exercised by
// adapters/dsh/e2e (not part of npm test: it needs dsh installed).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CHAT_MODEL, createRuntimeWithClient, stepModel, PluginUnavailableError, pluginClient, toAgentUsage } from "../dsh-runtime.js";
import { channelPaths } from "../plugin/channel.mjs";
import { apply } from "../plugin/index.mjs";

type Listener = (...args: any[]) => any;

/** The dsh host services the plugin uses, scripted. */
function fakeHost(script: { runningPolls?: number } = {}) {
  const calls: Array<{ method: string; args: unknown }> = [];
  const listeners = new Map<string, Listener[]>();
  const sessions = new Map<string, { cwd: string; running: boolean; polls: number }>([["chat-1", { cwd: "", running: false, polls: 0 }]]);
  let childCount = 0;
  let resolveFirst: (v: unknown) => void = () => {};
  const ctx = {
    on(event: string, fn: Listener, opts?: { prepend?: boolean }) {
      const list = listeners.get(event) ?? [];
      if (opts?.prepend) list.unshift(fn);
      else list.push(fn);
      listeners.set(event, list);
    },
    llm: {
      listProviders: () => [
        { id: "deepseek", name: "DeepSeek" },
        { id: "gateway", name: "内网网关" },
      ],
      listModels: async (provider: string) => (provider === "deepseek" ? [{ id: "deepseek-chat", name: "Chat" }, { id: "deepseek-reasoner", name: "Reasoner" }] : []),
    },
    agents: { get: (id: string) => (sessions.has(id) ? { id } : undefined), resume: async () => ({ agent: { id: "resumed" } }) },
    subagents: {
      async startActivation(spec: { label: string; request: { cwd: string; agentOptions?: unknown } }) {
        const childId = `child-${++childCount}`;
        calls.push({ method: "startActivation", args: { label: spec.label, cwd: spec.request.cwd, ...(spec.request.agentOptions ? { agentOptions: spec.request.agentOptions } : {}) } });
        sessions.set(childId, { cwd: spec.request.cwd, running: true, polls: 0 });
        return { childId, result: new Promise((resolve) => (resolveFirst = resolve)) };
      },
      async prompt(req: unknown) {
        calls.push({ method: "subagents.prompt", args: req });
      },
      interruptByParent(child: string, parent: string) {
        calls.push({ method: "interruptByParent", args: { child, parent } });
      },
    },
    schedule: {
      async create(sessionId: string, req: unknown) {
        calls.push({ method: "schedule.create", args: { sessionId, req } });
        return { id: "schedule-1" };
      },
      async delete(req: unknown) {
        calls.push({ method: "schedule.delete", args: req });
      },
    },
    sessionController: {
      async list() {
        return {
          items: [...sessions.entries()].map(([sessionId, s]) => {
            // A child keeps "running" for a few polls, then its first turn settles.
            if (s.running && ++s.polls > (script.runningPolls ?? 2)) {
              s.running = false;
              resolveFirst({ stopReason: "completed" });
            }
            return { sessionId, cwd: s.cwd, running: s.running, projections: { values: { tokenUsage: { uncachedInputTokens: 100, cacheReadTokens: 50, outputTokens: 10 }, inbox: {} } } };
          }),
        };
      },
      async page() {
        return {
          records: [
            { type: "event", event: { type: "tool/call", time: 0, data: { callId: "c1", name: "bash", arguments: JSON.stringify({ command: "npm test" }) } } },
            { type: "event", event: { type: "tool/call", time: 0, data: { callId: "c2", name: "grep", arguments: JSON.stringify({ pattern: "TODO" }) } } },
            { type: "event", event: { type: "tool/result", time: 0, data: { message: { toolCallId: "c1" } } } },
            { type: "event", event: { type: "assistant/message", time: 0, data: { message: { content: [{ type: "text", text: "完成" }] } } } },
          ],
        };
      },
      async prompt(req: unknown) {
        calls.push({ method: "session.prompt", args: req });
      },
      cancel(req: unknown) {
        calls.push({ method: "session.cancel", args: req });
      },
      async create(req: { cwd: string }) {
        sessions.set("session-new", { cwd: req.cwd, running: false, polls: 0 });
        return { sessionId: "session-new" };
      },
    },
  };
  const dispose = () => {
    for (const fn of listeners.get("dispose") ?? []) fn();
  };
  const approve = (agentId: string, answer: () => Promise<string>) => {
    const [first, ...rest] = listeners.get("approval/request") ?? [];
    const next = rest.length ? () => rest[0]({ agent: { id: agentId }, toolName: "bash" }, answer) : answer;
    return first({ agent: { id: agentId }, toolName: "bash", reason: "escalate to danger-full-access" }, next);
  };
  return { ctx, calls, sessions, dispose, approve };
}

async function started(config: { approvals?: "ask" | "allow"; board?: boolean; kitRoot?: string } = {}, script = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-dsh-"));
  const host = fakeHost(script);
  apply(host.ctx, { home, board: false, ...config });
  const token = channelPaths(home).token;
  for (let i = 0; i < 100 && !fs.existsSync(token); i++) await new Promise((r) => setTimeout(r, 20));
  const env = { ...process.env, DSH_HOME: home };
  return { home, host, env, call: pluginClient(env, 5_000) };
}

test("dsh 插件：只接受带令牌的调用；插件没启动时说明原因", async () => {
  const { home, host, env, call } = await started();
  try {
    const version = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "plugin", "package.json"), "utf8")).version;
    assert.deepEqual(await call("hello"), { plugin: version, approvals: "ask" });
    fs.writeFileSync(channelPaths(home).token, "0".repeat(64));
    await assert.rejects(pluginClient(env, 5_000)("hello"), /unauthorized/);
  } finally {
    host.dispose();
  }
  await assert.rejects(pluginClient({ ...process.env, DSH_HOME: fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-dsh-none-")) })("hello"), PluginUnavailableError);
});

test("dsh 运行时：在对话下创建步骤 agent，等到它完成，追问、打断都经过插件", async () => {
  const { host, call } = await started();
  try {
    const runtime = createRuntimeWithClient(call, () => undefined, 10);
    const agent = await runtime.startAgent({ role: "builder", title: "方案设计", prompt: "做方案", cwd: "/repo", labels: {}, parentAgentId: "chat-1" });
    assert.deepEqual(host.calls[0], { method: "startActivation", args: { label: "方案设计", cwd: "/repo" } });
    const first = await agent.wait(5_000);
    assert.equal(first.status, "idle");
    assert.equal(first.lastMessage, "完成");
    assert.deepEqual(first.usage, { inputTokens: 150, cachedInputTokens: 50, outputTokens: 10 });

    await agent.followUp("结果文件缺失，请补写");
    assert.equal(host.calls.at(-1)?.method, "subagents.prompt");
    await runtime.interruptAgent(agent.id, "请停止");
    assert.deepEqual(host.calls.at(-2), { method: "interruptByParent", args: { child: agent.id, parent: "chat-1" } });
    await runtime.notifyAgent("chat-1", "方案已经确定");
    assert.equal(host.calls.at(-1)?.method, "session.prompt");

    const calls = await runtime.toolCalls!(agent.id);
    assert.deepEqual(calls?.map((c) => [c.kind, c.text, c.status]), [["shell", "npm test", "completed"], ["search", "TODO", "running"]]);
    assert.deepEqual(await runtime.runningTool(agent.id), { kind: "search", text: "TODO", startedAt: new Date(0).toISOString(), callId: "c2" });
  } finally {
    host.dispose();
  }
});

test("dsh 运行时：还在运行时按时返回 timeout", async () => {
  const { host, call } = await started({}, { runningPolls: 1_000 });
  try {
    const runtime = createRuntimeWithClient(call, () => undefined, 10);
    const agent = await runtime.startAgent({ role: "builder", title: "实现", prompt: "写代码", cwd: "/repo", labels: {}, parentAgentId: "chat-1" });
    assert.equal((await agent.wait(100)).status, "timeout");
  } finally {
    host.dispose();
  }
});

test("dsh 插件审批：只管 laoshi 的步骤；ask 时交给人并报告给引擎，allow 时直接批准", async () => {
  const ask = await started({ approvals: "ask" }, { runningPolls: 1_000 });
  try {
    const runtime = createRuntimeWithClient(ask.call, () => undefined, 10);
    const agent = await runtime.startAgent({ role: "builder", title: "实现", prompt: "写代码", cwd: "/repo", labels: {}, parentAgentId: "chat-1" });
    // Someone else's session: the plugin passes the request on untouched.
    assert.equal(await ask.host.approve("chat-1", async () => "rejected"), "rejected");
    // A laoshi step: the request waits for a person, and the engine sees it as "permission".
    let answer: (v: string) => void = () => {};
    const decided = ask.host.approve(agent.id, () => new Promise<string>((r) => (answer = r)));
    const waiting = await agent.wait(1_000);
    assert.equal(waiting.status, "permission");
    assert.match(waiting.pendingPermissions[0].title, /bash：escalate/);
    answer("allowed-once");
    assert.equal(await decided, "allowed-once");
    assert.equal((await agent.wait(50)).status, "timeout");
  } finally {
    ask.host.dispose();
  }

  const allow = await started({ approvals: "allow" });
  try {
    const runtime = createRuntimeWithClient(allow.call, () => undefined, 10);
    const agent = await runtime.startAgent({ role: "builder", title: "实现", prompt: "写代码", cwd: "/repo", labels: {}, parentAgentId: "chat-1" });
    assert.equal(await allow.host.approve(agent.id, async () => "rejected"), "allowed-once");
    assert.equal(await allow.host.approve("chat-1", async () => "rejected"), "rejected");
  } finally {
    allow.host.dispose();
  }
});

test("dsh 运行时：定时消息的 ID 带着会话，取消时用得上；对话的目录要和仓库一致", async () => {
  const { host, call } = await started();
  try {
    const runtime = createRuntimeWithClient(call, () => undefined, 10);
    const id = await runtime.scheduleMessage({ agentId: "chat-1", name: "自动继续", prompt: "继续", at: new Date("2026-11-02T01:00:00Z") });
    assert.equal(id, "dsh:chat-1/schedule-1");
    assert.deepEqual(host.calls.at(-1), { method: "schedule.create", args: { sessionId: "chat-1", req: { title: "自动继续", prompt: "继续", at: "2026-11-02T01:00:00.000Z" } } });
    await runtime.cancelSchedule(id!);
    assert.deepEqual(host.calls.at(-1), { method: "schedule.delete", args: { sessionId: "chat-1", id: "schedule-1" } });

    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-dsh-repo-"));
    host.sessions.get("chat-1")!.cwd = repo;
    await runtime.verifyOrigin("chat-1", repo);
    await assert.rejects(runtime.verifyOrigin("chat-1", os.tmpdir()), /工作目录/);
    await assert.rejects(runtime.verifyOrigin("nobody", repo), /找不到发起流水线的对话/);
    await assert.rejects(runtime.createWorktree({ sourceRepo: repo, baseRef: "HEAD", branchName: "b", title: "t", callerAgentId: "chat-1" }), /--worktree/);
  } finally {
    host.dispose();
  }
});

test("dsh 用量换算成引擎的格式", () => {
  assert.equal(toAgentUsage(null), null);
  assert.deepEqual(toAgentUsage({ uncachedInputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 2, outputTokens: 3 }), { inputTokens: 17, cachedInputTokens: 5, outputTokens: 3 });
});

test("dsh 按角色选模型（M4b）：provider 写成\"<提供方>/<模型>\"时步骤用它，dsh/chat-model 用对话的模型；插件列出可用的模型", async () => {
  assert.equal(stepModel({ provider: CHAT_MODEL }), null);
  assert.equal(stepModel(undefined), null);
  assert.deepEqual(stepModel({ provider: "deepseek/deepseek-reasoner", thinkingOptionId: "high" }), { provider: "deepseek", model: "deepseek-reasoner", reasoningEffort: "high" });
  assert.deepEqual(stepModel({ provider: "gateway/team/model-x" }), { provider: "gateway", model: "team/model-x" }, "模型 ID 里可以有斜杠");
  const { host, call } = await started();
  try {
    const runtime = createRuntimeWithClient(call, () => undefined, 10);
    await runtime.startAgent({ role: "reviewer", title: "方案审核", prompt: "审方案", cwd: "/repo", labels: {}, parentAgentId: "chat-1", profile: { provider: "deepseek/deepseek-reasoner", thinkingOptionId: "high" } });
    assert.deepEqual(host.calls.at(-1), { method: "startActivation", args: { label: "方案审核", cwd: "/repo", agentOptions: { provider: "deepseek", model: "deepseek-reasoner", reasoningEffort: "high" } } });
    await runtime.startAgent({ role: "builder", title: "方案设计", prompt: "做方案", cwd: "/repo", labels: {}, parentAgentId: "chat-1", profile: { provider: CHAT_MODEL } });
    assert.deepEqual(host.calls.at(-1), { method: "startActivation", args: { label: "方案设计", cwd: "/repo" } });

    assert.deepEqual(await call("models"), {
      providers: [
        { provider: "deepseek", name: "DeepSeek", models: [{ id: "deepseek-chat", name: "Chat" }, { id: "deepseek-reasoner", name: "Reasoner" }] },
        { provider: "gateway", name: "内网网关", models: [] },
      ],
    });
    assert.deepEqual(await runtime.providerStatus(), [
      { provider: "dsh", status: "ready" },
      { provider: "deepseek", status: "ready" },
      { provider: "gateway", status: "no_models" },
    ]);
  } finally {
    host.dispose();
  }
});

test("dsh 定时任务支持 expiresAt：到期后插件自动取消定时任务", async () => {
  const { host, call } = await started();
  try {
    const runtime = createRuntimeWithClient(call, () => {}, 10);
    await runtime.scheduleMessage({
      agentId: "chat-1",
      name: "巡检",
      prompt: "检查进展",
      cron: "*/5 * * * *",
      expiresAt: new Date(Date.now() + 40),
    });
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(
      host.calls.some((c: { method: string }) => c.method === "schedule.delete"),
      `预期到期后自动调用 schedule.delete，实际调用：${JSON.stringify(host.calls)}`,
    );
  } finally {
    host.dispose();
  }
});

test("dsh scheduleNewAgent 通过插件新建定时会话并可取消", async () => {
  const { host, call } = await started();
  try {
    const notes: string[] = [];
    const runtime = createRuntimeWithClient(call, (m) => notes.push(m), 10);
    const id = await runtime.scheduleNewAgent({
      name: "每周总览",
      prompt: "运行 digest",
      cron: "0 9 * * 1",
      cwd: "/repo",
      profile: { provider: "deepseek/deepseek-reasoner" },
    });
    assert.equal(id, "dsh:session-new/schedule-1");
    assert.match(notes.join("\n"), /默认模型/);
    const created = host.calls.find((c: { method: string }) => c.method === "schedule.create") as {
      method: string;
      args: { sessionId: string; req: { cron?: { expression: string } } };
    };
    assert.equal(created.args.sessionId, "session-new");
    assert.equal(created.args.req.cron?.expression, "0 9 * * 1");

    await runtime.cancelSchedule(id!);
    assert.deepEqual(host.calls.at(-1), { method: "schedule.delete", args: { sessionId: "session-new", id: "schedule-1" } });
  } finally {
    host.dispose();
  }
});

test("dsh 0.2.2-rc.5 宿主接口适配：扁平 startActivation、subagents.interrupt、schedule.create/edit 与 sessions.events", async () => {
  const calls: Array<{ method: string; args: unknown }> = [];
  const listeners = new Map<string, Listener[]>();
  const sessions = new Map<string, { cwd: string; running: boolean; polls: number }>([["chat-1", { cwd: "/repo", running: false, polls: 0 }]]);
  let childCount = 0;
  let resolveFirst: (v: unknown) => void = () => {};
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-dsh-modern-"));
  const ctx = {
    on(event: string, fn: Listener) {
      const list = listeners.get(event) ?? [];
      list.push(fn);
      listeners.set(event, list);
    },
    llm: { listProviders: () => [], listModels: async () => [] },
    agents: { get: (id: string) => (sessions.has(id) ? { id } : undefined), resume: async () => ({ agent: { id: "resumed" } }) },
    subagents: {
      async startActivation(spec: { provider: string; label: string; parent: { id: string }; prompt: unknown[]; cwd: string; agentOptions?: unknown; delivery: string }) {
        assert.ok(spec.parent?.id, "0.2.2-rc.5 expects top-level spec.parent");
        const childId = `child-${++childCount}`;
        calls.push({ method: "startActivation", args: { label: spec.label, parentId: spec.parent.id, cwd: spec.cwd, delivery: spec.delivery, ...(spec.agentOptions ? { agentOptions: spec.agentOptions } : {}) } });
        sessions.set(childId, { cwd: spec.cwd, running: true, polls: 0 });
        return { childId, result: new Promise((resolve) => (resolveFirst = resolve)) };
      },
      async prompt(req: unknown) {
        calls.push({ method: "subagents.prompt", args: req });
      },
      interrupt(child: string, authority: { kind: string }) {
        calls.push({ method: "subagents.interrupt", args: { child, authority } });
      },
    },
    schedule: {
      async create(request: unknown, actorSessionId: string) {
        calls.push({ method: "schedule.create", args: { request, actorSessionId } });
        return { id: "schedule-modern-1" };
      },
      async edit(request: unknown, actorSessionId: unknown) {
        calls.push({ method: "schedule.edit", args: { request, actorSessionId } });
        return { deleted: true };
      },
    },
    sessionController: {
      async list() {
        return {
          items: [...sessions.entries()].map(([sessionId, s]) => {
            if (s.running && ++s.polls > 1) {
              s.running = false;
              resolveFirst({ stopReason: "completed" });
            }
            return { sessionId, cwd: s.cwd, running: s.running, projections: { values: { inbox: {} } } };
          }),
        };
      },
      async events() {
        return {
          records: [{ type: "event", event: { type: "assistant/message", time: 0, data: { message: { content: [{ type: "text", text: "新接口完成" }] } } } }],
        };
      },
      async prompt() {},
      cancel() {},
      async create(req: { cwd: string }) {
        sessions.set("session-modern", { cwd: req.cwd, running: false, polls: 0 });
        return { sessionId: "session-modern" };
      },
    },
  };
  apply(ctx, { home });
  const token = channelPaths(home).token;
  for (let i = 0; i < 100 && !fs.existsSync(token); i++) await new Promise((r) => setTimeout(r, 20));
  const call = pluginClient({ ...process.env, DSH_HOME: home }, 5_000);
  try {
    const runtime = createRuntimeWithClient(call, () => {}, 10);
    const agent = await runtime.startAgent({
      role: "reviewer",
      title: "代码评审",
      prompt: "评审",
      cwd: "/repo",
      labels: {},
      parentAgentId: "chat-1",
      profile: { provider: "deepseek/deepseek-v4" },
    });
    assert.deepEqual(calls[0], {
      method: "startActivation",
      args: { label: "代码评审", parentId: "chat-1", cwd: "/repo", delivery: "caller", agentOptions: { provider: "deepseek", model: "deepseek-v4" } },
    });
    const settled = await agent.wait(5_000);
    assert.equal(settled.lastMessage, "新接口完成");

    await runtime.interruptAgent(agent.id, "停");
    assert.deepEqual(calls.find((c) => c.method === "subagents.interrupt"), {
      method: "subagents.interrupt",
      args: { child: agent.id, authority: { kind: "user" } },
    });

    await runtime.scheduleMessage({
      agentId: "chat-1",
      name: "自动继续",
      prompt: "继续",
      cron: "*/5 * * * *",
      expiresAt: new Date(Date.now() + 40),
    });
    const createdAt = calls.find((c) => c.method === "schedule.create") as {
      method: string;
      args: { request: { title: string; timing: { kind: string; cron: { expression: string; time_zone: string } }; target: { kind: string; sessionId: string } }; actorSessionId: string };
    };
    assert.equal(createdAt.args.request.timing.kind, "cron");
    assert.equal(createdAt.args.request.timing.cron.expression, "*/5 * * * *");
    assert.ok(createdAt.args.request.timing.cron.time_zone.length > 0);
    assert.deepEqual(createdAt.args.request.target, { kind: "session", sessionId: "chat-1" });

    await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(calls.find((c) => c.method === "schedule.edit"), {
      method: "schedule.edit",
      args: { request: { id: "schedule-modern-1", action: "delete" }, actorSessionId: undefined },
    });

    const newSchedId = await runtime.scheduleNewAgent({ name: "定期巡检", prompt: "跑 digest", cron: "0 9 * * 1", cwd: "/repo", profile: { provider: "deepseek/deepseek-v4" } });
    assert.equal(newSchedId, "dsh:session-modern/schedule-modern-1");
    await runtime.cancelSchedule(newSchedId!);
    assert.deepEqual(calls.at(-1), {
      method: "schedule.edit",
      args: { request: { id: "schedule-modern-1", action: "delete" }, actorSessionId: undefined },
    });
  } finally {
    for (const fn of listeners.get("dispose") ?? []) fn();
  }
});

test("dsh 插件 webServer 挂载 /laoshi 代理看板并默认开启，支持 connection 鉴权拦截", async () => {
  const http = await import("node:http");
  const kitRoot = path.resolve(import.meta.dirname, "..", "..", "..");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-dsh-web-"));
  const host = fakeHost();
  let registeredRoute: { kind: string; path: string; handler: (req: any, res: any) => Promise<void> } | undefined;
  let routeDisposed = false;
  let rejectStatus: number | undefined;
  const ctx: any = {
    ...host.ctx,
    get: (name: string) => (name === "connection" ? { requestRejection: () => rejectStatus } : undefined),
    inject: (deps: string[], fn: (scope: any) => void) => {
      assert.deepEqual(deps, ["webServer"]);
      fn({
        get: (name: string) => (name === "connection" ? { requestRejection: () => rejectStatus } : undefined),
        on: host.ctx.on.bind(host.ctx),
        webServer: {
          register: (route: { kind: string; path: string; handler: (req: any, res: any) => Promise<void> }) => {
            registeredRoute = route;
            return () => {
              routeDisposed = true;
            };
          },
        },
      });
    },
  };
  apply(ctx, { home, kitRoot });
  const token = channelPaths(home).token;
  for (let i = 0; i < 100 && !fs.existsSync(token); i++) await new Promise((r) => setTimeout(r, 20));
  const call = pluginClient({ ...process.env, DSH_HOME: home }, 10_000);
  let proxyServer: import("node:http").Server | null = null;
  try {
    const route = registeredRoute as { kind: string; path: string; handler: (req: any, res: any) => Promise<void> } | undefined;
    assert.ok(route);
    assert.equal(route.kind, "prefix");
    assert.equal(route.path, "/laoshi");

    const status = await call<{ enabled: boolean; running: boolean; url: string | null; webPath: string | null }>("board", { start: true });
    assert.equal(status.enabled, true);
    assert.equal(status.running, true);
    assert.ok(status.url?.startsWith("http://127.0.0.1:"));
    assert.equal(status.webPath, "/laoshi/");

    proxyServer = http.createServer((req, res) => {
      void route.handler(req, res);
    });
    await new Promise<void>((resolve) => proxyServer!.listen(0, "127.0.0.1", resolve));
    const port = (proxyServer.address() as import("node:net").AddressInfo).port;

    const homeRes = await fetch(`http://127.0.0.1:${port}/laoshi/?theme=light`);
    assert.equal(homeRes.status, 200);
    const html = await homeRes.text();
    assert.match(html, /laoshi · 需求看板/);
    assert.match(html, /"apiBase":"\/laoshi\/api"/);
    assert.match(html, /"embedHost":"dsh"/);
    assert.match(html, /data-theme="light"/);

    const listRes = await fetch(`http://127.0.0.1:${port}/laoshi/api/list`);
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(((await listRes.json()) as { items: unknown[] }).items));

    rejectStatus = 403;
    const rejected = await fetch(`http://127.0.0.1:${port}/laoshi/api/list`);
    assert.equal(rejected.status, 403);
  } finally {
    if (proxyServer) await new Promise<void>((resolve) => proxyServer!.close(() => resolve()));
    host.dispose();
  }
  assert.equal(routeDisposed, true);
});

test("dsh client.js 声明 dsh.client，注册左侧菜单与主面板并转发打开会话消息", async () => {
  const vm = await import("node:vm");
  const pluginDir = path.resolve(import.meta.dirname, "..", "plugin");
  const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf8")) as {
    exports: Record<string, string>;
    dsh?: { client?: { platform?: string; inject?: string[] } };
    files?: string[];
  };
  assert.equal(pkg.exports["./client"], "./client.js");
  assert.equal(pkg.dsh?.client?.platform, "web");
  assert.ok(pkg.files?.includes("client.js"));
  assert.ok(pkg.dsh?.client?.inject?.includes("@deepseek-ai/dsh-client-ui-sidebar"));
  assert.ok(pkg.dsh?.client?.inject?.includes("@deepseek-ai/dsh-client-ui-layout"));
  assert.ok(pkg.dsh?.client?.inject?.includes("@deepseek-ai/dsh-client-ui-workspace"));

  const listeners: Record<string, Array<(ev: any) => void>> = {};
  const fakeWindow: Record<string, any> = {
    location: { origin: "http://127.0.0.1:3000" },
    addEventListener: (ev: string, fn: (e: any) => void) => {
      (listeners[ev] ??= []).push(fn);
    },
    removeEventListener: (ev: string, fn: (e: any) => void) => {
      listeners[ev] = (listeners[ev] ?? []).filter((f) => f !== fn);
    },
  };
  type LoadedClientModule = { id: string; factory: (req: (id: string) => unknown) => { inject: string[]; apply: (ctx: unknown) => void } };
  let registered: LoadedClientModule | undefined;
  fakeWindow.__ModuleLoader__ = {
    load: (entry: LoadedClientModule) => {
      registered = entry;
    },
  };
  const fakeDocument = {
    body: { hasAttribute: () => true },
    documentElement: { style: { colorScheme: "dark" }, getAttribute: () => "dark" },
  };
  const effectCleanups: Array<() => void> = [];
  const fakeReact = {
    createElement: (type: unknown, props: Record<string, unknown>, ...children: unknown[]) => ({ type, props, children }),
    useRef: (init: unknown) => ({ current: init }),
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => void | (() => void)) => {
      const cleanup = fn();
      if (typeof cleanup === "function") effectCleanups.push(cleanup);
    },
  };
  const vmContext = vm.createContext({ window: fakeWindow, document: fakeDocument, fakeReact });
  const code = fs.readFileSync(path.join(pluginDir, "client.js"), "utf8");
  vm.runInContext(code, vmContext);
  const entry = registered as LoadedClientModule | undefined;
  assert.ok(entry);
  assert.equal(entry.id, "laoshi-dsh-plugin");

  const exportsObj = vm.runInContext(
    `(function(reg){ return reg.factory(function(id){ return id === "react" ? fakeReact : {}; }); })`,
    vmContext,
  )(entry) as { inject: string[]; apply: (ctx: any) => void };
  assert.deepEqual([...exportsObj.inject], ["slots", "uiWorkspace"]);

  const slots: Array<{ opts: Record<string, unknown>; component: (p: any) => any }> = [];
  const opened: unknown[] = [];
  exportsObj.apply({
    slots: {
      inject: (_key: string, cb: () => unknown) => cb(),
      register: (opts: Record<string, unknown>, component: (p: any) => any) => {
        slots.push({ opts, component });
        return () => {};
      },
    },
    uiWorkspace: {
      openSession: (target: unknown) => opened.push(target),
    },
  });
  const nav = slots.find((s) => s.opts.name === "sidebar.panellist");
  const main = slots.find((s) => s.opts.name === "main");
  assert.equal(nav?.opts.id, "laoshi");
  assert.equal((nav?.opts.label as () => string)(), "需求看板");
  assert.equal(main?.opts.key, "laoshi");

  const iframeEl = vm.runInContext(
    `(function(comp){ return comp({}); })`,
    vmContext,
  )(main!.component);
  assert.equal(iframeEl.type, "iframe");
  assert.equal(iframeEl.props.src, "/laoshi/?theme=dark");

  for (const fn of listeners.message ?? []) {
    fn({ origin: "http://127.0.0.1:3000", data: { type: "laoshi:open-session", sessionId: "child-1", parentSessionId: "parent-1" } });
    fn({ origin: "http://127.0.0.1:3000", data: { type: "laoshi:open-session", sessionId: "parent-1", parentSessionId: "parent-1" } });
    fn({ origin: "http://evil.example", data: { type: "laoshi:open-session", sessionId: "evil-1", parentSessionId: null } });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [
    { parentSessionId: "parent-1", childSessionId: "child-1", mode: "continuable" },
    "parent-1",
  ]);
  for (const c of effectCleanups) c();
});
