// `laoshi install` (bin/install.mjs): the install root, skills rendered for the platform into its
// skills directories without overwriting anyone else's, the platform's setup, and uninstall.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const INSTALL = path.join(ROOT, "bin", "install.mjs");
const { name: NAME, version: VERSION } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { name: string; version: string };

function machine() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-install-")));
  const home = path.join(base, "user");
  fs.mkdirSync(home);
  return { base, home };
}

function install(home: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, LAOSHI_PASEO_BIN: "", ...extraEnv };
  delete env.LAOSHI_HOME;
  delete env.REQ_KIT_HOME;
  delete env.DSH_HOME;
  const r = spawnSync(process.execPath, [INSTALL, ...args], { env, encoding: "utf8", timeout: 120_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function fakePaseoWrapper(dir: string, stateFile: string, logFile: string) {
  const fakeScript = path.join(ROOT, "adapters", "paseo", "test", "fake-paseo.mjs");
  const isWin = process.platform === "win32";
  const bin = path.join(dir, isWin ? "fake-paseo.cmd" : "fake-paseo");
  if (isWin) {
    fs.writeFileSync(bin, `@echo off\r\n"${process.execPath}" "${fakeScript}" %*\r\n`);
  } else {
    fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${fakeScript}" "$@"\n`, { mode: 0o755 });
  }
  return {
    LAOSHI_PASEO_BIN: bin,
    FAKE_PASEO_CONFIG: stateFile,
    FAKE_PASEO_LOG: logFile,
  };
}

test("安装到 dsh：安装级配置、按 dsh 渲染的 skill、插件和挂载、命令；重复安装不重复挂载；卸载干净", () => {
  const { base, home } = machine();
  const dshHome = path.join(base, "dsh");
  const profile = path.join(dshHome, "profiles", "web");
  fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(profile, "cordis.patch.yml"), "# patch layer\n[]\n");
  // A dsh whose `plugin add` fails (e.g. no npm registry): the plugin is copied instead.
  const fakeDsh = path.join(base, "fake-dsh.mjs");
  fs.writeFileSync(fakeDsh, "process.exit(1);\n");
  const args = ["--platform", "dsh", "--dsh-home", dshHome, "--dsh-bin", fakeDsh];

  const first = install(home, args);
  assert.equal(first.code, 0, first.out);
  const laoshiHome = path.join(home, ".laoshi");
  const config = JSON.parse(fs.readFileSync(path.join(laoshiHome, "config.json"), "utf8"));
  assert.equal(config.platform.adapter, "dsh");
  assert.equal(config.agents.builder.provider, "dsh/chat-model");
  const skill = fs.readFileSync(path.join(dshHome, "skills", "laoshi", "SKILL.md"), "utf8");
  assert.match(skill, /dsh 提供的 `DSH_SESSION_ID`/);
  assert.doesNotMatch(skill, /\{\{/);
  assert.ok(fs.existsSync(path.join(dshHome, "skills", "laoshi", ".laoshi-install.json")));
  assert.ok(fs.existsSync(path.join(profile, "node_modules", "laoshi-dsh-plugin", "index.mjs")));
  assert.ok(fs.existsSync(path.join(profile, "node_modules", "laoshi-dsh-plugin", "client.js")));
  const patch = fs.readFileSync(path.join(profile, "cordis.patch.yml"), "utf8");
  assert.doesNotMatch(patch, /^\s*\[\]\s*$/m, "dsh 写的 [] 换成了列表写法");
  assert.match(patch, /name: 'laoshi-dsh-plugin'/);
  assert.ok(fs.existsSync(path.join(laoshiHome, "bin", "laoshi")) && fs.existsSync(path.join(laoshiHome, "bin", "laoshi.cmd")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(laoshiHome, "install.json"), "utf8")).platform, "dsh");

  const again = install(home, args);
  assert.equal(again.code, 0, again.out);
  assert.equal(fs.readFileSync(path.join(profile, "cordis.patch.yml"), "utf8").match(/laoshi-dsh-plugin/g)?.length, 1, "不重复挂载");

  // Upgrading from an older cordis.patch.yml missing kitRoot & board fills them in while preserving approvals and sibling plugins.
  fs.writeFileSync(
    path.join(profile, "cordis.patch.yml"),
    "- insert:\n    - id: laoshi-dsh\n      name: 'laoshi-dsh-plugin'\n      config:\n        approvals: allow\n- insert:\n    - id: other\n      name: 'other-plugin'\n",
  );
  const upgraded = install(home, args);
  assert.equal(upgraded.code, 0, upgraded.out);
  const upgradedPatch = fs.readFileSync(path.join(profile, "cordis.patch.yml"), "utf8");
  assert.match(upgradedPatch, /approvals: allow/);
  assert.match(upgradedPatch, /kitRoot: '/);
  assert.match(upgradedPatch, /board: true/);
  assert.match(upgradedPatch, /name: 'other-plugin'/);

  // Upgrading with an existing stale plugin copy + stale kitRoot removes/re-adds, overwrites stale client.js, and refreshes kitRoot.
  const cliLog = path.join(base, "dsh-cli.log");
  const trackingDsh = path.join(base, "tracking-dsh.mjs");
  const installedPlugin = path.join(profile, "node_modules", "laoshi-dsh-plugin");
  fs.writeFileSync(
    trackingDsh,
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      `const logFile = ${JSON.stringify(cliLog)};`,
      `const pluginDir = ${JSON.stringify(installedPlugin)};`,
      'fs.appendFileSync(logFile, process.argv.slice(2).join(" ") + "\\n");',
      'if (process.argv.includes("add")) {',
      '  fs.mkdirSync(pluginDir, { recursive: true });',
      '  fs.writeFileSync(path.join(pluginDir, "package.json"), JSON.stringify({ name: "laoshi-dsh-plugin", version: "0.0.1" }));',
      '  fs.writeFileSync(path.join(pluginDir, "client.js"), "// stale cached plugin");',
      '}',
    ].join("\n"),
  );
  fs.writeFileSync(path.join(installedPlugin, "package.json"), JSON.stringify({ name: "laoshi-dsh-plugin", version: "0.0.1" }));
  fs.writeFileSync(path.join(installedPlugin, "client.js"), "// stale old version");
  fs.writeFileSync(
    path.join(profile, "cordis.patch.yml"),
    "- insert:\n    - id: laoshi-dsh\n      name: 'laoshi-dsh-plugin'\n      config:\n        approvals: allow\n        kitRoot: '/stale/old/kit'\n        board: false\n        boardPort: 19999\n",
  );
  const upgraded2 = install(home, ["--platform", "dsh", "--dsh-home", dshHome, "--dsh-bin", trackingDsh]);
  assert.equal(upgraded2.code, 0, upgraded2.out);
  const calls = fs.readFileSync(cliLog, "utf8").trim().split("\n");
  assert.ok(calls.length >= 2, calls.join(" | "));
  assert.match(calls[0], /remove laoshi-dsh-plugin$/);
  assert.match(calls[1], /add file:/);
  const srcClient = fs.readFileSync(path.join(ROOT, "adapters", "dsh", "plugin", "client.js"), "utf8");
  assert.equal(fs.readFileSync(path.join(installedPlugin, "client.js"), "utf8"), srcClient, "stale plugin files overwritten by fresh source");
  const patch2 = fs.readFileSync(path.join(profile, "cordis.patch.yml"), "utf8");
  assert.doesNotMatch(patch2, /\/stale\/old\/kit/);
  assert.match(patch2, /approvals: allow/);
  assert.match(patch2, /board: false/);
  assert.match(patch2, /boardPort: 19999/);

  const removed = install(home, ["--uninstall", "--dsh-home", dshHome]);
  assert.equal(removed.code, 0, removed.out);
  assert.equal(fs.existsSync(path.join(dshHome, "skills", "laoshi")), false);
  assert.equal(fs.existsSync(path.join(profile, "node_modules", "laoshi-dsh-plugin")), false);
  assert.doesNotMatch(fs.readFileSync(path.join(profile, "cordis.patch.yml"), "utf8"), /laoshi-dsh-plugin/);
  assert.ok(fs.existsSync(path.join(laoshiHome, "config.json")), "安装根保留");
});

test("安装到 Paseo 用的 skill 目录：别人的和 req-kit 装的同名 skill 不覆盖，--force 时覆盖；支持与 dsh 并存并可单独卸载", () => {
  const { base, home } = machine();
  const skills = path.join(home, ".agents", "skills");
  fs.mkdirSync(path.join(skills, "spec-writing"), { recursive: true });
  fs.writeFileSync(path.join(skills, "spec-writing", "SKILL.md"), "someone else's");
  fs.mkdirSync(path.join(skills, "principle-fix-root-cause"), { recursive: true });
  fs.writeFileSync(path.join(skills, "principle-fix-root-cause", ".req-kit-install.json"), "{}");

  const first = install(home, ["--platform", "paseo"]);
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /没有覆盖 .*principle-fix-root-cause（req-kit 安装的）.*spec-writing（不是 laoshi 安装的）|没有覆盖 .*spec-writing（不是 laoshi 安装的）/);
  assert.equal(fs.readFileSync(path.join(skills, "spec-writing", "SKILL.md"), "utf8"), "someone else's");
  assert.match(fs.readFileSync(path.join(skills, "laoshi", "SKILL.md"), "utf8"), /Paseo 提供的 `PASEO_AGENT_ID`/);

  const forced = install(home, ["--platform", "paseo", "--force"]);
  assert.equal(forced.code, 0, forced.out);
  assert.notEqual(fs.readFileSync(path.join(skills, "spec-writing", "SKILL.md"), "utf8"), "someone else's");

  const dshHome = path.join(base, "dsh");
  const dshProfile = path.join(dshHome, "profiles", "web");
  fs.mkdirSync(dshProfile, { recursive: true });
  fs.writeFileSync(path.join(dshProfile, "cordis.patch.yml"), "[]\n");
  const fakeDsh = path.join(base, "fake-dsh.mjs");
  fs.writeFileSync(fakeDsh, "process.exit(1);\n");

  const other = install(home, ["--platform", "dsh", "--dsh-home", dshHome, "--dsh-bin", fakeDsh]);
  assert.equal(other.code, 0, other.out);
  assert.match(other.out, /保留默认平台 paseo，并添加并存平台 dsh/);

  const laoshiHome = path.join(home, ".laoshi");
  const coConfig = JSON.parse(fs.readFileSync(path.join(laoshiHome, "config.json"), "utf8"));
  assert.equal(coConfig.platform.adapter, "paseo");
  assert.equal(coConfig.platform.dsh.agents.builder.provider, "dsh/chat-model");
  assert.match(fs.readFileSync(path.join(skills, "laoshi", "SKILL.md"), "utf8"), /Paseo 提供的 `PASEO_AGENT_ID`/);
  assert.match(fs.readFileSync(path.join(dshHome, "skills", "laoshi", "SKILL.md"), "utf8"), /dsh 提供的 `DSH_SESSION_ID`/);
  const coRecord = JSON.parse(fs.readFileSync(path.join(laoshiHome, "install.json"), "utf8"));
  assert.ok(coRecord.platforms?.paseo && coRecord.platforms?.dsh);

  const uninstallDsh = install(home, ["--platform", "dsh", "--uninstall", "--dsh-home", dshHome, "--dsh-bin", fakeDsh]);
  assert.equal(uninstallDsh.code, 0, uninstallDsh.out);
  assert.equal(fs.existsSync(path.join(dshHome, "skills", "laoshi")), false);
  assert.equal(fs.existsSync(path.join(dshProfile, "node_modules", "laoshi-dsh-plugin")), false);
  assert.ok(fs.existsSync(path.join(skills, "laoshi", "SKILL.md")), "paseo skill kept");
  assert.ok(fs.existsSync(path.join(laoshiHome, "bin", "laoshi")), "shared bin shims kept");
  const afterConfig = JSON.parse(fs.readFileSync(path.join(laoshiHome, "config.json"), "utf8"));
  assert.equal(afterConfig.platform.adapter, "paseo");
  assert.equal(afterConfig.platform.dsh, undefined);
});

test("安装到摸高：安装根在工作区，按摸高渲染的 skill 放在安装根的 skills 目录（专家的 skill 包）", () => {
  const { base, home } = machine();
  const root = path.join(base, "workspace", ".laoshi");
  const r = install(home, ["--platform", "mogao", "--home", root]);
  assert.equal(r.code, 0, r.out);
  const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
  assert.equal(config.platform.adapter, "mogao");
  assert.equal(config.agents.builder.provider, "mogao/chat-model");
  const skill = fs.readFileSync(path.join(root, "skills", "laoshi", "SKILL.md"), "utf8");
  assert.match(skill, /摸高提供的 `AIMAX_SESSION_ID`/);
  assert.doesNotMatch(skill, /\{\{|paseo/i);
  assert.match(r.out, /专家的 skill 目录/);
  // This checkout is not inside the root, so the commands need LAOSHI_HOME to find it.
  assert.match(r.out, /需要设置环境变量 LAOSHI_HOME/);
});

test("安装到摸高：程序装在安装根的 npm 目录里时，命令自己找得到安装根，不提示设置 LAOSHI_HOME", () => {
  const { base, home } = machine();
  const root = path.join(base, "workspace", ".laoshi");
  const kit = path.join(root, "npm", "node_modules", ...NAME.split("/"));
  fs.cpSync(ROOT, kit, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules|evals[\\/]results|site|site-dist|dist-expert)$/.test(src) });
  fs.symlinkSync(path.join(ROOT, "node_modules"), path.join(kit, "node_modules"), "junction");
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.LAOSHI_HOME;
  const r = spawnSync(process.execPath, [path.join(kit, "bin", "install.mjs"), "--platform", "mogao", "--home", root], { env, encoding: "utf8", timeout: 120_000 });
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, out);
  assert.doesNotMatch(out, /LAOSHI_HOME=/);
  assert.ok(fs.existsSync(path.join(root, "config.json")));
});

test("安装到命令行 agent：安装级配置用 claude 和 codex，skill 装到通用目录和 Claude Code 的目录", () => {
  const { base, home } = machine();
  fs.mkdirSync(path.join(home, ".claude"));
  const root = path.join(base, "laoshi-home");
  const r = install(home, ["--platform", "cli", "--home", root]);
  assert.equal(r.code, 0, r.out);
  const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
  assert.equal(config.platform.adapter, "cli");
  assert.equal(config.agents.builder.provider, "claude/default");
  assert.equal(config.agents.reviewer.provider, "codex/default");
  for (const dir of [path.join(home, ".agents", "skills"), path.join(home, ".claude", "skills")]) {
    const skill = fs.readFileSync(path.join(dir, "laoshi", "SKILL.md"), "utf8");
    assert.doesNotMatch(skill, /\{\{|paseo|摸高/i);
  }
});

// A stand-in for npm (LAOSHI_NPM): "installs" this checkout into the prefix and logs each call.
const FAKE_NPM = `
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify({ args, registry: process.env.npm_config_registry ?? null }) + "\\n");
const prefixOf = () => (args.includes("--prefix") ? args[args.indexOf("--prefix") + 1] : process.env.FAKE_NPM_PREFIX);
const root = () => path.join(prefixOf(), process.platform === "win32" ? "node_modules" : path.join("lib", "node_modules"));
const [cmd, sub] = args;
if (cmd === "--version") console.log("10.9.0");
else if (cmd === "config" && sub === "get") console.log("https://registry.npmjs.org/");
else if (cmd === "config") process.exit(0);
else if (cmd === "view") console.log(process.env.FAKE_VERSION);
else if (cmd === "prefix") console.log(process.env.FAKE_NPM_PREFIX);
else if (cmd === "root") console.log(root());
else if (cmd === "install") {
  const kit = process.env.FAKE_KIT;
  const dest = path.join(root(), ...process.env.FAKE_NAME.split("/"));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(kit, dest, { recursive: true, filter: (src) => !/[\\\\/](\\.git|node_modules|evals[\\\\/]results)$/.test(src) });
  fs.symlinkSync(path.join(kit, "node_modules"), path.join(dest, "node_modules"), "junction");
} else process.exit(1);
`;

test("一步安装（npx -y @yiyi_zhang/laoshi@latest install）：从 npm 装好 laoshi，用装好的那份完成安装，npm 源按 --registry", () => {
  const { base, home } = machine();
  const npmScript = path.join(base, "fake-npm.mjs");
  fs.writeFileSync(npmScript, FAKE_NPM);
  const prefix = path.join(base, "npm-global");
  fs.mkdirSync(prefix);
  const log = path.join(base, "npm.log");
  const dshHome = path.join(base, "dsh");
  fs.mkdirSync(path.join(dshHome, "profiles", "web"), { recursive: true });
  const fakeDsh = path.join(base, "fake-dsh.mjs");
  fs.writeFileSync(fakeDsh, "process.exit(1);\n");
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, LAOSHI_NPM: npmScript, FAKE_NPM_LOG: log, FAKE_NPM_PREFIX: prefix, FAKE_KIT: ROOT, FAKE_VERSION: VERSION, FAKE_NAME: NAME };
  delete env.LAOSHI_HOME;
  const r = spawnSync(
    process.execPath,
    [path.join(ROOT, "bin", "bootstrap.mjs"), "--registry", "https://npm.example.internal/", "--no-save-registry", "--platform", "dsh", "--dsh-home", dshHome, "--dsh-bin", fakeDsh],
    { env, encoding: "utf8", timeout: 300_000 },
  );
  const out = `${r.stdout}${r.stderr}`;
  assert.equal(r.status, 0, out);
  const calls = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const installCall = calls.find((c) => c.args[0] === "install");
  assert.deepEqual(installCall.args, ["install", "-g", `${NAME}@${VERSION}`]);
  assert.equal(installCall.registry, "https://npm.example.internal/");
  assert.equal(calls.some((c) => c.args[0] === "config" && c.args[1] === "set"), false, "--no-save-registry 时不改本机的 npm 源");
  const copy = path.join(prefix, process.platform === "win32" ? "node_modules" : path.join("lib", "node_modules"), ...NAME.split("/"));
  const record = JSON.parse(fs.readFileSync(path.join(home, ".laoshi", "install.json"), "utf8"));
  assert.equal(fs.realpathSync(record.root), fs.realpathSync(copy), "安装记录指向 npm 装好的那份，而不是 npx 的临时目录");
  const skill = fs.readFileSync(path.join(dshHome, "skills", "laoshi", "SKILL.md"), "utf8");
  assert.ok(skill.includes(copy.split(path.sep).join("/")), "skill 中的路径指向装好的那份");
});

test("Paseo 默认一步安装并刷新需求插件，传 --no-plugin 时跳过", () => {
  const { home: homeSkip } = machine();
  const skipped = install(homeSkip, ["--platform", "paseo", "--no-plugin"]);
  assert.equal(skipped.code, 0, skipped.out);
  assert.match(skipped.out, /已按 --no-plugin 跳过 Paseo 需求插件/);
  assert.equal(fs.existsSync(path.join(homeSkip, ".laoshi", "paseo-plugin", "paseo-plugin.json")), false);

  const { base, home } = machine();
  const stateFile = path.join(base, "paseo-state.json");
  const logFile = path.join(base, "paseo.log");
  const paseoEnv = fakePaseoWrapper(base, stateFile, logFile);

  const first = install(home, ["--platform", "paseo"], paseoEnv);
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /已安装 Paseo 需求插件/);
  const staged = path.join(home, ".laoshi", "paseo-plugin");
  assert.ok(fs.existsSync(path.join(staged, "paseo-plugin.json")));
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(state.pluginsEnabled, true);
  assert.deepEqual(state.plugins.map((p: { id: string; status: string }) => [p.id, p.status]), [["laoshi", "running"]]);

  const second = install(home, ["--platform", "paseo"], paseoEnv);
  assert.equal(second.code, 0, second.out);
  assert.match(second.out, /Paseo 插件已更新到这个版本/);
  const logs = fs.readFileSync(logFile, "utf8");
  assert.match(logs, /\["plugin","reload","laoshi"\]/);
});

test("多平台并存（paseo + dsh）省略 --platform 时一次刷新全部已安装平台的 skill 与插件", () => {
  const { base, home } = machine();
  const stateFile = path.join(base, "paseo-state.json");
  const logFile = path.join(base, "paseo.log");
  const paseoEnv = fakePaseoWrapper(base, stateFile, logFile);

  const r1 = install(home, ["--platform", "paseo"], paseoEnv);
  assert.equal(r1.code, 0, r1.out);

  const dshHome = path.join(base, "dsh");
  const dshProfile = path.join(dshHome, "profiles", "web");
  fs.mkdirSync(dshProfile, { recursive: true });
  fs.writeFileSync(path.join(dshProfile, "cordis.patch.yml"), "[]\n");
  const fakeDsh = path.join(base, "fake-dsh.mjs");
  fs.writeFileSync(fakeDsh, "process.exit(1);\n");

  const r2 = install(home, ["--platform", "dsh", "--dsh-home", dshHome, "--dsh-bin", fakeDsh], paseoEnv);
  assert.equal(r2.code, 0, r2.out);

  // Simulate stale files from an older release on both platforms, then run install.mjs without --platform.
  const paseoSkill = path.join(home, ".agents", "skills", "laoshi", "SKILL.md");
  const dshSkill = path.join(dshHome, "skills", "laoshi", "SKILL.md");
  const dshClient = path.join(dshProfile, "node_modules", "laoshi-dsh-plugin", "client.js");
  const paseoStagedClient = path.join(home, ".laoshi", "paseo-plugin", "index.client.tsx");
  fs.writeFileSync(paseoSkill, "stale paseo skill");
  fs.writeFileSync(dshSkill, "stale dsh skill");
  fs.writeFileSync(dshClient, "// stale dsh client");
  fs.writeFileSync(paseoStagedClient, "// stale paseo client");

  const refresh = install(home, ["--dsh-bin", fakeDsh], paseoEnv);
  assert.equal(refresh.code, 0, refresh.out);
  assert.match(fs.readFileSync(paseoSkill, "utf8"), /Paseo 提供的 `PASEO_AGENT_ID`/);
  assert.match(fs.readFileSync(dshSkill, "utf8"), /dsh 提供的 `DSH_SESSION_ID`/);
  assert.equal(
    fs.readFileSync(dshClient, "utf8"),
    fs.readFileSync(path.join(ROOT, "adapters", "dsh", "plugin", "client.js"), "utf8"),
  );
  assert.equal(
    fs.readFileSync(paseoStagedClient, "utf8"),
    fs.readFileSync(path.join(ROOT, "adapters", "paseo", "plugin", "index.client.tsx"), "utf8"),
  );
  assert.match(fs.readFileSync(logFile, "utf8"), /\["plugin","reload","laoshi"\]/);

  const laoshiHome = path.join(home, ".laoshi");
  const cfg = JSON.parse(fs.readFileSync(path.join(laoshiHome, "config.json"), "utf8"));
  assert.equal(cfg.platform.adapter, "paseo");
  assert.equal(cfg.platform.dsh.agents.builder.provider, "dsh/chat-model");
  const rec = JSON.parse(fs.readFileSync(path.join(laoshiHome, "install.json"), "utf8"));
  assert.ok(rec.platforms?.paseo && rec.platforms?.dsh);
});

test("laoshi upgrade（bootstrap）检查进行中的需求：有运行中流水线时默认列出并中止，--allow-running 放行", () => {
  const { base, home } = machine();
  const npmScript = path.join(base, "fake-npm.mjs");
  fs.writeFileSync(npmScript, FAKE_NPM);
  const prefix = path.join(base, "npm-global");
  fs.mkdirSync(prefix);
  const log = path.join(base, "npm.log");
  const dshHome = path.join(base, "dsh");
  fs.mkdirSync(path.join(dshHome, "profiles", "web"), { recursive: true });
  const fakeDsh = path.join(base, "fake-dsh.mjs");
  fs.writeFileSync(fakeDsh, "process.exit(1);\n");

  const laoshiHome = path.join(home, ".laoshi");
  const indexDir = path.join(laoshiHome, "index");
  fs.mkdirSync(indexDir, { recursive: true });

  const repoA = path.join(base, "repo-a");
  const featA = "docs/features/20261127-live";
  fs.mkdirSync(path.join(repoA, featA, ".pipeline"), { recursive: true });
  fs.writeFileSync(
    path.join(indexDir, "req-a.json"),
    JSON.stringify({ schema: 1, key: "req-a", repo: repoA, featureDir: featA, sourceRepo: null, workspaceId: null, project: "demo-a", registeredAt: new Date().toISOString() }),
  );
  const statePathA = path.join(repoA, featA, ".pipeline", "state.json");
  fs.writeFileSync(
    statePathA,
    JSON.stringify({
      status: "running",
      pid: process.pid,
      host: os.hostname(),
      phase: "develop",
      history: [{ key: "implement", stepId: "implement", outcome: "running" }],
    }),
  );

  const repoB = path.join(base, "repo-b");
  const featB = "docs/features/20261127-wait";
  fs.mkdirSync(path.join(repoB, featB, ".pipeline"), { recursive: true });
  fs.writeFileSync(
    path.join(indexDir, "req-b.json"),
    JSON.stringify({ schema: 1, key: "req-b", repo: repoB, featureDir: featB, sourceRepo: null, workspaceId: null, project: "demo-b", registeredAt: new Date().toISOString() }),
  );
  fs.writeFileSync(
    path.join(repoB, featB, ".pipeline", "state.json"),
    JSON.stringify({ status: "waiting_for_approval", pid: 999999999, host: os.hostname(), phase: "develop", history: [] }),
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    LAOSHI_PASEO_BIN: "",
    LAOSHI_NPM: npmScript,
    FAKE_NPM_LOG: log,
    FAKE_NPM_PREFIX: prefix,
    FAKE_KIT: ROOT,
    FAKE_VERSION: VERSION,
    FAKE_NAME: NAME,
  };
  delete env.LAOSHI_HOME;
  delete env.REQ_KIT_HOME;

  const blocked = spawnSync(
    process.execPath,
    [path.join(ROOT, "bin", "bootstrap.mjs"), "--platform", "dsh", "--dsh-home", dshHome, "--dsh-bin", fakeDsh],
    { env, encoding: "utf8", timeout: 300_000 },
  );
  const blockedOut = `${blocked.stdout}${blocked.stderr}`;
  assert.notEqual(blocked.status, 0);
  assert.match(blockedOut, /demo-b \/ docs\/features\/20261127-wait（等待确认方案，不受升级影响）/);
  assert.match(blockedOut, /demo-a \/ docs\/features\/20261127-live（步骤：implement，进程/);
  assert.match(blockedOut, /--allow-running/);
  const blockedCalls = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(blockedCalls.some((c) => c.args[0] === "install"), false, "拦截时不应运行 npm install");

  fs.writeFileSync(log, "");
  const forced = spawnSync(
    process.execPath,
    [path.join(ROOT, "bin", "bootstrap.mjs"), "--allow-running", "--platform", "dsh", "--dsh-home", dshHome, "--dsh-bin", fakeDsh],
    { env, encoding: "utf8", timeout: 300_000 },
  );
  const forcedOut = `${forced.stdout}${forced.stderr}`;
  assert.equal(forced.status, 0, forcedOut);
  assert.match(forcedOut, /已按 --allow-running 继续原地升级/);
  const forcedCalls = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(forcedCalls.some((c) => c.args[0] === "install"), true);

  // Dead PID or different host should not block normal upgrade.
  fs.writeFileSync(statePathA, JSON.stringify({ status: "running", pid: 999999999, host: os.hostname(), phase: "develop", history: [] }));
  const deadPid = spawnSync(
    process.execPath,
    [path.join(ROOT, "bin", "bootstrap.mjs"), "--platform", "dsh", "--dsh-home", dshHome, "--dsh-bin", fakeDsh],
    { env, encoding: "utf8", timeout: 300_000 },
  );
  assert.equal(deadPid.status, 0, `${deadPid.stdout}${deadPid.stderr}`);

  fs.writeFileSync(statePathA, JSON.stringify({ status: "running", pid: process.pid, host: "other-host.invalid", phase: "develop", history: [] }));
  const otherHost = spawnSync(
    process.execPath,
    [path.join(ROOT, "bin", "bootstrap.mjs"), "--platform", "dsh", "--dsh-home", dshHome, "--dsh-bin", fakeDsh],
    { env, encoding: "utf8", timeout: 300_000 },
  );
  assert.equal(otherHost.status, 0, `${otherHost.stdout}${otherHost.stderr}`);
});
