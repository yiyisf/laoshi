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

async function started(config: { approvals?: "ask" | "allow" } = {}, script = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-dsh-"));
  const host = fakeHost(script);
  apply(host.ctx, { home, ...config });
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
