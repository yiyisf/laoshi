// The runtime contract as tests (contracts/agent-runtime.md, plan M3): what the pipeline expects of
// any adapter's AgentRuntime, run against the adapter with its own fake backend. An adapter's test
// file calls runConformance with a harness; the backend understands a small prompt language:
//   WRITE:<file>:<text>   write a file in the agent's directory (as a shell tool call)
//   SLEEP:<ms>            take this long
//   FAIL                  end the turn with an error
// Not a test file itself (no .test.ts): it only registers tests for the adapter that calls it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { CapabilityName, CapabilitySource } from "../src/platform.js";
import type { AgentRuntime, StartAgentInput } from "../src/runtime.js";

export interface ConformanceSetup {
  runtime: AgentRuntime;
  /** The agents' working directory (a repository). */
  cwd: string;
  /** A second runtime on the same state, as another engine process would create it. */
  reopen(): AgentRuntime;
  /** The parent chat for startAgent, when the platform needs one. */
  parentAgentId?: string | null;
}

export interface ConformanceHarness {
  /** Shown in the test names, e.g. "命令行（Claude Code）". */
  name: string;
  setup(): Promise<ConformanceSetup>;
  /** The adapter's declared capabilities: tool calls are checked only where it declares them. */
  capabilities: Partial<Record<CapabilityName, Exclude<CapabilitySource, "none">>>;
  /** Skip all (e.g. a platform whose fake needs a POSIX shell). */
  skip?: boolean;
}

export function runConformance(h: ConformanceHarness): void {
  const opts = { skip: h.skip ?? false, timeout: 60_000 };
  const input = (s: ConformanceSetup, prompt: string): StartAgentInput => ({ role: "builder", title: "一致性检查", prompt, cwd: s.cwd, labels: { conformance: "1" }, parentAgentId: s.parentAgentId ?? null });

  const withSetup = (fn: (s: ConformanceSetup) => Promise<void>) => async () => {
    const s = await h.setup();
    try {
      await fn(s);
    } finally {
      await s.runtime.close();
    }
  };

  test(`一致性（${h.name}）：startAgent → wait 返回 idle，agent 在给定目录里工作`, opts, withSetup(async (s) => {
    const agent = await s.runtime.startAgent(input(s, "请写文件。WRITE:conformance.txt:ok"));
    assert.equal(typeof agent.id, "string");
    const outcome = await agent.wait(30_000);
    assert.equal(outcome.status, "idle", outcome.error ?? "");
    assert.equal(outcome.error, null);
    assert.deepEqual(outcome.pendingPermissions, []);
    assert.equal(fs.readFileSync(path.join(s.cwd, "conformance.txt"), "utf8"), "ok");
  }));

  test(`一致性（${h.name}）：followUp 在同一个 agent 上开始新回合`, opts, withSetup(async (s) => {
    const agent = await s.runtime.startAgent(input(s, "第一轮"));
    assert.equal((await agent.wait(30_000)).status, "idle");
    await agent.followUp("第二轮。WRITE:second.txt:yes");
    const outcome = await agent.wait(30_000);
    assert.equal(outcome.status, "idle", outcome.error ?? "");
    assert.equal(fs.readFileSync(path.join(s.cwd, "second.txt"), "utf8"), "yes");
  }));

  test(`一致性（${h.name}）：回合出错时 wait 返回 error 和原因`, opts, withSetup(async (s) => {
    const outcome = await (await s.runtime.startAgent(input(s, "FAIL"))).wait(30_000);
    assert.equal(outcome.status, "error");
    assert.ok(outcome.error && outcome.error.length > 0, "error 要有原因");
  }));

  test(`一致性（${h.name}）：没等到结束时 wait 返回 timeout，之后接着等能等到结束`, opts, withSetup(async (s) => {
    const agent = await s.runtime.startAgent(input(s, "SLEEP:1500"));
    const early = await agent.wait(100);
    assert.equal(early.status, "timeout");
    const later = await agent.wait(30_000);
    assert.equal(later.status, "idle", later.error ?? "");
  }));

  test(`一致性（${h.name}）：另一个进程的运行时用 attachAgent 接上 agent，等到它结束`, opts, withSetup(async (s) => {
    const agent = await s.runtime.startAgent(input(s, "SLEEP:500"));
    const other = s.reopen();
    try {
      const outcome = await other.attachAgent(agent.id).wait(30_000);
      assert.equal(outcome.status, "idle", outcome.error ?? "");
    } finally {
      await other.close();
    }
  }));

  test(`一致性（${h.name}）：interruptAgent 打断当前回合，改做新的指令`, opts, withSetup(async (s) => {
    const agent = await s.runtime.startAgent(input(s, "SLEEP:20000"));
    await new Promise((r) => setTimeout(r, 300));
    await s.runtime.interruptAgent(agent.id, "停下，改做这个。WRITE:interrupted.txt:done");
    const outcome = await agent.wait(30_000);
    assert.equal(outcome.status, "idle", outcome.error ?? "");
    assert.equal(fs.readFileSync(path.join(s.cwd, "interrupted.txt"), "utf8"), "done");
  }));

  test(`一致性（${h.name}）：声明了工具调用的，toolCalls / recentActivity 看得到执行过的命令；没有的能力返回 null 而不是抛出`, opts, withSetup(async (s) => {
    const agent = await s.runtime.startAgent(input(s, "WRITE:tool.txt:x"));
    assert.equal((await agent.wait(30_000)).status, "idle");
    if (h.capabilities.toolCalls) {
      const calls = await s.runtime.toolCalls!(agent.id);
      assert.ok(calls && calls.some((c) => c.kind === "shell" && /tool\.txt/.test(c.text)), JSON.stringify(calls));
      assert.ok(calls.every((c) => c.callId && c.startedAt && c.status));
    }
    if (h.capabilities.activity) {
      const activity = await s.runtime.recentActivity(agent.id, 10);
      assert.ok(activity && activity.length > 0);
    }
    if (h.capabilities.runningTool) assert.equal(await s.runtime.runningTool(agent.id), null, "结束后没有正在运行的工具");
    // Optional methods: null when the platform has nothing, never an exception.
    for (const [name, call] of [
      ["listProfiles", () => s.runtime.listProfiles()],
      ["providerQuota", () => s.runtime.providerQuota(["x"])],
      ["capabilities", () => s.runtime.capabilities()],
      ["providerStatus", () => s.runtime.providerStatus()],
    ] as const) {
      await assert.doesNotReject(call as () => Promise<unknown>, `${name} 不应抛出`);
    }
    if (h.capabilities.services !== "platform") assert.equal(await s.runtime.listServices({ agentId: agent.id }), null, "服务不由平台管理时 listServices 为 null");
    if (!h.capabilities.scheduling) assert.equal(await s.runtime.scheduleMessage({ agentId: agent.id, name: "x", prompt: "x", at: new Date(Date.now() + 60_000) }), null, "不能定时的平台 scheduleMessage 为 null");
    await agent.archive();
  }));
}
