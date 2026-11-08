// The command-line runtime against a fake `claude` / `codex` (fake-agent.mjs).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AgentProfile } from "../../../engine/src/config.js";
import { createCliRuntime, redact } from "../cli-runtime.js";
import { driverOf } from "../drivers.js";

const FAKE = path.join(import.meta.dirname, "fake-agent.mjs");

function setup(agents: Partial<Record<"builder" | "reviewer", AgentProfile>>, runTimeoutMinutes = 5) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-cli-")));
  const repo = path.join(base, "repo");
  const fake = path.join(base, "fake");
  fs.mkdirSync(repo);
  fs.mkdirSync(fake);
  // How the runtime starts "claude" / "codex": a wrapper script (on Windows, through cmd.exe).
  let command = `"${process.execPath}" "${FAKE}"`;
  if (process.platform !== "win32") {
    command = path.join(base, "agent.sh");
    fs.writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  }
  const logs: string[] = [];
  const options = {
    settings: { commands: { claude: command, codex: command }, runTimeoutMinutes },
    agents,
    agentsDir: path.join(base, "agents"),
    messagesFile: path.join(base, "messages.log"),
    log: (m: string) => logs.push(m),
    env: { ...process.env, FAKE_AGENT_DIR: fake },
    pollMs: 50,
  };
  const runtime = createCliRuntime(options);
  const calls = () =>
    fs
      .readFileSync(path.join(fake, "calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { kind: string; argv: string[]; prompt: string; resume: string | null; cwd: string });
  return { base, repo, runtime, calls, logs, options, agentsDir: options.agentsDir };
}

const start = (runtime: ReturnType<typeof setup>["runtime"], repo: string, prompt: string, role: "builder" | "reviewer" = "builder", profile?: AgentProfile) =>
  runtime.startAgent({ role, title: "实现", prompt, cwd: repo, labels: {}, parentAgentId: null, profile });

test("Claude Code：步骤是一次 claude -p，提示词从标准输入传入；结果、用量、会话和工具调用都拿得到", async () => {
  const { repo, runtime, calls } = setup({ builder: { provider: "claude/opus", modeId: "acceptEdits" } });
  try {
    const agent = await start(runtime, repo, "请实现。WRITE:out.txt:hello");
    const outcome = await agent.wait(20_000);
    assert.equal(outcome.status, "idle", outcome.error ?? "");
    assert.match(outcome.lastMessage ?? "", /done: 1 prompt/);
    assert.deepEqual(outcome.usage, { inputTokens: 1000, cachedInputTokens: 900, outputTokens: 200, totalCostUsd: 0.01 });
    assert.equal(fs.readFileSync(path.join(repo, "out.txt"), "utf8"), "hello");
    const call = calls()[0];
    assert.equal(call.kind, "claude");
    assert.equal(call.cwd, repo);
    assert.match(call.prompt, /请实现/);
    for (const flag of ["-p", "stream-json", "--verbose"]) assert.ok(call.argv.includes(flag), flag);
    assert.equal(call.argv[call.argv.indexOf("--permission-mode") + 1], "acceptEdits");
    assert.equal(call.argv[call.argv.indexOf("--model") + 1], "opus");
    const tools = await runtime.toolCalls!(agent.id);
    assert.deepEqual(tools?.map((t) => [t.kind, t.text, t.status]), [["shell", "echo hello > out.txt", "completed"]]);
    const activity = await runtime.recentActivity(agent.id, 5);
    assert.match(activity?.[0].text ?? "", /运行命令：echo hello/);
  } finally {
    await runtime.close();
  }
});

test("Codex：步骤是一次 codex exec --json；追问用同一个会话（exec resume）；模型写 default 时不传模型", async () => {
  const { repo, runtime, calls } = setup({ reviewer: { provider: "codex/default" } });
  try {
    const agent = await start(runtime, repo, "请评审。RUN:git_status", "reviewer");
    assert.equal((await agent.wait(20_000)).status, "idle");
    await agent.followUp("还有一个问题");
    const second = await agent.wait(20_000);
    assert.equal(second.status, "idle", second.error ?? "");
    assert.match(second.lastMessage ?? "", /done: 2 prompt/);
    const [first, follow] = calls();
    assert.equal(first.kind, "codex");
    assert.ok(first.argv.includes("--json") && first.argv.includes("--dangerously-bypass-approvals-and-sandbox"));
    assert.ok(!first.argv.includes("--model"));
    assert.equal(first.argv[first.argv.indexOf("--cd") + 1], repo);
    assert.ok(follow.resume, "追问续接会话");
    assert.match(follow.prompt, /还有一个问题/);
    const tools = await runtime.toolCalls!(agent.id);
    assert.equal(tools?.[0].text, "git status");
  } finally {
    await runtime.close();
  }
});

test("出错、超过单次运行上限都报为 error；不认识的 agent 写法给出说明", async () => {
  const { repo, runtime } = setup({ builder: { provider: "claude/default" } }, 0.003);
  try {
    const failed = await (await start(runtime, repo, "FAIL")).wait(20_000);
    assert.equal(failed.status, "error");
    assert.match(failed.error ?? "", /boom/);
    const slow = await (await start(runtime, repo, "SLEEP:5000")).wait(20_000);
    assert.equal(slow.status, "error");
    assert.match(slow.error ?? "", /单次运行的上限/);
  } finally {
    await runtime.close();
  }
  assert.throws(() => driverOf("pi/some-model"), /claude\/<模型> 或 codex\/<模型>/);
  assert.deepEqual(driverOf("codex/gpt-6"), { driver: driverOf("codex/x").driver, model: "gpt-6" });
});

test("运行被意外打断（没有结果、没有退出记录）：另一个引擎进程接上时用它的会话继续，不重做", async () => {
  const { repo, runtime, calls, options, agentsDir } = setup({ builder: { provider: "claude/default" } });
  const agent = await start(runtime, repo, "DIE");
  const cut = await agent.wait(20_000);
  assert.equal(cut.status, "error");
  assert.match(cut.error ?? "", /没有给出结果（退出码 137）/);
  await runtime.close();
  // The process that watched it went away before writing the exit record.
  fs.rmSync(path.join(agentsDir, agent.id, "run-1.exit"));
  const later = createCliRuntime(options);
  try {
    const resumed = await later.attachAgent(agent.id).wait(20_000);
    assert.equal(resumed.status, "idle", resumed.error ?? "");
    const second = calls()[1];
    assert.ok(second.resume, "续接原来的会话");
    assert.match(second.prompt, /上一次运行被中断了/);
  } finally {
    await later.close();
  }
});

test("打断正在运行的步骤：结束进程，用会话续接并给出新指令", async () => {
  const { repo, runtime, calls } = setup({ builder: { provider: "claude/default" } });
  try {
    const agent = await start(runtime, repo, "SLEEP:10000");
    await new Promise((r) => setTimeout(r, 500));
    await runtime.interruptAgent(agent.id, "停下，改做别的");
    const outcome = await agent.wait(20_000);
    assert.equal(outcome.status, "idle", outcome.error ?? "");
    assert.equal(calls().length, 2);
    assert.ok(calls()[1].resume);
    assert.match(calls()[1].prompt, /停下，改做别的/);
  } finally {
    await runtime.close();
  }
});

test("没有对话：消息写进 messages.log；工具输出里的凭据不进日志", async () => {
  const { runtime, options } = setup({});
  await runtime.notifyAgent("none", "需求已完成\n详情见报告");
  assert.match(fs.readFileSync(options.messagesFile, "utf8"), /需求已完成/);
  assert.equal(redact("echo token=SECRET123456 && curl -H 'Authorization: Bearer abcdefgh12345'"), "echo token=*** && curl -H 'Authorization: Bearer ***'");
  await runtime.close();
});
