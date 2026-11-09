// `laoshi migrate` (adapters/paseo/migrate.ts): req-kit 1.x's machine setup to laoshi, previewed,
// applied and rolled back, on a made-up ~/.req-kit with a finished and a running requirement.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { applyMigration, migrateConfig, planMigration, RECORD_FILE, rollbackMigration } from "../migrate.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const LEGACY_PROFILE = "pa" + "seoProfile";

function oldMachine() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-migrate-")));
  const from = path.join(base, "req-kit");
  const to = path.join(base, "laoshi");
  const repo = path.join(base, "shop");
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value, null, 2));
  };
  write(path.join(from, "config.json"), { daemonUrl: "ws://10.0.0.5:6767/ws", agents: { builder: { [LEGACY_PROFILE]: "实现" }, reviewer: { provider: "codex/gpt" } }, defaultProfile: "standard" });
  write(path.join(from, "usage", "runs.jsonl"), `${JSON.stringify({ schema: 1, kind: "run" })}\n`);
  write(path.join(from, "prompts.local", "design.md"), "本机提示词\n");
  const feature = (name: string, state: Record<string, unknown>) => {
    const featureDir = `docs/features/${name}`;
    write(path.join(repo, featureDir, "spec.md"), "# 需求\n");
    write(path.join(repo, featureDir, ".pipeline", "state.json"), state);
    write(path.join(from, "index", `${name}.json`), { repo, featureDir, project: "shop" });
    return path.join(repo, featureDir, ".pipeline", "state.json");
  };
  const done = feature("20261001-done", { repo, featureDir: "docs/features/20261001-done", status: "completed", originAgentId: "chat-9", worktree: { workspaceId: "ws-1", sourceRepo: repo } });
  write(path.join(repo, ".requirement-pipeline.json"), { checks: [] });
  return { base, from, to, repo, done, feature };
}

test("迁移配置：daemon 地址移到 platform.paseo，旧的 profile 字段改名，其他设置不变", () => {
  const config = migrateConfig({ daemonUrl: "ws://x/ws", daemonPasswordEnv: "PW", agents: { builder: { [LEGACY_PROFILE]: "实现" } }, defaultProfile: "quick" });
  assert.deepEqual(config, { agents: { builder: { platformProfile: "实现" } }, defaultProfile: "quick", platform: { adapter: "paseo", paseo: { daemonUrl: "ws://x/ws", daemonPasswordEnv: "PW" } } });
});

test("laoshi migrate：预览不改任何东西；执行后配置、使用记录、索引都在新目录，旧格式的状态改为第 2 版并留备份；回滚恢复原样", () => {
  const m = oldMachine();
  const before = fs.readFileSync(m.done, "utf8");

  const preview = spawnSync(process.execPath, [path.join(ROOT, "bin", "req.mjs"), "migrate", "--from", m.from, "--to", m.to], { encoding: "utf8", env: { ...process.env, REQ_KIT_HOME: "" } });
  assert.equal(preview.status, 0, preview.stdout + preview.stderr);
  assert.match(preview.stdout, /预览：不改任何东西/);
  assert.match(preview.stdout, /1 个旧格式的状态文件/);
  assert.match(preview.stdout, /\.requirement-pipeline\.json/);
  assert.ok(!fs.existsSync(m.to), "预览不建新目录");
  assert.equal(fs.readFileSync(m.done, "utf8"), before);

  const plan = planMigration(m.from, m.to, {});
  assert.deepEqual(plan.blockers, []);
  const record = applyMigration(plan);
  const config = JSON.parse(fs.readFileSync(path.join(m.to, "config.json"), "utf8"));
  assert.equal(config.platform.paseo.daemonUrl, "ws://10.0.0.5:6767/ws");
  assert.equal(config.agents.builder.platformProfile, "实现");
  for (const f of ["usage/runs.jsonl", "prompts.local/design.md", "index/20261001-done.json"]) assert.ok(fs.existsSync(path.join(m.to, f)), f);
  const state = JSON.parse(fs.readFileSync(m.done, "utf8"));
  assert.equal(state.version, 2);
  assert.equal(state.originSessionId, "chat-9");
  assert.equal(state.worktree.workspaceRef, "ws-1");
  assert.equal(fs.readFileSync(`${m.done}.bak-v1`, "utf8"), before);
  assert.equal(record.states.length, 1);
  assert.ok(fs.existsSync(path.join(m.from, "config.json")), "旧目录不动");

  assert.match(planMigration(m.from, m.to, {}).blockers.join(), /已经迁移过/);

  const back = rollbackMigration(m.to);
  assert.deepEqual(back.restored, [m.done]);
  assert.equal(fs.readFileSync(m.done, "utf8"), before);
  assert.ok(!fs.existsSync(m.to), "新目录里迁移写入的文件都删了");
});

test("laoshi migrate：有流水线正在运行时不迁移；新目录已有 laoshi 配置时不覆盖", async () => {
  const m = oldMachine();
  const sleeper = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { stdio: "ignore" });
  try {
    m.feature("20261002-running", { repo: m.repo, featureDir: "docs/features/20261002-running", status: "running", pid: sleeper.pid });
    const plan = planMigration(m.from, m.to, {});
    assert.match(plan.blockers.join("\n"), /正在运行/);
    assert.throws(() => applyMigration(plan), /正在运行/);
  } finally {
    sleeper.kill();
  }
  fs.mkdirSync(m.to, { recursive: true });
  fs.writeFileSync(path.join(m.to, "config.json"), "{}");
  assert.match(planMigration(m.from, m.to, {}).blockers.join("\n"), /已经有 laoshi 的配置/);
  assert.ok(!fs.existsSync(path.join(m.to, RECORD_FILE)));
});
