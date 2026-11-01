// laoshi M2a: the core reaches a platform only through its adapter (engine/src/platform.ts).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG } from "../src/config.js";
import { CAPABILITIES, describeProfileDefault, sourceOf, withCapabilities } from "../src/platform.js";
import { adapterFor, adapterIdOf, describeProfile, originEnvNames, originFromEnv, resolveProfiles, scrubOriginEnv } from "../src/runtime-loader.js";
import type { AgentRuntime } from "../src/runtime.js";

const ENGINE_SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

test("核心只在 runtime-loader.ts 中引用适配器", () => {
  const offenders = fs
    .readdirSync(ENGINE_SRC)
    .filter((f) => f.endsWith(".ts") && f !== "runtime-loader.ts")
    .filter((f) => /from\s+["'][^"']*adapters\/|import\(\s*["'][^"']*adapters\//.test(fs.readFileSync(path.join(ENGINE_SRC, f), "utf8")));
  assert.deepEqual(offenders, []);
});

test("适配器：按配置的 platform.adapter 选择，缺省为 paseo，未知的报错", () => {
  assert.equal(adapterIdOf(null), "paseo");
  assert.equal(adapterIdOf({ platform: "dsh" }), "paseo");
  assert.equal(adapterFor(DEFAULT_CONFIG).id, "paseo");
  assert.equal(adapterFor({ platform: { adapter: "dsh" } }).id, "dsh");
  assert.throws(() => adapterFor({ platform: { adapter: "nope" } }), /没有名为「nope」的平台适配器/);
});

test("每个适配器声明的能力都在能力表中", () => {
  for (const id of ["paseo", "dsh"]) {
    for (const name of Object.keys(adapterFor({ platform: { adapter: id } }).capabilities)) assert.ok(name in CAPABILITIES, `${id}: ${name}`);
  }
  assert.equal(sourceOf(adapterFor({ platform: { adapter: "paseo" } }), "worktree"), "platform");
  assert.equal(sourceOf(adapterFor({ platform: { adapter: "dsh" } }), "worktree"), "none");
  assert.equal(sourceOf(adapterFor({ platform: { adapter: "dsh" } }), "scheduling"), "plugin");
});

function stubRuntime(): AgentRuntime {
  const called = (name: string) => async () => {
    throw new Error(`called ${name}`);
  };
  return {
    verifyOrigin: async () => undefined,
    startAgent: called("startAgent"),
    attachAgent: () => {
      throw new Error("attachAgent");
    },
    startSessionAgent: async () => "s1",
    notifyAgent: async () => undefined,
    interruptAgent: async () => undefined,
    listProfiles: called("listProfiles"),
    listServices: called("listServices"),
    startServices: called("startServices"),
    stopServices: called("stopServices"),
    createWorktree: called("createWorktree"),
    openWorkspace: called("openWorkspace"),
    waitForWorkspaceSetup: called("waitForWorkspaceSetup"),
    providerQuota: called("providerQuota"),
    recentActivity: called("recentActivity"),
    runningTool: called("runningTool"),
    toolCalls: called("toolCalls"),
    capabilities: called("capabilities"),
    providerStatus: called("providerStatus"),
    scheduleMessage: async () => "sched-1",
    scheduleNewAgent: called("scheduleNewAgent"),
    cancelSchedule: async () => undefined,
    close: async () => undefined,
  } as unknown as AgentRuntime;
}

test("未声明的能力统一降级：可选读取为 null、定时不安排、按需操作报原因；声明了的保持原样", async () => {
  const r = withCapabilities(stubRuntime(), { displayName: "测试平台", capabilities: { scheduling: "plugin", sessionAgent: "plugin" } });
  assert.equal(await r.listProfiles(), null);
  assert.equal(await r.listServices({} as never), null);
  assert.equal(await r.providerQuota([]), null);
  assert.equal(await r.recentActivity("a", 5), null);
  assert.equal(await r.runningTool("a"), null);
  assert.equal(await r.toolCalls?.("a"), null);
  assert.equal(await r.capabilities(), null);
  assert.equal(await r.scheduleNewAgent({} as never), null);
  assert.deepEqual(await r.waitForWorkspaceSetup("w", 1), { status: "none", error: null });
  assert.equal(r.openWorkspace, undefined);
  await assert.rejects(r.createWorktree({} as never), /测试平台 不支持为需求新建工作区/);
  await assert.rejects(r.startServices({} as never, [], 1), /测试平台 不支持由平台管理服务/);
  assert.equal(await r.scheduleMessage({} as never), "sched-1");
  assert.equal(await r.startSessionAgent({} as never), "s1");
});

test("发起对话：从任一平台的环境变量识别，子进程去掉所有平台的变量", () => {
  assert.deepEqual(originFromEnv({ PASEO_AGENT_ID: "a1", PASEO_AGENT_CWD: "/r" }), { adapter: "paseo", id: "a1", cwd: "/r" });
  assert.deepEqual(originFromEnv({ DSH_SESSION_ID: "s1" }), { adapter: "dsh", id: "s1", cwd: null });
  assert.equal(originFromEnv({}), null);
  assert.equal(originFromEnv({ PASEO_AGENT_ID: "a1", DSH_SESSION_ID: "s1" }, adapterFor({ platform: { adapter: "dsh" } }))?.id, "s1");
  assert.ok(originEnvNames().includes("DSH_SESSION_ID"));
  const env = scrubOriginEnv({ PASEO_AGENT_ID: "a", PASEO_AGENT_CWD: "/r", DSH_SESSION_ID: "s", KEEP: "1" });
  assert.deepEqual(env, { KEEP: "1" });
});

test("profile：没有 profile 的平台原样返回配置，描述用通用格式", async () => {
  const config = { ...DEFAULT_CONFIG, platform: { adapter: "dsh" } };
  assert.equal(await resolveProfiles(config, stubRuntime()), config);
  const profile = { provider: "claude/opus", modeId: "bypassPermissions" };
  assert.equal(describeProfile(config, profile), describeProfileDefault(profile));
  assert.match(describeProfile(DEFAULT_CONFIG, profile), /claude\/opus/);
});
