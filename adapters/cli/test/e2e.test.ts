// End to end without a platform: `laoshi start` runs a real pipeline (quick profile) in the
// background with the cli adapter, each step a run of the fake `claude` / `codex` (fake-agent.mjs).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const FAKE = path.join(import.meta.dirname, "fake-agent.mjs");
const FEATURE = "docs/features/20261109-cli";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("命令行适配器：laoshi start 在后台跑完一条 quick 流水线，builder 用 claude、reviewer 用 codex", { skip: process.platform === "win32" }, async () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-cli-e2e-")));
  const repo = path.join(base, "repo");
  const home = path.join(base, "home");
  const fake = path.join(base, "fake");
  for (const d of [repo, home, fake]) fs.mkdirSync(d, { recursive: true });
  const git = (...a: string[]) => spawnSync("git", a, { cwd: repo, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "e2e@laoshi.local");
  git("config", "user.name", "laoshi e2e");
  fs.writeFileSync(path.join(repo, "README.md"), "# e2e\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  git("checkout", "-q", "-b", "feature/20261109-cli");
  fs.mkdirSync(path.join(repo, FEATURE), { recursive: true });
  fs.writeFileSync(
    path.join(repo, FEATURE, "spec.md"),
    "# 命令行端到端\n\n- 状态：已确认（2026-11-09）\n- 需求提出人：laoshi\n\n## 5. 功能需求与验收标准\n\n### FR-1 跑完流水线\n- **AC-1.1** 每个步骤写出结果文件\n",
  );
  const bin = path.join(base, "agent.sh");
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
  const example = JSON.parse(fs.readFileSync(path.join(ROOT, "config.example.json"), "utf8"));
  fs.writeFileSync(
    path.join(home, "config.json"),
    JSON.stringify({
      ...example,
      platform: { adapter: "cli", cli: { claude: bin, codex: bin } },
      agents: { builder: { provider: "claude/default" }, reviewer: { provider: "codex/default" } },
      waitChunkSeconds: 2,
      watchdogMinutes: 0,
      selfHeal: false,
      answerQuestionsFirst: false,
      reviewAxes: { enabled: false, profiles: ["standard"] },
    }),
  );
  // LAOSHI_CLI_ORIGIN: messages for people also go to <install root>/cli/messages.log.
  const env: NodeJS.ProcessEnv = { ...process.env, LAOSHI_HOME: home, FAKE_AGENT_DIR: fake, LAOSHI_CLI_ORIGIN: "terminal-1" };
  delete env.REQ_KIT_HOME;
  const started = spawnSync(process.execPath, [path.join(ROOT, "bin", "req.mjs"), "start", FEATURE, "--profile", "quick"], { cwd: repo, env, encoding: "utf8", timeout: 60_000 });
  assert.equal(started.status, 0, started.stdout + started.stderr);

  const stateFile = path.join(repo, FEATURE, ".pipeline", "state.json");
  let state: { status?: string } | null = null;
  for (let i = 0; i < 240; i++) {
    try {
      state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
      state = null;
    }
    if (state && state.status !== "running") break;
    await sleep(250);
  }
  const calls = fs
    .readFileSync(path.join(fake, "calls.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { kind: string });
  assert.equal(state?.status, "completed", `${JSON.stringify(state)}\n${fs.existsSync(path.join(repo, FEATURE, ".pipeline")) ? fs.readdirSync(path.join(repo, FEATURE, ".pipeline")).join(" ") : ""}`);
  assert.ok(calls.some((c) => c.kind === "claude") && calls.some((c) => c.kind === "codex"), "两种命令行都用到了");
  assert.ok(fs.readdirSync(path.join(home, "cli", "agents")).length >= 3, "每个步骤一个 agent 记录");
  assert.match(fs.readFileSync(path.join(repo, FEATURE, ".pipeline", "pipeline.log"), "utf8"), /通知：/);
  assert.match(fs.readFileSync(path.join(home, "cli", "messages.log"), "utf8"), /【需求开发流水线/);
});
