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

function machine() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-install-")));
  const home = path.join(base, "user");
  fs.mkdirSync(home);
  return { base, home };
}

function install(home: string, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.LAOSHI_HOME;
  delete env.DSH_HOME;
  const r = spawnSync(process.execPath, [INSTALL, ...args], { env, encoding: "utf8", timeout: 120_000 });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
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
  const patch = fs.readFileSync(path.join(profile, "cordis.patch.yml"), "utf8");
  assert.doesNotMatch(patch, /^\s*\[\]\s*$/m, "dsh 写的 [] 换成了列表写法");
  assert.match(patch, /name: 'laoshi-dsh-plugin'/);
  assert.ok(fs.existsSync(path.join(laoshiHome, "bin", "laoshi")) && fs.existsSync(path.join(laoshiHome, "bin", "laoshi.cmd")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(laoshiHome, "install.json"), "utf8")).platform, "dsh");

  const again = install(home, args);
  assert.equal(again.code, 0, again.out);
  assert.equal(fs.readFileSync(path.join(profile, "cordis.patch.yml"), "utf8").match(/laoshi-dsh-plugin/g)?.length, 1, "不重复挂载");

  const removed = install(home, ["--uninstall", "--dsh-home", dshHome]);
  assert.equal(removed.code, 0, removed.out);
  assert.equal(fs.existsSync(path.join(dshHome, "skills", "laoshi")), false);
  assert.equal(fs.existsSync(path.join(profile, "node_modules", "laoshi-dsh-plugin")), false);
  assert.doesNotMatch(fs.readFileSync(path.join(profile, "cordis.patch.yml"), "utf8"), /laoshi-dsh-plugin/);
  assert.ok(fs.existsSync(path.join(laoshiHome, "config.json")), "安装根保留");
});

test("安装到 Paseo 用的 skill 目录：别人的和 req-kit 装的同名 skill 不覆盖，--force 时覆盖；平台不一致时停下", () => {
  const { home } = machine();
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

  const other = install(home, ["--platform", "dsh"]);
  assert.equal(other.code, 1);
  assert.match(other.out, /用的平台是 paseo，这次要装的是 dsh/);
});
