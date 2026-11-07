#!/usr/bin/env node
// End-to-end check of the 摸高 adapter without the platform: a real laoshi pipeline (quick profile),
// started with `laoshi start` as the expert's skill does it, with a fake `aimax`
// (adapters/mogao/test/fake-aimax.mjs) doing each step. Checks the wiring: the engine runs in the
// chat's command and shows its messages there, each step is an `aimax run` with a progress callback,
// and an approval stops the run, is answered with `laoshi permission`, and the run carries on.
//
//   node adapters/mogao/e2e/run-e2e.mjs [--out <dir>]
// Linux and macOS (the platform's sandbox is Linux).
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const out = path.resolve(outIdx >= 0 ? args[outIdx + 1] : fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-mogao-e2e-")));
const FEATURE = "docs/features/20261107-e2e";
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A repository with a confirmed spec, an install root with a 摸高 config, and the fake aimax. */
function prepare(name, pauseStep) {
  const dir = path.join(out, name);
  const repo = path.join(dir, "repo");
  const home = path.join(dir, "home");
  const fake = path.join(dir, "aimax");
  for (const d of [repo, home, fake]) fs.mkdirSync(d, { recursive: true });
  const git = (...a) => spawnSync("git", a, { cwd: repo, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "e2e@laoshi.local");
  git("config", "user.name", "laoshi e2e");
  fs.writeFileSync(path.join(repo, "README.md"), "# e2e\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  git("checkout", "-q", "-b", "feature/20261107-e2e");
  fs.mkdirSync(path.join(repo, FEATURE), { recursive: true });
  fs.writeFileSync(
    path.join(repo, FEATURE, "spec.md"),
    "# 端到端检查\n\n- 状态：已确认（2026-11-07）\n- 需求提出人：laoshi\n\n## 5. 功能需求与验收标准\n\n### FR-1 跑完流水线\n- **AC-1.1** 每个步骤写出结果文件\n",
  );
  const bin = path.join(dir, "aimax.sh");
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${path.join(root, "adapters", "mogao", "test", "fake-aimax.mjs")}" "$@"\n`, { mode: 0o755 });
  const base = JSON.parse(fs.readFileSync(path.join(root, "config.example.json"), "utf8"));
  fs.writeFileSync(
    path.join(home, "config.json"),
    JSON.stringify({
      ...base,
      platform: { adapter: "mogao", mogao: { command: bin, dataDir: path.join(dir, "data") } },
      agents: { builder: { provider: "mogao/chat-model" }, reviewer: { provider: "mogao/chat-model" } },
      waitChunkSeconds: 2,
      permissionPollSeconds: 1,
      watchdogMinutes: 0,
      selfHeal: false,
      answerQuestionsFirst: false,
      reviewAxes: { enabled: false, profiles: ["standard"] },
    }),
  );
  const env = { ...process.env, LAOSHI_HOME: home, FAKE_AIMAX_DIR: fake, AIMAX_SESSION_ID: `chat-${name}` };
  delete env.REQ_KIT_HOME;
  if (pauseStep) env.FAKE_AIMAX_PAUSE_STEP = pauseStep;
  else delete env.FAKE_AIMAX_PAUSE_STEP;
  return { dir, repo, home, fake, env };
}

/** `laoshi <args>` in the repository, as the chat runs it; resolves when it ends or `until` matches its output. */
function laoshi(ctx, argv, until) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, "bin", "req.mjs"), ...argv], { cwd: ctx.repo, env: ctx.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let done = false;
    const end = (code, cut) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, output, cut });
    };
    const onData = (chunk) => {
      output += chunk;
      if (until && until.test(output)) {
        // The chat's turn ends: the platform takes the machine away with everything running in it.
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
        end(null, true);
      }
    };
    child.stdout.setEncoding("utf8").on("data", onData);
    child.stderr.setEncoding("utf8").on("data", onData);
    child.on("exit", (code) => end(code, false));
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
      end(null, false);
    }, 180_000);
  });
}

const stateOf = (ctx) => JSON.parse(fs.readFileSync(path.join(ctx.repo, FEATURE, ".pipeline", "state.json"), "utf8"));
const calls = (ctx) =>
  fs
    .readFileSync(path.join(ctx.fake, "calls.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l).argv);

// 1. A run straight through.
{
  const ctx = prepare("straight");
  const run = await laoshi(ctx, ["start", FEATURE, "--profile", "quick"]);
  fs.writeFileSync(path.join(ctx.dir, "start.log"), run.output);
  check("一路跑完：laoshi start 在对话的命令里运行到结束", run.code === 0, `退出码 ${run.code}`);
  check("给对话的消息显示在命令输出里", /流水线在这条命令里运行/.test(run.output) && /【需求开发流水线/.test(run.output) && /流水线已停下/.test(run.output));
  let state = null;
  try {
    state = stateOf(ctx);
  } catch {
    // Reported below.
  }
  check("流水线状态为 completed", state?.status === "completed", state ? `${state.status}` : "没有状态文件");
  check("记下了运行它的机器", state?.host === os.hostname());
  const runs = calls(ctx).filter((a) => a[0] === "run");
  check("每个步骤是一次 aimax run（带进度回调）", runs.length >= 3 && runs.every((a) => a.includes("--callback-url") && a.includes("--output")), `${runs.length} 次`);
  const agents = fs.readdirSync(path.join(ctx.home, "mogao", "agents"));
  const events = agents.filter((a) => fs.existsSync(path.join(ctx.home, "mogao", "agents", a, "events.jsonl")));
  check("收到了步骤 agent 的工具调用回调", events.length === agents.length && agents.length > 0, `${events.length}/${agents.length} 个 agent`);
}

// 2. A step stops for an approval; the turn ends; the person approves in the next turn.
{
  const ctx = prepare("approval", "implement");
  const first = await laoshi(ctx, ["start", FEATURE, "--profile", "quick"], /等待权限批准/);
  fs.writeFileSync(path.join(ctx.dir, "start.log"), first.output);
  check("实现步骤等待批准时，对话里看到要批准的操作", first.cut && /rm -rf build/.test(first.output), first.cut ? "" : `命令以 ${first.code} 结束，没有停在批准处`);
  // The killed engine is gone before the next turn (here: until its process has really ended).
  for (let i = 0; i < 100; i++) {
    const pid = stateOf(ctx).pid;
    let alive = true;
    try {
      process.kill(pid, 0);
      alive = !fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.startsWith("Z");
    } catch {
      alive = false;
    }
    if (!alive) break;
    await sleep(100);
  }
  const answer = await laoshi(ctx, ["permission", FEATURE, "approve", "需求方同意"]);
  fs.writeFileSync(path.join(ctx.dir, "permission.log"), answer.output);
  check("laoshi permission approve 转达批准并接着运行到结束", answer.code === 0 && /已批准/.test(answer.output), `退出码 ${answer.code}`);
  let state = null;
  try {
    state = stateOf(ctx);
  } catch {
    // Reported below.
  }
  check("批准后流水线状态为 completed", state?.status === "completed", state ? `${state.status}` : "没有状态文件");
  const resumes = calls(ctx).filter((a) => a[0] === "resume");
  check("批准经 aimax resume 送达一次", resumes.length === 1 && JSON.parse(resumes[0][resumes[0].indexOf("--input-json") + 1]).action === "approve", `${resumes.length} 次`);
  check("被批准的操作执行了", fs.existsSync(path.join(ctx.repo, "approved.txt")));
}

const failed = checks.filter((c) => !c.ok);
fs.writeFileSync(path.join(out, "report.md"), `# 摸高适配器端到端检查\n\n${checks.map((c) => `- ${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? `（${c.detail}）` : ""}`).join("\n")}\n`);
console.log(`\n${checks.length - failed.length}/${checks.length} 项通过；记录在 ${out}`);
process.exit(failed.length ? 1 : 0);
