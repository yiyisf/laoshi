import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { FakeScenario } from "./fake-runtime.js";
import { describeFlow, FlowError, listFlows, loadFlow, parseFlow } from "../src/flows.js";
import { executeFlowCommand } from "../src/flow-cmd.js";
import { executeRunCommand, type RunCliOptions } from "../src/run-cmd.js";
import { readState, statePath } from "../src/state.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const MAIN = path.join(ROOT, "engine", "src", "main.ts");
const FAKE = path.join(ROOT, "engine", "test", "fake-runtime.ts");
const FEATURE = "docs/features/20261012-sms-login";
const ORIGIN = "chat-agent-1";

interface Env {
  repo: string;
  home: string;
  configPath: string;
  eventsPath: string;
  scenarioPath: string;
}

function setup(
  configOverrides: Record<string, unknown> = {},
  specExtra = "",
  specStatus = "已确认（2026-10-12）",
): Env {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-flow-repo-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-flow-home-"));
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo });
  execFileSync("git", ["checkout", "-q", "-b", "feature/20261012-sms-login"], { cwd: repo });
  fs.mkdirSync(path.join(repo, FEATURE), { recursive: true });
  fs.writeFileSync(
    path.join(repo, FEATURE, "spec.md"),
    `# 短信验证码登录\n\n- 状态：${specStatus}\n- 需求提出人：运营部\n${specExtra}\n## 5. 功能需求与验收标准\n\n### FR-1 用短信验证码登录\n- **AC-1.1** 正常登录\n`,
  );
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, "config.example.json"), "utf8"));
  const config = {
    ...base,
    agents: {
      builder: { provider: "claude/test-model", modeId: "bypassPermissions" },
      reviewer: { provider: "codex/test-model", modeId: "full-access" },
    },
    waitChunkSeconds: 0.05,
    permissionPollSeconds: 0.01,
    notifyMilestones: false,
    reviewAxes: { enabled: false, profiles: ["standard"] },
    watchdogMinutes: 0,
    selfHeal: false,
    answerQuestionsFirst: false,
    ...configOverrides,
  };
  const configPath = path.join(home, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config));
  return {
    repo,
    home,
    configPath,
    eventsPath: path.join(home, "events.jsonl"),
    scenarioPath: path.join(home, "scenario.json"),
  };
}

function fakeEnv(env: Env, scenario: FakeScenario = {}): NodeJS.ProcessEnv {
  fs.writeFileSync(env.scenarioPath, JSON.stringify(scenario));
  return {
    ...process.env,
    LAOSHI_HOME: env.home,
    REQ_KIT_HOME: env.home,
    REQ_PIPELINE_FAKE_RUNTIME: FAKE,
    FAKE_SCENARIO: env.scenarioPath,
    FAKE_EVENTS: env.eventsPath,
  };
}

function runMain(env: Env, scenario: FakeScenario = {}, extra: string[] = []) {
  const args = [
    MAIN,
    "--repo",
    env.repo,
    "--feature",
    FEATURE,
    "--config",
    env.configPath,
    "--origin-agent",
    ORIGIN,
    ...extra,
  ];
  const result = spawnSync(process.execPath, [TSX_CLI, ...args], {
    env: fakeEnv(env, scenario),
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

function starts(env: Env): string[] {
  if (!fs.existsSync(env.eventsPath)) return [];
  return fs
    .readFileSync(env.eventsPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; key?: string })
    .filter((e) => e.type === "start")
    .map((e) => e.key as string);
}

async function runCmd(
  env: Env,
  action: RunCliOptions["action"],
  extra: Partial<RunCliOptions> = {},
  scenario: FakeScenario = {},
) {
  const prevEnv = {
    LAOSHI_HOME: process.env.LAOSHI_HOME,
    REQ_KIT_HOME: process.env.REQ_KIT_HOME,
    REQ_PIPELINE_FAKE_RUNTIME: process.env.REQ_PIPELINE_FAKE_RUNTIME,
    FAKE_SCENARIO: process.env.FAKE_SCENARIO,
    FAKE_EVENTS: process.env.FAKE_EVENTS,
  };
  const nextEnv = fakeEnv(env, scenario);
  Object.assign(process.env, nextEnv);
  try {
    const data = await executeRunCommand({
      action,
      repo: env.repo,
      featureDir: FEATURE,
      configPath: env.configPath,
      originAgentId: ORIGIN,
      ...extra,
    });
    const code = data.status === "failed" || data.status === "rejected" ? 1 : 0;
    return { code, data };
  } finally {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const STEP_DEFAULT_RESULTS: Record<string, Record<string, unknown>> = {
  design: { has_runnable_service: false },
  design_review: { verdict: "approved" },
  design_revise: { status: "done" },
  implement: { status: "done" },
  code_review: { verdict: "pass" },
  review_fix: { status: "done" },
  handoff: { status: "done" },
  service_start: { started: true },
  verify: { result: "pass" },
  defect_fix: { status: "done" },
  reverify: { result: "pass" },
  report: { outcome: "completed", summary: "短信登录已经做好，可以验收。" },
  panel_review: { status: "done" },
};

const STEP_ARTIFACTS: Record<string, string> = {
  design: "design.md",
  design_review: "design-review.md",
  design_revise: "design.md",
  implement: "implementation.md",
  code_review: "code-review.md",
  review_fix: "code-review.md",
  handoff: "handoff.md",
  service_start: "service-start.md",
  verify: "verification.md",
  defect_fix: "verification.md",
  reverify: "verification.md",
  report: "report.md",
};

function fulfillStep(
  repo: string,
  req: { key: string; stepId: string; promptFile: string; resultFile: string },
  overrideResult?: Record<string, unknown>,
) {
  const promptAbs = path.join(repo, req.promptFile);
  assert.ok(fs.existsSync(promptAbs), `promptFile 不存在: ${req.promptFile}`);
  const artifact = STEP_ARTIFACTS[req.stepId] ?? `${req.stepId}.md`;
  fs.appendFileSync(path.join(repo, FEATURE, artifact), `\n## ${req.key} 已完成\n`);
  const res = overrideResult ?? STEP_DEFAULT_RESULTS[req.stepId] ?? { status: "done" };
  const resultAbs = path.join(repo, req.resultFile);
  fs.mkdirSync(path.dirname(resultAbs), { recursive: true });
  fs.writeFileSync(resultAbs, JSON.stringify(res));
}

test("自定义流程解析、校验与发现优先级（项目 > 安装根 > 内置模板）", () => {
  const env = setup();
  const prevHome = process.env.LAOSHI_HOME;
  process.env.LAOSHI_HOME = env.home;
  try {
    // 1. 内置模板均可加载并生成描述
    const listed = listFlows(env.repo);
    const names = listed.map((f) => f.name);
    assert.ok(names.includes("standard"));
    assert.ok(names.includes("quick"));
    assert.ok(names.includes("hotfix"));
    assert.ok(names.includes("doc-only"));

    for (const name of ["standard", "quick", "hotfix", "doc-only"]) {
      const flow = loadFlow(name, env.repo);
      assert.ok(flow, `应能加载内置流程 ${name}`);
      assert.ok(describeFlow(flow).length > 0);
    }

    const dummyMeta = { name: "test", source: "test.json", hash: "0000" };
    // 2. 校验错误：未知步骤、重复步骤、缺少 report、引用未出现的步骤
    assert.throws(
      () => parseFlow({ schema: 1, name: "bad", title: "坏流程", flow: [{ step: "unknown_step" }, { step: "report" }] }, dummyMeta),
      FlowError,
    );
    assert.throws(
      () => parseFlow({ schema: 1, name: "dup", title: "重复步骤", flow: [{ step: "design" }, { step: "design" }, { step: "report" }] }, dummyMeta),
      /已经出现过/,
    );
    assert.throws(
      () => parseFlow({ schema: 1, name: "no-report", title: "无报告", flow: [{ step: "design" }] }, dummyMeta),
      /report/,
    );
    assert.throws(
      () =>
        parseFlow(
          {
            schema: 1,
            name: "bad-when",
            title: "条件引用未来步骤",
            flow: [
              { step: "design", when: { result: { step: "implement", field: "status", equals: "done" } } },
              { step: "implement" },
              { step: "report" },
            ],
          },
          dummyMeta,
        ),
      /必须出现在这一项之前/,
    );

    // 3. 发现优先级：安装根覆盖内置，项目覆盖安装根
    const homeFlows = path.join(env.home, "flows");
    fs.mkdirSync(homeFlows, { recursive: true });
    fs.writeFileSync(
      path.join(homeFlows, "hotfix.json"),
      JSON.stringify({
        schema: 1,
        name: "hotfix",
        title: "安装级热修流程",
        flow: [{ step: "implement" }, { step: "report" }],
      }),
    );
    const fromHome = loadFlow("hotfix", env.repo);
    assert.equal(fromHome?.title, "安装级热修流程");

    // 用 flow init 在项目中创建同名流程，应覆盖安装根
    const initCode = executeFlowCommand(["init", "hotfix", "--from", "quick", "--repo", env.repo]);
    assert.equal(initCode, 0);
    const fromProject = loadFlow("hotfix", env.repo);
    assert.match(fromProject?.title ?? "", /hotfix（基于 quick 模板）/);
  } finally {
    if (prevHome === undefined) delete process.env.LAOSHI_HOME;
    else process.env.LAOSHI_HOME = prevHome;
  }
});

test("模式 A（后台引擎）：运行内置自定义流程（hotfix / doc-only）与项目自定义步骤、条件、循环", () => {
  // 1. --flow hotfix：跳过 design_review 与 handoff
  const env1 = setup();
  const r1 = runMain(env1, {}, ["--flow", "hotfix"]);
  assert.equal(r1.code, 0, r1.out);
  assert.deepEqual(starts(env1), ["design", "implement", "code_review-r1", "verify", "report"]);
  const s1 = readState(statePath(env1.repo, FEATURE));
  assert.equal(s1?.flow?.name, "hotfix");
  assert.equal(s1?.status, "completed");

  // 2. spec.md 指定 `- 流程：doc-only`
  const env2 = setup({}, "- 流程：doc-only\n");
  const r2 = runMain(env2, {});
  assert.equal(r2.code, 0, r2.out);
  assert.deepEqual(starts(env2), ["design", "design_review-r1", "report"]);
  assert.equal(readState(statePath(env2.repo, FEATURE))?.flow?.name, "doc-only");

  // 3. 项目自定义流程：含自定义步骤 security_audit + 条件触发 security_fix + 循环
  const env3 = setup();
  const promptsDir = path.join(env3.repo, ".laoshi", "prompts");
  const flowsDir = path.join(env3.repo, ".laoshi", "flows");
  fs.mkdirSync(promptsDir, { recursive: true });
  fs.mkdirSync(flowsDir, { recursive: true });
  fs.writeFileSync(
    path.join(promptsDir, "security-audit.md"),
    "请对 {{FEATURE_DIR}} 执行安全审计，并把结论写入 {{RESULT_FILE}}。\n",
  );
  fs.writeFileSync(
    path.join(flowsDir, "sec-flow.json"),
    JSON.stringify({
      schema: 1,
      name: "sec-flow",
      title: "带安全审计的自定义流程",
      steps: {
        security_audit: {
          title: "5b-安全审计",
          role: "reviewer",
          prompt: "prompts/security-audit.md",
          result: {
            verdict: ["pass", "needs_fix"],
            summary: "string",
          },
        },
        security_fix: {
          title: "5c-安全修复",
          role: "builder",
          prompt: "prompts/security-audit.md",
          result: {
            status: ["done"],
          },
        },
      },
      flow: [
        { step: "design" },
        { step: "implement" },
        { step: "security_audit" },
        {
          step: "security_fix",
          when: { result: { step: "security_audit", field: "verdict", equals: "needs_fix" } },
        },
        {
          loop: {
            check: "code_review",
            fix: "review_fix",
            rounds: 2,
            until: { verdict: ["pass"] },
            order: "check-first",
          },
        },
        { step: "report" },
      ],
    }),
  );

  const r3 = runMain(
    env3,
    {
      steps: {
        security_audit: { result: { verdict: "needs_fix", summary: "发现一处未转义输入" } },
        security_fix: { result: { status: "done" } },
        "code_review-r1": { result: { verdict: "changes_required" } },
        "code_review-r2": { result: { verdict: "pass" } },
      },
    },
    ["--flow", "sec-flow"],
  );
  assert.equal(r3.code, 0, r3.out);
  assert.deepEqual(starts(env3), [
    "design",
    "implement",
    "security_audit",
    "security_fix",
    "code_review-r1",
    "review_fix-r1",
    "code_review-r2",
    "report",
  ]);
});

test("模式 B（会话内编排）：端到端推进、next 幂等、乱序拒绝、结果校验追问与质量门修复", async () => {
  const env = setup({
    checks: [{ name: "check-marker", command: "node -e \"if (require('fs').existsSync('bad.txt')) process.exit(1)\"" }],
  });

  // 1. next 返回第一步 design，重复调用 next 幂等返回同一请求
  const n1 = await runCmd(env, "next");
  assert.equal(n1.code, 0);
  assert.equal(n1.data.status, "step");
  assert.equal(n1.data.steps?.length, 1);
  assert.equal(n1.data.steps?.[0].key, "design");

  const n1Again = await runCmd(env, "next");
  assert.equal(n1Again.code, 0);
  assert.equal(n1Again.data.steps?.[0].key, "design");

  // 2. 乱序 record 被拒绝
  const wrongStep = await runCmd(env, "record", { steps: ["implement"] });
  assert.equal(wrongStep.code, 1);
  assert.equal(wrongStep.data.status, "rejected");

  // 3. 结果文件格式无效时 record 拒绝并生成追问提示词，补写正确结果后推进到 design_review-r1
  const designReq = n1.data.steps![0];
  fs.writeFileSync(path.join(env.repo, designReq.resultFile), JSON.stringify({ has_runnable_service: "not-a-bool" }));
  const badRes = await runCmd(env, "record", { steps: ["design"] });
  assert.equal(badRes.code, 1);
  assert.equal(badRes.data.status, "rejected");
  assert.equal(badRes.data.rejectedStep, "design");
  assert.match(badRes.data.reason ?? "", /has_runnable_service/);

  fulfillStep(env.repo, designReq, { has_runnable_service: false });
  const afterDesign = await runCmd(env, "record", { steps: ["design"] });
  assert.equal(afterDesign.code, 0);
  assert.equal(afterDesign.data.steps?.[0].key, "design_review-r1");

  // 4. 完成 design_review-r1 -> 进入 implement
  fulfillStep(env.repo, afterDesign.data.steps![0]);
  const afterDR = await runCmd(env, "record", { steps: ["design_review-r1"] });
  assert.equal(afterDR.code, 0);
  assert.equal(afterDR.data.steps?.[0].key, "implement");

  // 5. implement 制造质量门失败（创建 bad.txt），record 拦截并要求修复；删除 bad.txt 后再次 record 通过质量门
  const implReq = afterDR.data.steps![0];
  fs.writeFileSync(path.join(env.repo, "bad.txt"), "broken");
  fulfillStep(env.repo, implReq);
  const gateFail = await runCmd(env, "record", { steps: ["implement"] });
  assert.equal(gateFail.code, 1);
  assert.equal(gateFail.data.status, "rejected");
  assert.match(gateFail.data.reason ?? "", /质量门/);

  fs.unlinkSync(path.join(env.repo, "bad.txt"));
  fulfillStep(env.repo, implReq);
  const afterImpl = await runCmd(env, "record", { steps: ["implement"] });
  assert.equal(afterImpl.code, 0);
  assert.equal(afterImpl.data.steps?.[0].key, "code_review-r1");

  // 6. 依次完成剩余步骤 code_review-r1 -> handoff -> verify -> report
  let curr = afterImpl.data;
  const visited = ["design", "design_review-r1", "implement"];
  while (curr.status === "step" && curr.steps && curr.steps.length > 0) {
    const req = curr.steps[0];
    visited.push(req.key);
    fulfillStep(env.repo, req);
    const stepRes = await runCmd(env, "record", { steps: [req.key] });
    assert.equal(stepRes.code, 0);
    curr = stepRes.data;
  }
  assert.equal(curr.status, "done");
  assert.equal(curr.outcome, "completed");
  assert.deepEqual(visited, ["design", "design_review-r1", "implement", "code_review-r1", "handoff", "verify", "report"]);
});

test("模式 B：方案确认点（approve）、分阶段提测（verify）、并行评审小组与模式 B → 模式 A 无缝续跑", async () => {
  const env = setup({
    designApproval: { mode: "always", profiles: ["standard"], autoContinueHours: 0 },
    phases: {
      mode: "gated",
      verify: { environment: "local", agents: {}, defects: "fix", serviceStart: null },
    },
    reviewPanel: {
      enabled: true,
      profiles: ["standard"],
      steps: ["code_review"],
      members: [
        { name: "安全评审", provider: "claude/m1", modeId: "bypassPermissions" },
        { name: "性能评审", provider: "codex/m2", modeId: "full-access" },
      ],
    },
  });

  // 1. design -> design_review-r1 -> 停在 waiting (approval)
  let res = await runCmd(env, "next");
  fulfillStep(env.repo, res.data.steps![0]);
  res = await runCmd(env, "record", { steps: ["design"] });
  fulfillStep(env.repo, res.data.steps![0]);
  res = await runCmd(env, "record", { steps: ["design_review-r1"] });
  assert.equal(res.data.status, "waiting");
  assert.equal(res.data.waitingFor, "approval");

  // 2. approve 后进入 implement
  res = await runCmd(env, "approve");
  assert.equal(res.data.status, "step");
  assert.equal(res.data.steps?.[0].key, "implement");

  // 3. 完成 implement 后，因为开启了 reviewPanel，同时请求 2 个并行子步骤
  fulfillStep(env.repo, res.data.steps![0]);
  res = await runCmd(env, "record", { steps: ["implement"] });
  assert.equal(res.data.status, "step");
  assert.deepEqual(
    res.data.steps?.map((r) => r.key),
    ["code_review-r1-p1", "code_review-r1-p2"],
  );

  // 先完成 p1，p2 仍在等待列表中
  const [p1, p2] = res.data.steps!;
  fs.mkdirSync(path.join(env.repo, FEATURE, "review-panel"), { recursive: true });
  fs.writeFileSync(path.join(env.repo, FEATURE, "review-panel", "code_review-r1-p1.md"), "## p1 意见\n");
  fulfillStep(env.repo, p1);
  res = await runCmd(env, "record", { steps: ["code_review-r1-p1"] });
  assert.deepEqual(
    res.data.steps?.map((r) => r.key),
    ["code_review-r1-p2"],
  );

  // 完成 p2 后自动推进到汇总评审 code_review-r1
  fs.writeFileSync(path.join(env.repo, FEATURE, "review-panel", "code_review-r1-p2.md"), "## p2 意见\n");
  fulfillStep(env.repo, p2);
  res = await runCmd(env, "record", { steps: ["code_review-r1-p2"] });
  assert.equal(res.data.steps?.[0].key, "code_review-r1");

  // 4. 完成 code_review-r1 -> handoff -> 停在分阶段闸口 waiting (phase)
  fulfillStep(env.repo, res.data.steps![0]);
  res = await runCmd(env, "record", { steps: ["code_review-r1"] });
  assert.equal(res.data.steps?.[0].key, "handoff");
  fulfillStep(env.repo, res.data.steps![0]);
  res = await runCmd(env, "record", { steps: ["handoff"] });
  assert.equal(res.data.status, "waiting");
  assert.equal(res.data.waitingFor, "phase");

  // 5. 模式切换验证：从 phase_done 用模式 A（后台引擎 `--phase verify`）直接接手跑完 verify 与 report！
  const modeARes = runMain(env, {}, ["--phase", "verify"]);
  assert.equal(modeARes.code, 0, modeARes.out);
  assert.deepEqual(starts(env), ["verify", "report"]);
  const finalState = readState(statePath(env.repo, FEATURE));
  assert.equal(finalState?.status, "completed");
  assert.equal(finalState?.mode, "engine");
});
