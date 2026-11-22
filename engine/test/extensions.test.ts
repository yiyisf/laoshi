import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ConfigError, loadConfig } from "../src/config.js";
import {
  buildAiExtensionPrompt,
  mergeExtensions,
  runScriptExtension,
  selectExtensions,
  validateExtensions,
} from "../src/extensions.js";

test("validateExtensions 校验 AI/skill 与脚本扩展步骤，拦截非法配置", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-ext-")));
  const skillDir = path.join(base, "my-skill");
  fs.mkdirSync(skillDir);
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), "# 测试用例 Skill\n按 AC 生成用例。");

  const ok = validateExtensions(
    [
      { id: "gen-cases", title: "生成测试用例", after: "design_review", kind: "ai", skill: "my-skill", role: "reviewer" },
      { id: "archive-dist", title: "产物归档", after: "handoff", kind: "script", command: "echo ok", onFailure: "warn" },
    ],
    base,
  );
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.extensions.length, 2);

  const bad = validateExtensions(
    [
      { id: "BAD ID", title: "", after: "unknown", kind: "ai" },
      { id: "dup", title: "脚本1", after: "verify", kind: "script", command: "" },
      { id: "dup", title: "技能缺失", after: "verify", kind: "ai", skill: "missing-skill" },
    ],
    base,
  );
  assert.ok(bad.errors.length >= 5, bad.errors.join("\n"));
  assert.ok(bad.errors.some((e) => e.includes("重复")));
  assert.ok(bad.errors.some((e) => e.includes("不存在")));
});

test("selectExtensions 与 mergeExtensions 按挂载点、档位、类型筛选并支持项目级覆盖", () => {
  const base = validateExtensions([
    { id: "sec", title: "安全检查", after: "code_review", kind: "script", command: "echo base", profiles: ["standard"] },
    { id: "cases", title: "测试用例", after: "design_review", kind: "ai", prompt: "写用例", types: ["feature"] },
  ]).extensions;
  const project = validateExtensions([
    { id: "sec", title: "项目安全检查", after: "code_review", kind: "script", command: "echo proj", profiles: ["standard"] },
  ]).extensions;

  const merged = mergeExtensions(base, project);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((x) => x.id === "sec")?.title, "项目安全检查");

  assert.equal(selectExtensions(merged, { after: "code_review", profile: "quick", type: "feature" }).length, 0);
  assert.equal(selectExtensions(merged, { after: "code_review", profile: "standard", type: "feature" }).length, 1);
  assert.equal(selectExtensions(merged, { after: "design_review", profile: "standard", type: "defect" }).length, 0);
  assert.equal(selectExtensions(merged, { after: "design_review", profile: "standard", type: "feature" }).length, 1);
});

test("runScriptExtension 执行脚本、注入环境变量并写日志；buildAiExtensionPrompt 读取 skill 正文", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-ext-run-")));
  const featureDir = "docs/features/20261122-demo";
  fs.mkdirSync(path.join(base, featureDir), { recursive: true });
  fs.writeFileSync(path.join(base, "skill.md"), "# 自定义 Skill\n逐条核对接口字段。");

  const res = runScriptExtension(
    { id: "echo-env", title: "打印环境变量", after: "handoff", kind: "script", command: "node -e \"console.log(process.env.LAOSHI_EXTENSION_ID + ':' + process.env.LAOSHI_HOOK)\"" },
    { repo: base, featureDir },
  );
  assert.equal(res.ok, true, res.output);
  assert.match(res.output, /echo-env:handoff/);
  assert.ok(fs.existsSync(res.logFile));
  assert.match(fs.readFileSync(res.logFile, "utf8"), /echo-env:handoff/);

  const fail = runScriptExtension(
    { id: "fail-step", title: "失败脚本", after: "verify", kind: "script", command: "node -e \"process.exit(3)\"" },
    { repo: base, featureDir },
  );
  assert.equal(fail.ok, false);
  assert.equal(fail.exitCode, 3);

  const prompt = buildAiExtensionPrompt(
    { id: "sdd", title: "SDD 核对", after: "design", kind: "ai", skill: "skill.md", prompt: "额外检查错误码" },
    { repo: base, featureDir },
  );
  assert.match(prompt, /逐条核对接口字段/);
  assert.match(prompt, /额外检查错误码/);
  assert.match(prompt, /docs\/features\/20261122-demo/);
});

test("loadConfig 合并安装级与项目级 extensions，并校验非法扩展配置", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-ext-cfg-")));
  const cfgPath = path.join(base, "config.json");
  const repo = path.join(base, "repo");
  fs.mkdirSync(repo);

  const baseConfig = {
    agents: {
      builder: { provider: "claude/sonnet" },
      reviewer: { provider: "codex/o3" },
    },
    extensions: [
      { id: "sdd-check", title: "SDD 核对", after: "design", kind: "ai", prompt: "默认提示" },
    ],
  };
  fs.writeFileSync(cfgPath, JSON.stringify(baseConfig, null, 2));
  fs.writeFileSync(
    path.join(repo, ".laoshi.json"),
    JSON.stringify({
      extensions: [
        { id: "sdd-check", title: "项目 SDD 核对", after: "design", kind: "ai", prompt: "项目提示" },
        { id: "archive", title: "归档产物", after: "handoff", kind: "script", command: "echo done", onFailure: "warn" },
      ],
    }),
  );

  const loaded = loadConfig(cfgPath, repo);
  assert.equal(loaded.config.extensions.length, 2);
  assert.equal(loaded.config.extensions[0].title, "项目 SDD 核对");
  assert.equal(loaded.config.extensions[1].id, "archive");
  assert.equal(loaded.config.extensions[1].onFailure, "warn");

  fs.writeFileSync(
    path.join(repo, ".laoshi.json"),
    JSON.stringify({ extensions: [{ id: "bad", title: "缺命令", after: "handoff", kind: "script" }] }),
  );
  assert.throws(() => loadConfig(cfgPath, repo), ConfigError);
});
