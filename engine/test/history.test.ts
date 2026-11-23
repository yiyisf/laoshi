import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { handover } from "../src/handover.js";
import { apiHistory, parseChanges, parseSpecVersion } from "../src/history.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

test("parseSpecVersion 与 parseChanges 解析版本号与倒序变更段落", () => {
  assert.equal(parseSpecVersion("# Demo\n\n- 状态：已确认\n- 版本：3\n"), "3");
  assert.equal(parseSpecVersion("# Demo\n版本: 2\n"), "2");
  assert.equal(parseSpecVersion("# Demo\n无版本"), null);

  const md = [
    "# 变更记录",
    "",
    "## 2026-11-20 首次对齐",
    "- 来源：访谈",
    "- 内容：初始范围",
    "",
    "## 2026-11-23 补充字段",
    "- 来源：看板发起的需求变更",
    "- 内容：增加导出格式选择",
    "",
  ].join("\n");
  const parsed = parseChanges(md);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].title, "2026-11-23 补充字段");
  assert.match(parsed[0].body, /导出格式选择/);
  assert.equal(parsed[1].title, "2026-11-20 首次对齐");
});

test("apiHistory 返回 git 仓库中 spec.md 的多次提交 diff、变更记录与负责人", () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-history-git-")));
  git(repo, "init", "-q");
  git(repo, "config", "user.name", "Test User");
  git(repo, "config", "user.email", "test@example.com");

  const featureDir = "docs/features/20261123-demo";
  const featureAbs = path.join(repo, featureDir);
  fs.mkdirSync(featureAbs, { recursive: true });

  fs.writeFileSync(path.join(featureAbs, "spec.md"), "# 导出订单\n\n- 状态：已确认\n- 版本：1\n\n## AC\n- AC-1.1 导出 CSV\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "feat: 初始需求说明 v1");

  fs.writeFileSync(path.join(featureAbs, "spec.md"), "# 导出订单\n\n- 状态：已确认\n- 版本：2\n\n## AC\n- AC-1.1 导出 CSV 或 Excel\n");
  fs.writeFileSync(path.join(featureAbs, "changes.md"), "# 变更记录\n\n## 2026-11-23 增加 Excel\n- 调整 AC-1.1\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "docs: 需求变更 v2");

  handover(featureAbs, { to: "lisi", note: "请跟进验证" });

  const hist = apiHistory(repo, featureDir);
  assert.equal(hist.specVersion, "2");
  assert.equal(hist.changes.length, 1);
  assert.equal(hist.changes[0].title, "2026-11-23 增加 Excel");
  assert.equal(hist.commits.length, 2);
  assert.equal(hist.commits[0].subject, "docs: 需求变更 v2");
  assert.match(hist.commits[0].diff, /^\+/m);
  assert.match(hist.commits[0].diff, /^-/m);
  assert.equal(hist.owner.owner, "lisi");
  assert.equal(hist.owner.history[0].note, "请跟进验证");
});

test("apiHistory 在非 git 目录不报错并返回空 commits", () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-history-nogit-")));
  const featureDir = "docs/features/20261123-nogit";
  const featureAbs = path.join(dir, featureDir);
  fs.mkdirSync(featureAbs, { recursive: true });
  fs.writeFileSync(path.join(featureAbs, "spec.md"), "# 本地需求\n\n- 版本：1\n");

  const hist = apiHistory(dir, featureDir);
  assert.equal(hist.specVersion, "1");
  assert.deepEqual(hist.commits, []);
  assert.deepEqual(hist.changes, []);
  assert.equal(hist.owner.owner, null);
});
