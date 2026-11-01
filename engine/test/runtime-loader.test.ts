// laoshi M1: the runtime comes from the platform adapter the config names (platform.adapter).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_CONFIG, loadConfig } from "../src/config.js";
import { ADAPTER_IDS, loadRuntimeFactory } from "../src/runtime-loader.js";

const agents = {
  builder: { provider: "claude/m", modeId: "bypassPermissions" },
  reviewer: { provider: "codex/m", modeId: "full-access" },
};

function machineConfig(extra: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-platform-"));
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify({ agents, ...extra }));
  return file;
}

test("平台适配器：默认是 paseo，可以在配置里用 platform.adapter 指定", () => {
  assert.deepEqual(DEFAULT_CONFIG.platform, { adapter: "paseo" });
  assert.ok(ADAPTER_IDS.includes("paseo"));
  assert.equal(loadConfig(machineConfig({})).config.platform.adapter, "paseo");
  assert.equal(loadConfig(machineConfig({ platform: { adapter: "dsh" } })).config.platform.adapter, "dsh");
  assert.throws(() => loadConfig(machineConfig({ platform: { adapter: "" } })), /platform\.adapter/);
  assert.throws(() => loadConfig(machineConfig({ platform: "paseo" })), /platform\.adapter/);
});

test("平台适配器：没有这个适配器时，创建运行时报错并列出可用的适配器", async () => {
  const saved = process.env.REQ_PIPELINE_FAKE_RUNTIME;
  delete process.env.REQ_PIPELINE_FAKE_RUNTIME;
  try {
    const createRuntime = await loadRuntimeFactory();
    const config = { ...DEFAULT_CONFIG, platform: { adapter: "nope" } };
    await assert.rejects(createRuntime({ config, log: () => undefined }), /没有名为「nope」的平台适配器.*paseo/);
  } finally {
    if (saved !== undefined) process.env.REQ_PIPELINE_FAKE_RUNTIME = saved;
  }
});
