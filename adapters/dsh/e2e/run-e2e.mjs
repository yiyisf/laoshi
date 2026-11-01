#!/usr/bin/env node
// End-to-end check of the dsh adapter (M4b prototype): a real laoshi pipeline (quick profile) on a
// real dsh host, through laoshi's dsh plugin. Only the model is scripted (step-model.mjs), so this
// checks the wiring, not a model's work: the engine starts each step as a child of the chat, waits
// for it, reads its result file, and reports back to the chat.
//
// Needs dsh installed: LAOSHI_E2E_DSH is a directory with node_modules/@deepseek-ai/dsh
// (npm install @deepseek-ai/dsh@0.2.2-alpha.2 there). Run with Node.js 22.19+ (dsh declares 24.9+):
//   LAOSHI_E2E_DSH=<dir> node adapters/dsh/e2e/run-e2e.mjs [--out <dir>] [--worktree]
// --worktree (laoshi M2b): start through the launcher with --worktree, so the requirement gets its
// own worktree (builtin git worktree, setup commands from .laoshi/services.json) and verification
// gets a builtin service.
// Linux and macOS. On Windows dsh needs a shell setup first (docs/discovery/dsh/report.md).
import { execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { channelPaths } from "../plugin/channel.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const WORKTREE = args.includes("--worktree");
const out = path.resolve(outIdx >= 0 ? args[outIdx + 1] : fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-dsh-e2e-")));
const dshDir = process.env.LAOSHI_E2E_DSH;
const dshPkg = dshDir && path.join(path.resolve(dshDir), "node_modules", "@deepseek-ai", "dsh");
if (!dshPkg || !fs.existsSync(path.join(dshPkg, "package.json"))) {
  console.error("请用 LAOSHI_E2E_DSH 指定装有 @deepseek-ai/dsh 的目录（其下有 node_modules/@deepseek-ai/dsh）");
  process.exit(2);
}
const pkg = JSON.parse(fs.readFileSync(path.join(dshPkg, "package.json"), "utf8"));
const dshBin = path.join(dshPkg, typeof pkg.bin === "string" ? pkg.bin : pkg.bin.dsh);

const home = path.join(out, "dsh-home");
const repo = path.join(out, "repo");
const logs = path.join(out, "logs");
for (const d of [home, repo, logs]) fs.mkdirSync(d, { recursive: true });
const FEATURE = "docs/features/20261101-e2e";
const env = { ...process.env, DSH_HOME: home, LAOSHI_E2E_KEY: "e2e" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// ---- dsh: plugin, profile, model, host
const port = 42000 + Math.floor(Math.random() * 1000);
const model = spawn(process.execPath, [path.join(here, "step-model.mjs"), String(port), path.join(logs, "step-model.log")], { stdio: "ignore" });
try {
  execFileSync(process.execPath, [dshBin, "plugin", "--profile", "web", "add", `file:${path.join(root, "adapters", "dsh", "plugin").replace(/\\/g, "/")}`], { env, stdio: "ignore" });
} catch {
  const target = path.join(home, "profiles", "web", "node_modules", "laoshi-dsh-plugin");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(path.join(root, "adapters", "dsh", "plugin"), target, { recursive: true });
}
fs.mkdirSync(path.join(home, "profiles", "web"), { recursive: true });
fs.writeFileSync(
  path.join(home, "profiles", "web", "cordis.patch.yml"),
  `- id: llm-pi-ai
  config:
    providers:
      e2e:
        apiKeyEnv: LAOSHI_E2E_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:${port}/v1
        models:
          - id: step-1
- id: agent-default-model
  config:
    provider: e2e
    model: step-1
- insert:
    - id: laoshi-dsh
      name: 'laoshi-dsh-plugin'
      config:
        approvals: ask
`,
);

// The sample project: a confirmed requirement on its own branch.
const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
git("init", "-q");
if (WORKTREE) {
  // On main, with a service and setup commands committed: the launcher cuts the requirement's worktree from here.
  git("checkout", "-q", "-b", "main");
  git("config", "user.email", "e2e@laoshi.invalid");
  git("config", "user.name", "laoshi e2e");
  fs.writeFileSync(
    path.join(repo, "server.cjs"),
    'require("http").createServer((q, s) => { s.statusCode = q.url === "/healthz" ? 200 : 404; s.end("ok"); }).listen(Number(process.argv[2]), "127.0.0.1", () => console.log("e2e service on " + process.argv[2]));\n',
  );
  fs.mkdirSync(path.join(repo, ".laoshi"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, ".laoshi", "services.json"),
    JSON.stringify({ setup: [`node -e "require('fs').writeFileSync('setup-done.txt', String(process.env.LAOSHI_SOURCE_CHECKOUT_PATH))"`], services: { web: { command: "node server.cjs {PORT}", health: "/healthz" } } }, null, 2),
  );
  git("add", "-A");
  git("commit", "-q", "-m", "e2e project");
} else {
  git("checkout", "-q", "-b", "feature/20261101-e2e");
}
fs.mkdirSync(path.join(repo, FEATURE), { recursive: true });
fs.writeFileSync(
  path.join(repo, FEATURE, "spec.md"),
  "# 端到端检查\n\n- 状态：已确认（2026-11-01）\n- 需求提出人：laoshi\n\n## 5. 功能需求与验收标准\n\n### FR-1 跑完流水线\n- **AC-1.1** 每个步骤写出结果文件\n",
);
const base = JSON.parse(fs.readFileSync(path.join(root, "config.example.json"), "utf8"));
const configPath = path.join(out, "config.json");
fs.writeFileSync(
  configPath,
  JSON.stringify({
    ...base,
    platform: { adapter: "dsh" },
    agents: { builder: { provider: "dsh/chat-model" }, reviewer: { provider: "dsh/chat-model" } },
    waitChunkSeconds: 2,
    watchdogMinutes: 0,
    selfHeal: false,
    answerQuestionsFirst: false,
    reviewAxes: { enabled: false, profiles: ["standard"] },
  }),
);

const host = spawn(process.execPath, [dshBin, "--profile", "web", "--no-open", "--port", "0"], {
  cwd: repo,
  env,
  stdio: ["ignore", fs.openSync(path.join(logs, "host.log"), "w"), fs.openSync(path.join(logs, "host.log"), "a")],
  detached: process.platform !== "win32",
});
const stop = () => {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(host.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-host.pid, "SIGTERM");
  } catch {}
  model.kill();
};

let exitCode = 1;
try {
  const { token } = channelPaths(home);
  for (let i = 0; i < 180 && !fs.existsSync(token); i++) await sleep(1000);
  check("dsh 启动并加载 laoshi 插件", fs.existsSync(token));
  if (!fs.existsSync(token)) throw new Error("插件没有启动，见 logs/host.log");

  // The runtime is TypeScript; run the pieces that need it through tsx.
  const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const helper = path.join(here, "chat.ts");
  const chatRun = spawnSync(process.execPath, [tsx, helper, repo], { env, encoding: "utf8", timeout: 120_000 });
  const chat = chatRun.stdout.trim().split("\n").at(-1);
  check("建立发起流水线的对话", chatRun.status === 0 && /^session-/.test(chat ?? ""), chatRun.status === 0 ? chat : chatRun.stderr.slice(-300));

  const started = Date.now();
  const kitHome = path.join(out, "kit-home");
  let workRepo = repo;
  if (WORKTREE) {
    // The launcher creates the worktree, then runs the pipeline there in the background.
    const launch = spawnSync(
      process.execPath,
      [tsx, path.join(root, "engine", "src", "launch.ts"), "--repo", repo, "--feature", FEATURE, "--config", configPath, "--origin-agent", chat, "--profile", "quick", "--worktree"],
      { env: { ...env, REQ_KIT_HOME: kitHome }, encoding: "utf8", timeout: 5 * 60_000 },
    );
    fs.writeFileSync(path.join(logs, "launch.log"), `${launch.stdout}${launch.stderr}`);
    check("启动器新建了需求自己的工作区", launch.status === 0, launch.status === 0 ? launch.stdout.trim().split("\n")[0] : `${launch.stdout}${launch.stderr}`.slice(-400));
    const list = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repo, encoding: "utf8" });
    const entry = list.split(/\n\n/).find((b) => b.includes("branch refs/heads/feature/20261101-e2e"));
    workRepo = entry ? /^worktree (.+)$/m.exec(entry)[1] : repo;
    check("工作区是内置的 git worktree（在安装目录下，分支 feature/20261101-e2e）", Boolean(entry) && workRepo.startsWith(fs.realpathSync(kitHome)), workRepo);
    const terminal = () => {
      try {
        return ["completed", "failed", "waiting_for_approval", "waiting_for_business"].includes(JSON.parse(fs.readFileSync(path.join(workRepo, FEATURE, ".pipeline", "state.json"), "utf8")).status);
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 15 * 60 && !terminal(); i++) await sleep(1000);
    const pipelineLog = path.join(workRepo, FEATURE, ".pipeline", "pipeline.log");
    if (fs.existsSync(pipelineLog)) fs.copyFileSync(pipelineLog, path.join(logs, "engine.log"));
    check("流水线在工作区中跑完", terminal(), `用时 ${((Date.now() - started) / 60_000).toFixed(1)} 分钟（见 logs/engine.log）`);
  } else {
    const run = spawnSync(
      process.execPath,
      [tsx, path.join(root, "engine", "src", "main.ts"), "--repo", repo, "--feature", FEATURE, "--config", configPath, "--origin-agent", chat, "--profile", "quick"],
      { env: { ...env, REQ_KIT_HOME: kitHome }, encoding: "utf8", timeout: 15 * 60_000 },
    );
    fs.writeFileSync(path.join(logs, "engine.log"), `${run.stdout}${run.stderr}`);
    const minutes = ((Date.now() - started) / 60_000).toFixed(1);
    check("流水线进程正常结束", run.status === 0, `退出码 ${run.status}，用时 ${minutes} 分钟（见 logs/engine.log）`);
  }

  const stateFile = path.join(workRepo, FEATURE, ".pipeline", "state.json");
  const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : null;
  check("流水线状态为 completed", state?.status === "completed", `status=${state?.status ?? "（没有状态文件）"}`);
  const keys = Object.keys(state?.results ?? {});
  check("每个步骤都有结果", keys.length >= 4, keys.join("、"));
  check("完成报告已生成", fs.existsSync(path.join(workRepo, FEATURE, "report.md")));
  if (WORKTREE) {
    const done = path.join(workRepo, "setup-done.txt");
    check("新工作区的准备命令已运行", fs.existsSync(done) && fs.readFileSync(done, "utf8") === fs.realpathSync(repo), fs.existsSync(done) ? fs.readFileSync(done, "utf8") : "没有 setup-done.txt");
    const engineLog = fs.existsSync(path.join(logs, "engine.log")) ? fs.readFileSync(path.join(logs, "engine.log"), "utf8") : "";
    check("验证前启动了内置服务并通过健康检查", /web → http:\/\/127\.0\.0\.1:\d+（端口 \d+），已启动，健康检查通过/.test(engineLog), /web → [^\n]*/.exec(engineLog)?.[0] ?? "日志中没有服务 web");
    const recs = path.join(kitHome, "workspaces");
    const web = fs.existsSync(recs) ? fs.readdirSync(recs).map((d) => path.join(recs, d, "services", "web.json")).find((f) => fs.existsSync(f)) : null;
    check("流水线结束后服务已停止", Boolean(web) && JSON.parse(fs.readFileSync(web, "utf8")).pid === null, web ?? "没有服务记录");
  }

  const pluginLog = fs.readFileSync(channelPaths(home).log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const spawned = pluginLog.filter((l) => l.spawn);
  check("步骤 agent 都挂在对话下", spawned.length >= keys.length && spawned.every((l) => l.parent === chat), `${spawned.length} 个子 agent：${spawned.map((l) => l.label).join("、")}`);
  if (WORKTREE) check("步骤 agent 在需求的工作区中工作", spawned.length > 0 && spawned.every((l) => l.cwd === workRepo), [...new Set(spawned.map((l) => l.cwd))].join("、"));
  // The final note is queued into the chat as the engine exits: give the chat time to read it.
  const notes = () => fs.readFileSync(path.join(logs, "step-model.log"), "utf8").split("\n").filter((l) => l.includes('"chat"') && l.includes("流水线"));
  for (let i = 0; i < 60 && !notes().some((l) => l.includes("流水线已经结束")); i++) await sleep(1000);
  const chatNotes = notes();
  check("进展和结论发回了对话", chatNotes.some((l) => l.includes("流水线已经结束")), `对话收到 ${chatNotes.length} 条流水线消息，含结束通知：${chatNotes.some((l) => l.includes("流水线已经结束"))}`);
  exitCode = checks.every((c) => c.ok) ? 0 : 1;
} catch (e) {
  check("端到端检查没有完成", false, e.message);
} finally {
  stop();
  const lines = ["# dsh 端到端检查", "", `- 时间：${new Date().toISOString()}`, `- dsh：${pkg.version}；Node：${process.version}；平台：${process.platform}`, "", ...checks.map((c) => `- ${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? `：${c.detail}` : ""}`), ""];
  fs.writeFileSync(path.join(out, "report.md"), lines.join("\n"));
  console.log(`\n输出目录：${out}`);
}
process.exit(exitCode);
