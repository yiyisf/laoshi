// The 摸高 runtime against a fake `aimax` (fake-aimax.mjs, formats from the sandbox probes).
import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { programHome } from "../../../engine/src/locations.js";
import { isAlive } from "../../../engine/src/state.js";
import { callbackEvent, createMogaoRuntime, mogaoSettings, parseRunOutput, redact, toAgentUsage } from "../mogao-runtime.js";

const FAKE = path.join(import.meta.dirname, "fake-aimax.mjs");

function setup(extra: Record<string, unknown> = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-mogao-")));
  const repo = path.join(base, "repo");
  const fake = path.join(base, "aimax");
  fs.mkdirSync(repo);
  fs.mkdirSync(fake);
  // A wrapper so the runtime can start "aimax" as a command.
  const bin = path.join(base, "aimax.sh");
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  const chatOut = path.join(base, "chat.log");
  const logs: string[] = [];
  const runtime = createMogaoRuntime({
    settings: { ...mogaoSettings({ platform: { mogao: { command: bin, ...extra } } }, {}) },
    agentsDir: path.join(base, "agents"),
    log: (m) => logs.push(m),
    chatOut,
    env: { ...process.env, FAKE_AIMAX_DIR: fake },
    pollMs: 50,
  });
  const calls = () =>
    fs
      .readFileSync(path.join(fake, "calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { argv: string[] });
  return { base, repo, runtime, calls, chatOut, logs, agentsDir: path.join(base, "agents") };
}

const start = (runtime: ReturnType<typeof setup>["runtime"], repo: string, prompt: string) =>
  runtime.startAgent({ role: "builder", title: "实现", prompt, cwd: repo, labels: {}, parentAgentId: "chat-1" });

test("摸高：步骤 agent 是一次 aimax run，结果、用量、会话和工具调用都拿得到", { skip: process.platform === "win32" }, async () => {
  const { repo, runtime, calls } = setup();
  try {
    const agent = await start(runtime, repo, "请实现。WRITE:out.txt:hello");
    const outcome = await agent.wait(20_000);
    assert.equal(outcome.status, "idle", outcome.error ?? "");
    assert.match(outcome.lastMessage ?? "", /done: 1 message/);
    assert.deepEqual(outcome.usage, { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 200 });
    assert.equal(fs.readFileSync(path.join(repo, "out.txt"), "utf8"), "hello");
    const run = calls()[0].argv;
    assert.deepEqual(run.slice(0, 3), ["run", "--project-dir", repo]);
    assert.ok(run.includes("--output") && run.includes("--callback-url") && run.includes("--timeout"));
    const tools = await runtime.toolCalls!(agent.id);
    assert.equal(tools?.length, 1);
    assert.equal(tools?.[0].kind, "shell");
    assert.equal(tools?.[0].text, "echo hello > out.txt");
    assert.equal(tools?.[0].status, "completed");
    // The tool's output is kept redacted.
    const events = fs.readFileSync(path.join(path.dirname(repo), "agents", agent.id, "events.jsonl"), "utf8");
    assert.doesNotMatch(events, /SECRET123456/);

    // A follow-up continues the same session.
    await agent.followUp("再检查一遍");
    const again = await agent.wait(20_000);
    assert.equal(again.status, "idle");
    assert.match(again.lastMessage ?? "", /done: 2 message/);
    assert.equal(calls()[1].argv[1], "-s");
  } finally {
    await runtime.close();
  }
});

test("摸高：等待批准时停下，laoshi 转达批准后用 aimax resume 接着做", { skip: process.platform === "win32" }, async () => {
  const { repo, runtime, calls } = setup();
  try {
    const agent = await start(runtime, repo, "清理构建目录。PAUSE");
    const paused = await agent.wait(20_000);
    assert.equal(paused.status, "permission");
    assert.equal(paused.pendingPermissions[0].id, "req-1");
    assert.match(paused.pendingPermissions[0].title, /rm -rf build/);
    // Nothing answered yet: still waiting.
    assert.equal((await agent.wait(200)).status, "permission");

    await runtime.answerPermission!(agent.id, null, true, "需求方批准");
    // A later engine process (another turn) picks the agent up and sends the answer once.
    const done = await runtime.attachAgent(agent.id).wait(20_000);
    assert.equal(done.status, "idle", done.error ?? "");
    assert.match(done.lastMessage ?? "", /approved/);
    assert.equal(fs.readFileSync(path.join(repo, "approved.txt"), "utf8"), "yes");
    const resume = calls().find((c) => c.argv[0] === "resume")!.argv;
    assert.equal(resume[resume.indexOf("--request-id") + 1], "req-1");
    assert.deepEqual(JSON.parse(resume[resume.indexOf("--input-json") + 1]), { action: "approve", reason: "需求方批准" });
    assert.equal(calls().filter((c) => c.argv[0] === "resume").length, 1);
  } finally {
    await runtime.close();
  }
});

test("摸高：拒绝时 agent 不执行那个操作；没有等待批准时不能转达", { skip: process.platform === "win32" }, async () => {
  const { repo, runtime } = setup();
  try {
    const agent = await start(runtime, repo, "PAUSE");
    assert.equal((await agent.wait(20_000)).status, "permission");
    await runtime.answerPermission!(agent.id, null, false, "不要删");
    const done = await agent.wait(20_000);
    assert.equal(done.status, "idle");
    assert.match(done.lastMessage ?? "", /NOT executed/);
    assert.equal(fs.existsSync(path.join(repo, "approved.txt")), false);
    await assert.rejects(runtime.answerPermission!(agent.id, null, true, ""), /没有等待批准的操作/);
  } finally {
    await runtime.close();
  }
});

test("摸高：报错和超过单次运行上限都作为错误交给引擎", { skip: process.platform === "win32" }, async () => {
  const { repo, runtime } = setup({ runTimeoutMinutes: 0.005 });
  try {
    const failed = await (await start(runtime, repo, "FAIL")).wait(20_000);
    assert.equal(failed.status, "error");
    assert.equal(failed.error, "boom");
    const slow = await (await start(runtime, repo, "SLEEP:5000")).wait(20_000);
    assert.equal(slow.status, "error");
    assert.match(slow.error ?? "", /单次运行的上限/);
  } finally {
    await runtime.close();
  }
});

test("摸高：等待中的步骤在时限内没做完返回 timeout；打断后用新指令接着这个会话", { skip: process.platform === "win32" }, async () => {
  const { repo, runtime, calls } = setup();
  try {
    const agent = await start(runtime, repo, "SLEEP:30000");
    assert.equal((await agent.wait(300)).status, "timeout");
    await runtime.interruptAgent(agent.id, "停下，改成 WRITE:stop.txt:ok");
    const done = await agent.wait(20_000);
    assert.equal(done.status, "idle", done.error ?? "");
    assert.equal(fs.readFileSync(path.join(repo, "stop.txt"), "utf8"), "ok");
    assert.equal(calls().at(-1)!.argv[1], "-s");
  } finally {
    await runtime.close();
  }
});

test("摸高：对话轮次结束打断的运行（另一台机器上、没有结果），下一轮接着它的会话继续", { skip: process.platform === "win32" }, async () => {
  const { repo, runtime, calls, agentsDir, logs } = setup();
  try {
    const agent = await start(runtime, repo, "WRITE:a.txt:1");
    assert.equal((await agent.wait(20_000)).status, "idle");
    // As if the latest run had been cut off in an earlier turn's machine.
    const file = path.join(agentsDir, agent.id, "agent.json");
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...record, runs: record.runs + 1, host: "an-earlier-container", pid: 1 }));
    const resumed = await runtime.attachAgent(agent.id).wait(20_000);
    assert.equal(resumed.status, "idle", resumed.error ?? "");
    const last = calls().at(-1)!.argv;
    assert.equal(last[1], "-s");
    assert.match(last[last.indexOf("--message") + 1], /上一次运行被中断/);
    assert.ok(logs.some((l) => l.includes("被中断")));
  } finally {
    await runtime.close();
  }
});

test("摸高：很长的提示词写进文件，消息里让 agent 去读；给对话的消息写进 chat.log", { skip: process.platform === "win32" }, async () => {
  const { repo, runtime, calls, chatOut } = setup();
  try {
    const agent = await start(runtime, repo, `${"说明".repeat(30_000)} WRITE:b.txt:2`);
    assert.equal((await agent.wait(20_000)).status, "idle");
    const message = calls()[0].argv[calls()[0].argv.indexOf("--message") + 1];
    assert.match(message, /请先完整阅读文件 .*prompt\.md/);
    await runtime.notifyAgent("chat-1", "【需求开发流水线通知】方案已确定");
    assert.match(fs.readFileSync(chatOut, "utf8"), /方案已确定/);
  } finally {
    await runtime.close();
  }
});

test("摸高：输出解析和脱敏", () => {
  assert.deepEqual(parseRunOutput('log line\n{"sessionId":"s1","text":"ok"}\n'), { sessionId: "s1", text: "ok" });
  assert.equal(parseRunOutput(""), null);
  assert.equal(redact('headers={"authorization": "Bearer abcdefghijklmnop"}').includes("abcdefghijklmnop"), false);
  assert.equal(redact("AIMAX_AUTH_TOKEN=xyz123456 node x").includes("xyz123456"), false);
  assert.equal(redact("echo hello > out.txt"), "echo hello > out.txt");
});

test("摸高：专家包（make-expert）里的 skill 指向工作区里的程序，第一次使用时自己安装，没有别的平台和占位符", { skip: process.platform === "win32" }, () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-expert-"));
  const kit = path.resolve(import.meta.dirname, "..", "..", "..");
  const r = spawnSync(process.execPath, [path.join(kit, "adapters", "mogao", "make-expert.mjs"), "--out", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const version = JSON.parse(fs.readFileSync(path.join(kit, "package.json"), "utf8")).version;
  const dir = path.join(out, `laoshi-expert-${version}`);
  const entry = fs.readFileSync(path.join(dir, "skills", "laoshi", "SKILL.md"), "utf8");
  assert.match(entry, /\/data\/workspace\/\.laoshi\/npm\/node_modules\/@yiyi_zhang\/laoshi\/bin\/req\.mjs/);
  assert.match(entry, new RegExp(`npm install --prefix /data/workspace/\\.laoshi/npm .*@yiyi_zhang/laoshi@${version.replace(/\./g, "\\.")}`));
  assert.match(entry, /不要结束这一轮对话/);
  // Installed once per workspace; a newer expert brings its own version.
  assert.match(entry, new RegExp(`require\\('/data/workspace/\\.laoshi/npm/node_modules/@yiyi_zhang/laoshi/package\\.json'\\)\\.version" 2>/dev/null\\)" = "${version.replace(/\./g, "\\.")}" \\]`));
  for (const skill of ["laoshi-setup", "laoshi-doctor", "laoshi-retro"]) assert.match(fs.readFileSync(path.join(dir, "skills", skill, "SKILL.md"), "utf8"), /摸高上第一次使用/);
  assert.match(fs.readFileSync(path.join(dir, "skills", "laoshi-setup", "SKILL.md"), "utf8"), /\.laoshi\/tools/);
  assert.match(fs.readFileSync(path.join(dir, "EXPERT.md"), "utf8"), /`laoshi`/);
  const all = execSync(`grep -rlE "\\{\\{|[Pp]aseo|DeepSeek" ${JSON.stringify(path.join(dir, "skills"))} || true`, { encoding: "utf8" }).trim();
  assert.equal(all, "", `仍有占位符或别的平台：${all}`);
});

test("安装根：没有 LAOSHI_HOME 时，用程序所在的 <安装根>/npm（有安装级配置时）", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-home-")));
  const kitRoot = path.join(base, ".laoshi", "npm", "node_modules", "@yiyi_zhang", "laoshi");
  assert.equal(programHome(kitRoot), null);
  fs.mkdirSync(kitRoot, { recursive: true });
  fs.writeFileSync(path.join(base, ".laoshi", "config.json"), "{}");
  assert.equal(programHome(kitRoot), path.join(base, ".laoshi"));
  assert.equal(programHome(path.join(base, ".laoshi", "npm", "lib", "node_modules", "@yiyi_zhang", "laoshi")), path.join(base, ".laoshi"));
  assert.equal(programHome("/opt/laoshi"), null);
});

// Seen in the sandbox: the agent is done but `aimax run` does not exit; the engine waited until the
// platform ended its command. Its complete output, or the "done" callback, now ends the step.
for (const [label, hold] of [["输出里已经有完整结果", false], ["只有平台回调的 done（输出要等进程退出才写）", true]] as const) {
  test(`摸高：agent 做完但 aimax run 进程不退出时，${label}就算这一步结束，并结束残留的进程`, { skip: process.platform === "win32" }, async () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-mogao-linger-")));
    const repo = path.join(base, "repo");
    const fake = path.join(base, "aimax");
    fs.mkdirSync(repo);
    fs.mkdirSync(fake);
    const bin = path.join(base, "aimax.sh");
    fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
    const logs: string[] = [];
    const runtime = createMogaoRuntime({
      settings: mogaoSettings({ platform: { mogao: { command: bin } } }, {}),
      agentsDir: path.join(base, "agents"),
      log: (m) => logs.push(m),
      chatOut: null,
      env: { ...process.env, FAKE_AIMAX_DIR: fake, FAKE_AIMAX_LINGER_MS: "60000", ...(hold ? { FAKE_AIMAX_HOLD_OUTPUT: "1" } : {}) },
      pollMs: 50,
    });
    try {
      const started = Date.now();
      const agent = await runtime.startAgent({ role: "builder", title: "实现", prompt: "WRITE:out.txt:hi", cwd: repo, labels: {}, parentAgentId: "chat-1" });
      const outcome = await agent.wait(20_000);
      assert.equal(outcome.status, "idle", outcome.error ?? "");
      assert.ok(Date.now() - started < 15_000, "不等进程退出");
      assert.equal(outcome.lastMessage, hold ? "done" : "done: 1 message(s)");
      assert.match(logs.join("\n"), /还没有退出：按已完成处理/);
      const record = JSON.parse(fs.readFileSync(path.join(base, "agents", agent.id, "agent.json"), "utf8")) as { pid: number };
      for (let i = 0; i < 50 && isAlive(record.pid); i++) await new Promise((r) => setTimeout(r, 100));
      assert.equal(isAlive(record.pid), false, "残留的 aimax run 进程已结束");
      // The next turn of the same agent is not mistaken for the old one.
      await agent.followUp("再写一个。WRITE:second.txt:yes");
      assert.equal((await agent.wait(20_000)).status, "idle");
      assert.equal(fs.readFileSync(path.join(repo, "second.txt"), "utf8"), "yes");
    } finally {
      await runtime.close();
    }
  });
}

test("摸高：回调按平台的格式解析（usage 在 usage 字段里，工具调用在 progress 里）", () => {
  assert.deepEqual(callbackEvent({ type: "progress", event: { type: "tool_start", toolCallId: "t1", name: "exec" } }), { type: "tool_start", data: { type: "tool_start", toolCallId: "t1", name: "exec" }, progress: true });
  assert.equal(callbackEvent({ type: "usage", usage: { input: 1 } }).data.usage !== undefined, true);
  assert.equal(callbackEvent({ type: "done", result: { text: "x" } }).type, "done");
  assert.deepEqual(toAgentUsage({ input: 210, output: 87, cacheReadTokens: 33728 }), { inputTokens: 33938, cachedInputTokens: 33728, outputTokens: 87 });
});

test("摸高：上一版启动的 agent（记录里没有 runStartedAt）也按最后一个 start 之后的 done 结束", { skip: process.platform === "win32" }, async () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-mogao-handoff-")));
  const repo = path.join(base, "repo");
  const fake = path.join(base, "aimax");
  fs.mkdirSync(repo);
  fs.mkdirSync(fake);
  const bin = path.join(base, "aimax.sh");
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  const runtime = createMogaoRuntime({
    settings: mogaoSettings({ platform: { mogao: { command: bin } } }, {}),
    agentsDir: path.join(base, "agents"),
    log: () => undefined,
    chatOut: null,
    env: { ...process.env, FAKE_AIMAX_DIR: fake, FAKE_AIMAX_LINGER_MS: "60000", FAKE_AIMAX_HOLD_OUTPUT: "1" },
    pollMs: 50,
  });
  try {
    const agent = await runtime.startAgent({ role: "builder", title: "实现", prompt: "WRITE:out.txt:hi", cwd: repo, labels: {}, parentAgentId: "chat-1" });
    const file = path.join(base, "agents", agent.id, "agent.json");
    const { runStartedAt: _dropped, ...older } = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify(older));
    const started = Date.now();
    const outcome = await agent.wait(20_000);
    assert.equal(outcome.status, "idle", outcome.error ?? "");
    assert.ok(Date.now() - started < 15_000);
    assert.deepEqual(outcome.usage, { inputTokens: 1500, cachedInputTokens: 500, outputTokens: 200 });
  } finally {
    await runtime.close();
  }
});
