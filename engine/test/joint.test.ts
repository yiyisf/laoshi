import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { ConfigError, loadConfig } from "../src/config.js";
import { discoverSiblingRepos, jointProblem } from "../src/joint.js";

test("jointProblem 支持自定义 maxJointRepos 上限并校验边界", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-joint-")));
  const makeGitDir = (name: string) => {
    const dir = path.join(base, name);
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
    return dir;
  };
  const mainRepo = makeGitDir("web");
  makeGitDir("api");
  makeGitDir("worker");
  makeGitDir("shared");

  const related = [
    { name: "接口", path: "../api" },
    { name: "异步任务", path: "../worker" },
    { name: "公共库", path: "../shared" },
  ];

  // Default maxJoint=2 rejects 3 joint repos
  const tooMany = jointProblem(["接口", "异步任务", "公共库"], related, mainRepo);
  assert.ok(tooMany);
  assert.match(tooMany, /最多再涉及 2 个仓库/);
  assert.match(tooMany, /maxJointRepos/);

  // Raising maxJoint to 3 allows all 3
  const allowed = jointProblem(["接口", "异步任务", "公共库"], related, mainRepo, 3);
  // Note: stub .git dir without real git init fails git rev-parse, so verify it passes the count check
  assert.ok(allowed === null || !allowed.includes("最多再涉及"));
});

test("discoverSiblingRepos 发现同级 git 仓库，排除本项目、非 git 目录与已登记项", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-siblings-")));
  const mk = (name: string, withGit: boolean) => {
    const dir = path.join(base, name);
    fs.mkdirSync(dir, { recursive: true });
    if (withGit) fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
    return dir;
  };
  const web = mk("web", true);
  mk("backend", true);
  mk("mobile", true);
  mk("docs-only", false);
  mk(".hidden-repo", true);

  const all = discoverSiblingRepos(web);
  assert.deepEqual(
    all.map((r) => ({ name: r.name, path: r.path })),
    [
      { name: "backend", path: "../backend" },
      { name: "mobile", path: "../mobile" },
    ],
  );

  const filtered = discoverSiblingRepos(web, [{ name: "后端", path: "../backend" }]);
  assert.deepEqual(
    filtered.map((r) => r.name),
    ["mobile"],
  );
});

test("loadConfig 校验 maxJointRepos（默认 2，允许 1–10，非法值报 ConfigError）", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-joint-cfg-")));
  const cfgPath = path.join(base, "config.json");
  const repo = path.join(base, "repo");
  fs.mkdirSync(repo);
  fs.writeFileSync(
    cfgPath,
    JSON.stringify({
      agents: { builder: { provider: "claude/sonnet" }, reviewer: { provider: "codex/o3" } },
    }),
  );

  assert.equal(loadConfig(cfgPath, repo).config.maxJointRepos, 2);

  fs.writeFileSync(path.join(repo, ".laoshi.json"), JSON.stringify({ maxJointRepos: 4 }));
  assert.equal(loadConfig(cfgPath, repo).config.maxJointRepos, 4);

  fs.writeFileSync(path.join(repo, ".laoshi.json"), JSON.stringify({ maxJointRepos: 0 }));
  assert.throws(() => loadConfig(cfgPath, repo), ConfigError);

  fs.writeFileSync(path.join(repo, ".laoshi.json"), JSON.stringify({ maxJointRepos: 12 }));
  assert.throws(() => loadConfig(cfgPath, repo), ConfigError);
});
