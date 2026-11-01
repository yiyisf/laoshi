// laoshi M2b: builtin worktree and services (engine/src/builtin), for platforms without their own.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { BUILTIN_CAPABILITIES, withBuiltins } from "../src/builtin/index.js";
import { readProjectServices, ServicesFileError } from "../src/builtin/project-services.js";
import { alive, builtinServices } from "../src/builtin/services.js";
import { builtinWorkspaces, directoryOfWorkspace, workspaceIdOf, workspaceStateDir } from "../src/builtin/workspace.js";
import { adapterFor } from "../src/runtime-loader.js";
import type { AgentRuntime } from "../src/runtime.js";

const log = () => undefined;

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function gitRepo(files: Record<string, string>): string {
  const repo = tempDir("laoshi-builtin-repo-");
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), text);
  }
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return repo;
}

function writeServices(repo: string, value: unknown): void {
  fs.mkdirSync(path.join(repo, ".laoshi"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".laoshi", "services.json"), JSON.stringify(value));
}

// A tiny HTTP service: answers /healthz once listening on PORT, prints a line.
const SERVER = `const http = require("http");
const port = Number(process.argv[2] || process.env.PORT);
http.createServer((req, res) => { res.statusCode = req.url === "/healthz" ? 200 : 404; res.end("ok"); })
  .listen(port, "127.0.0.1", () => console.log("listening on " + port + " via " + process.env.LAOSHI_PORT));
`;

test("服务定义：读取 .laoshi/services.json，写错时说明哪里不对", () => {
  const repo = tempDir("laoshi-services-file-");
  assert.equal(readProjectServices(repo), null);
  writeServices(repo, { setup: "npm ci", services: { web: { command: "node s.js", health: "/healthz" } } });
  assert.deepEqual(readProjectServices(repo), { setup: ["npm ci"], services: { web: { command: "node s.js", health: "/healthz" } } });
  writeServices(repo, { services: { web: {} } });
  assert.throws(() => readProjectServices(repo), (e: Error) => e instanceof ServicesFileError && /web 没有 command/.test(e.message));
  writeServices(repo, { services: { "a b": { command: "x" } } });
  assert.throws(() => readProjectServices(repo), /服务名「a b」/);
  writeServices(repo, { services: { web: { command: "x", port: 70000 } } });
  assert.throws(() => readProjectServices(repo), /port/);
  writeServices(repo, { services: { web: { command: "x", health: "healthz" } } });
  assert.throws(() => readProjectServices(repo), /health/);
});

test("内置服务：分配端口、等到健康检查通过、保留输出；再次启动沿用端口；停止后进程不在", async () => {
  const repo = tempDir("laoshi-services-run-");
  fs.writeFileSync(path.join(repo, "server.cjs"), SERVER);
  writeServices(repo, { services: { web: { command: "node server.cjs {PORT}", health: "/healthz" }, broken: { command: "node -e \"process.exit(3)\"" } } });
  const target = { workspaceId: workspaceIdOf(repo) };
  const services = builtinServices({ log, pollMs: 100 });
  assert.deepEqual(await services.listServices(target), ["web", "broken"]);
  const [web, broken] = await services.startServices(target, ["web", "broken"], 20_000);
  try {
    assert.equal(web.running, true);
    assert.equal(web.health, "healthy");
    assert.equal(web.url, `http://127.0.0.1:${web.port}`);
    assert.match(web.output ?? "", new RegExp(`listening on ${web.port} via ${web.port}`));
    assert.equal(broken.running, false);
    assert.equal(broken.exitCode, 3);

    const again = await services.startServices(target, ["web"], 20_000);
    assert.equal(again[0].port, web.port, "同一工作区再次启动沿用端口");
    assert.equal(again[0].health, "healthy");
  } finally {
    await services.stopServices(target, ["web", "broken"]);
  }
  const rec = JSON.parse(fs.readFileSync(path.join(workspaceStateDir(repo), "services", "web.json"), "utf8"));
  assert.equal(rec.pid, null);
  await assert.rejects(services.startServices(target, ["nope"], 1000), /没有服务 nope/);
});

test("内置服务：对话的服务用对话的工作目录；找不到目录时没有服务", async () => {
  const repo = tempDir("laoshi-services-chat-");
  writeServices(repo, { services: { web: { command: "node -e 0" } } });
  const services = builtinServices({ log, agentDirectory: async (id) => (id === "chat" ? repo : null) });
  assert.deepEqual(await services.listServices({ agentId: "chat" }), ["web"]);
  assert.equal(await services.listServices({ agentId: "other" }), null);
  assert.equal(await services.listServices({ workspaceId: "paseo-ws-1" }), null);
});

test("内置 worktree：在安装目录下用 git worktree 新建分支，后台运行准备命令，状态可以等待", async () => {
  const repo = gitRepo({
    "README.md": "hi\n",
    ".laoshi/services.json": JSON.stringify({ setup: ["node -e \"require('fs').writeFileSync('ready.txt', process.env.LAOSHI_SOURCE_CHECKOUT_PATH)\""] }),
  });
  const ws = builtinWorkspaces({ log, pollMs: 100 });
  const created = await ws.createWorktree({ sourceRepo: repo, baseRef: "main", branchName: "feature/demo", title: "演示", callerAgentId: null });
  assert.equal(directoryOfWorkspace(created.workspaceId), created.directory);
  assert.equal(execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: created.directory, encoding: "utf8" }).trim(), "feature/demo");
  assert.deepEqual(await ws.waitForWorkspaceSetup(created.workspaceId, 30_000), { status: "completed", error: null });
  assert.equal(fs.readFileSync(path.join(created.directory, "ready.txt"), "utf8"), repo);
  await assert.rejects(ws.createWorktree({ sourceRepo: repo, baseRef: "main", branchName: "feature/demo", title: "演示", callerAgentId: null }), /已经存在/);
  assert.deepEqual(await ws.openWorkspace(created.directory), { workspaceId: created.workspaceId });
  assert.deepEqual(await ws.waitForWorkspaceSetup("paseo-ws-1", 1000), { status: "none", error: null });
});

test("内置 worktree：准备命令失败时说明哪条命令、输出在哪；没有准备命令时不用等", async () => {
  const repo = gitRepo({ ".laoshi/services.json": JSON.stringify({ setup: ["node -e \"process.exit(2)\""] }) });
  const ws = builtinWorkspaces({ log, pollMs: 100 });
  const created = await ws.createWorktree({ sourceRepo: repo, baseRef: "main", branchName: "feature/bad", title: "x", callerAgentId: null });
  const result = await ws.waitForWorkspaceSetup(created.workspaceId, 30_000);
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /准备命令「node -e "process.exit\(2\)"」失败（退出码 2），输出见 .*setup\.log/);

  const plain = gitRepo({ "README.md": "x\n" });
  const c2 = await ws.createWorktree({ sourceRepo: plain, baseRef: "main", branchName: "feature/plain", title: "x", callerAgentId: null });
  assert.deepEqual(await ws.waitForWorkspaceSetup(c2.workspaceId, 1000), { status: "none", error: null });
});

test("运行时层：适配器声明为 builtin 的能力换成内置实现，其余保持原样", async () => {
  const placeholder = async () => {
    throw new Error("placeholder");
  };
  const runtime = { listServices: placeholder, startServices: placeholder, stopServices: placeholder, createWorktree: placeholder, waitForWorkspaceSetup: placeholder, scheduleMessage: async () => "s" } as unknown as AgentRuntime;
  const r = withBuiltins(runtime, { capabilities: { services: "builtin", worktree: "builtin", scheduling: "plugin" } }, { log });
  assert.equal(await r.listServices({ workspaceId: "paseo-ws" }), null);
  assert.deepEqual(await r.waitForWorkspaceSetup("paseo-ws", 1), { status: "none", error: null });
  assert.equal(typeof r.openWorkspace, "function");
  assert.equal(await r.scheduleMessage({} as never), "s");
  const untouched = withBuiltins(runtime, { capabilities: { services: "platform" } }, { log });
  assert.equal(untouched.listServices, placeholder);

  for (const id of ["paseo", "dsh"]) {
    for (const [name, source] of Object.entries(adapterFor({ platform: { adapter: id } }).capabilities)) {
      if (source === "builtin") assert.ok(BUILTIN_CAPABILITIES.includes(name as never), `${id} 声明 ${name} 为内置，但 laoshi 还没有内置它`);
    }
  }
  assert.equal(adapterFor({ platform: { adapter: "dsh" } }).capabilities.worktree, "builtin");
});

test("进程是否存在：不存在的 PID 为否", () => {
  assert.equal(alive(null), false);
  assert.equal(alive(process.pid), true);
});
