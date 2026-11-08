// laoshi M2c (ADR 0007): the install root, two configuration levels, each platform's own settings,
// and the codebase and user every run is recorded for.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { daemonOf } from "../../adapters/paseo/settings.js";
import { dshEnv } from "../../adapters/dsh/dsh-runtime.js";
import { LEGACY_PROJECT_CONFIG_FILE, loadConfig, PROJECT_CONFIG_FILE, projectConfigPath } from "../src/config.js";
import { codebaseOf, userOf, withoutCredentials } from "../src/identity.js";
import { homeOf } from "../src/locations.js";
import { dispatchNotifiers, type NotifierEvent } from "../src/notifiers.js";
import { requirementRef, runRecord } from "../src/records.js";

const agents = {
  builder: { provider: "claude/m", modeId: "bypassPermissions" },
  reviewer: { provider: "codex/m", modeId: "full-access" },
};

const tmp = (prefix: string) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

function machine(extra: object = {}): string {
  const file = path.join(tmp("laoshi-m2c-home-"), "config.json");
  fs.writeFileSync(file, JSON.stringify({ agents, ...extra }));
  return file;
}

function gitRepo(): string {
  const repo = tmp("laoshi-m2c-repo-");
  const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  fs.writeFileSync(path.join(repo, "README.md"), "x\n");
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  return repo;
}

test("安装根：LAOSHI_HOME 优先，其次 REQ_KIT_HOME；都没有时用 ~/.laoshi，只有 req-kit 的旧目录时沿用旧目录", () => {
  const home = tmp("laoshi-m2c-user-");
  assert.deepEqual(homeOf({ LAOSHI_HOME: "/x/laoshi", REQ_KIT_HOME: "/x/req" }, home), { dir: path.resolve("/x/laoshi"), source: "LAOSHI_HOME" });
  assert.deepEqual(homeOf({ REQ_KIT_HOME: "/x/req" }, home), { dir: path.resolve("/x/req"), source: "REQ_KIT_HOME" });
  assert.deepEqual(homeOf({}, home), { dir: path.join(home, ".laoshi"), source: "default" });
  fs.mkdirSync(path.join(home, ".req-kit"));
  fs.writeFileSync(path.join(home, ".req-kit", "config.json"), "{}");
  assert.deepEqual(homeOf({}, home), { dir: path.join(home, ".req-kit"), source: "legacy" });
  fs.mkdirSync(path.join(home, ".laoshi"));
  assert.deepEqual(homeOf({}, home), { dir: path.join(home, ".laoshi"), source: "default" }, "有了 ~/.laoshi 就不再用旧目录");
});

test("代码库级配置：.laoshi.json；只有旧名时读旧名；两者都有时只读新名并提示", () => {
  const repo = tmp("laoshi-m2c-proj-");
  const configPath = machine();
  assert.equal(projectConfigPath(repo), path.join(repo, PROJECT_CONFIG_FILE));
  fs.writeFileSync(path.join(repo, LEGACY_PROJECT_CONFIG_FILE), JSON.stringify({ defaultProfile: "quick" }));
  assert.equal(projectConfigPath(repo), path.join(repo, LEGACY_PROJECT_CONFIG_FILE));
  let loaded = loadConfig(configPath, repo);
  assert.equal(loaded.config.defaultProfile, "quick");
  assert.deepEqual(loaded.notes, []);

  fs.writeFileSync(path.join(repo, PROJECT_CONFIG_FILE), JSON.stringify({ defaultProfile: "standard", user: "someone", platform: { adapter: "dsh" } }));
  loaded = loadConfig(configPath, repo);
  assert.equal(loaded.config.defaultProfile, "standard");
  assert.equal(loaded.sources.at(-1), path.join(repo, PROJECT_CONFIG_FILE));
  assert.match(loaded.notes.join("\n"), /只读取 \.laoshi\.json/);
  assert.equal(loaded.config.platform.adapter, "paseo", "平台只能在安装级配置中设置");
  assert.equal(loaded.config.user, null, "使用者只能在安装级配置中设置");
  assert.ok(loaded.ignored.some((i) => i.includes("platform")) && loaded.ignored.some((i) => i.includes("user")));
});

test("平台自己的设置：platform.<id> 必须是对象；Paseo 的 daemon 地址优先读 platform.paseo，dsh 的目录读 platform.dsh.home", () => {
  assert.throws(() => loadConfig(machine({ platform: { adapter: "dsh", dsh: "D:/dsh" } })), /platform\.dsh 必须是对象/);
  assert.throws(() => loadConfig(machine({ user: "" })), /user 必须是使用者的名字/);
  const loaded = loadConfig(machine({ daemonUrl: "ws://old/ws", platform: { adapter: "paseo", paseo: { daemonUrl: "ws://new/ws" } } }));
  assert.deepEqual(daemonOf(loaded.config), { daemonUrl: "ws://new/ws", daemonPasswordEnv: "PASEO_DAEMON_PASSWORD" });
  assert.equal(daemonOf({ daemonUrl: "ws://old/ws" }).daemonUrl, "ws://old/ws", "req-kit 1.x 的写法继续有效");
  assert.equal(daemonOf(null).daemonUrl, "ws://127.0.0.1:6767/ws");
  assert.equal(dshEnv({ platform: { adapter: "dsh", dsh: { home: "/opt/dsh" } } }, { A: "1" }).DSH_HOME, "/opt/dsh");
  assert.deepEqual(dshEnv({ platform: { adapter: "dsh" } }, { A: "1" }), { A: "1" });
});

test("代码库标识：worktree 归属原仓库；远程地址去掉凭据；不在 git 中时是目录本身", () => {
  const repo = gitRepo();
  execFileSync("git", ["remote", "add", "origin", "https://bot:secret-token@git.example.com/team/shop.git"], { cwd: repo });
  const wt = path.join(tmp("laoshi-m2c-wt-"), "feature");
  execFileSync("git", ["worktree", "add", "-q", "-b", "feature/x", wt], { cwd: repo, stdio: "ignore" });
  assert.deepEqual(codebaseOf(wt), { root: repo, remote: "https://git.example.com/team/shop.git" });
  assert.deepEqual(codebaseOf(path.join(repo)), codebaseOf(wt));
  const plain = tmp("laoshi-m2c-plain-");
  assert.deepEqual(codebaseOf(plain), { root: plain, remote: null });
  assert.equal(withoutCredentials("git@git.example.com:team/shop.git"), "git@git.example.com:team/shop.git");
});

test("使用者：LAOSHI_USER，其次平台提供的使用者，再次安装级配置的 user，最后系统用户名", () => {
  const home = path.dirname(machine({ user: "张三" }));
  assert.equal(userOf({ REQ_KIT_HOME: home, LAOSHI_USER: "李四" }), "李四");
  assert.equal(userOf({ REQ_KIT_HOME: home }), "张三");
  // The platform says who is using the chat (摸高: AIMAX_USER_NAME); LAOSHI_USER still wins.
  assert.equal(userOf({ REQ_KIT_HOME: home, AIMAX_USER_NAME: "孙八" }), "孙八");
  assert.equal(userOf({ REQ_KIT_HOME: home, AIMAX_USER_NAME: "孙八", LAOSHI_USER: "李四" }), "李四");
  assert.equal(userOf({ REQ_KIT_HOME: tmp("laoshi-m2c-empty-") }), os.userInfo().username);
});

test("使用记录和通知带上代码库与使用者（只加字段，schema 仍为 1）", async () => {
  const repo = gitRepo();
  const featureDir = "docs/features/20261102-m2c";
  fs.mkdirSync(path.join(repo, featureDir), { recursive: true });
  fs.writeFileSync(path.join(repo, featureDir, "spec.md"), "# 身份\n");
  const saved = process.env.LAOSHI_USER;
  process.env.LAOSHI_USER = "王五";
  try {
    const state = { repo, featureDir, profile: "quick", attempt: 1, history: [], status: "completed" } as never;
    const record = runRecord({ state, runStartedAt: new Date().toISOString(), title: "身份", agents: { builder: null, reviewer: null } });
    assert.equal(record.schema, 1);
    assert.equal(record.user, "王五");
    assert.deepEqual(record.requirement.codebase, { root: repo, remote: null });
    assert.deepEqual(requirementRef(repo, featureDir).codebase, { root: repo, remote: null });

    const out = path.join(tmp("laoshi-m2c-notify-"), "event.json");
    const module = path.join(path.dirname(out), "notifier.mjs");
    fs.writeFileSync(module, `import fs from "node:fs";\nexport default (event) => fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify(event));\n`);
    const event = { schema: 1, type: "completed", at: "x", kitVersion: "x", feature: { dir: featureDir, name: "m2c", title: "身份" }, repo, branch: null, profile: "quick", originAgentId: null, text: "完成", details: {} } as NotifierEvent;
    await dispatchNotifiers([{ module }], event, () => undefined);
    const sent = JSON.parse(fs.readFileSync(out, "utf8"));
    assert.equal(sent.schema, 1);
    assert.equal(sent.user, "王五");
    assert.deepEqual(sent.codebase, { root: repo, remote: null });
  } finally {
    if (saved === undefined) delete process.env.LAOSHI_USER;
    else process.env.LAOSHI_USER = saved;
  }
});
