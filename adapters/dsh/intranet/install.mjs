#!/usr/bin/env node
// laoshi on DeepSeek Harness (dsh), one machine: install-level config, the dsh plugin (installed
// and mounted in a dsh profile), and the skills rendered for dsh. Plain Node.js; on Windows it only
// starts node itself and, to reach an npm-installed `dsh`, cmd.exe — never PowerShell.
//
//   node adapters/dsh/intranet/install.mjs [--home <LAOSHI_HOME>] [--dsh-home <DSH_HOME>] [--profile web]
//        [--dsh-bin <path to dsh's bin.js>] [--approvals ask|allow] [--skills-dir <dir>] [--dry-run]
//
// See docs/intranet/install-verify.md.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { values } = parseArgs({
  options: {
    home: { type: "string" },
    "dsh-home": { type: "string" },
    profile: { type: "string", default: "web" },
    "dsh-bin": { type: "string" },
    approvals: { type: "string", default: "ask" },
    "skills-dir": { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});
const dry = values["dry-run"];
const home = path.resolve(values.home ?? process.env.LAOSHI_HOME ?? path.join(os.homedir(), ".laoshi"));
const dshHome = path.resolve(values["dsh-home"] ?? process.env.DSH_HOME ?? path.join(os.homedir(), ".dsh"));
const profile = values.profile;
const profileDir = path.join(dshHome, "profiles", profile);
const skillsDir = path.resolve(values["skills-dir"] ?? path.join(dshHome, "skills"));
const plugin = path.join(kit, "adapters", "dsh", "plugin");
const slash = (p) => p.split(path.sep).join("/");
let problems = 0;
const ok = (text) => console.log(`✓ ${text}`);
const warn = (text) => console.log(`⚠ ${text}`);
const fail = (text, fix) => {
  problems += 1;
  console.log(`✗ ${text}${fix ? `\n    修复：${fix}` : ""}`);
};
const step = (title) => console.log(`\n## ${title}\n`);

if (!["ask", "allow"].includes(values.approvals)) {
  console.error("--approvals 只能是 ask 或 allow");
  process.exit(2);
}
console.log(`laoshi 安装（dsh）${dry ? "（演练：只显示要做的事，不写文件）" : ""}\n安装目录：${kit}`);

step("环境");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major > 22 || (major === 22 && minor >= 19)) ok(`Node.js ${process.versions.node}`);
else fail(`Node.js ${process.versions.node} 太旧`, "laoshi 需要 Node.js 22.19 或更新");
const git = spawnSync("git", ["--version"], { encoding: "utf8", windowsHide: true });
if (git.status === 0) ok(git.stdout.trim());
else fail("找不到 git", "安装 Git for Windows，并确认 git 在 PATH 中");
const tsx = path.join(kit, "node_modules", "tsx", "dist", "cli.mjs");
if (fs.existsSync(tsx)) ok("依赖已就绪（node_modules）");
else fail("安装目录里没有 node_modules", "用内网安装包（已带依赖），或在安装目录执行 npm ci --omit=dev");
if (!fs.existsSync(dshHome)) warn(`dsh 的目录 ${dshHome} 还不存在：先启动一次 dsh，或用 --dsh-home 指定`);
else ok(`dsh 目录：${dshHome}（profile：${profile}）`);
if (problems > 0) process.exit(1);

step("安装级配置");
const configPath = path.join(home, "config.json");
if (fs.existsSync(configPath)) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    fail(`${configPath} 不是合法的 JSON：${error.message}`, "修正这个文件后再运行");
    process.exit(1);
  }
  const adapter = raw.platform?.adapter ?? "paseo";
  if (adapter !== "dsh") {
    fail(`${configPath} 用的平台是 ${adapter}，不是 dsh`, `把其中的 platform 改成 { "adapter": "dsh" }，或用 --home 换一个安装根`);
    process.exit(1);
  }
  ok(`已有 ${configPath}（平台 dsh），不改动`);
} else {
  const config = {
    platform: { adapter: "dsh", dsh: { home: slash(dshHome) } },
    // dsh runs every step with the chat's model; these only satisfy the configuration's format.
    agents: { builder: { provider: "dsh/chat-model" }, reviewer: { provider: "dsh/chat-model" } },
  };
  if (!dry) {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }
  ok(`写入 ${configPath}`);
}
if (path.resolve(process.env.LAOSHI_HOME ?? "") !== home) {
  warn(`环境变量 LAOSHI_HOME 不是 ${home}。在 cmd 中执行（之后新开的窗口和 dsh 都要能读到它）：setx LAOSHI_HOME "${home}"`);
}

step("dsh 插件");
const installed = path.join(profileDir, "node_modules", "laoshi-dsh-plugin");
let added = false;
if (!dry) {
  const args = ["plugin", "--profile", profile, "add", `file:${slash(plugin)}`];
  const env = { ...process.env, DSH_HOME: dshHome };
  try {
    if (values["dsh-bin"]) execFileSync(process.execPath, [path.resolve(values["dsh-bin"]), ...args], { env, stdio: "pipe", windowsHide: true });
    else if (process.platform === "win32") execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", ["dsh", ...args].join(" ")], { env, stdio: "pipe", windowsHide: true });
    else execFileSync("dsh", args, { env, stdio: "pipe" });
    added = true;
  } catch (error) {
    warn(`dsh plugin add 没有成功（${String(error.stderr ?? error.message).trim().split("\n").at(-1)}），改为直接复制到 profile`);
  }
  if (!added) {
    fs.rmSync(installed, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(installed), { recursive: true });
    fs.cpSync(plugin, installed, { recursive: true });
  }
}
ok(added ? `已用 dsh plugin add 安装到 profile ${profile}` : `插件放到 ${installed}`);

const patchFile = path.join(profileDir, "cordis.patch.yml");
const block = `- insert:\n    - id: laoshi-dsh\n      name: 'laoshi-dsh-plugin'\n      config:\n        approvals: ${values.approvals}\n`;
// dsh writes the file with an empty flow list ("[]"); entries go into a block list instead.
const current = (fs.existsSync(patchFile) ? fs.readFileSync(patchFile, "utf8") : "").replace(/^\s*\[\]\s*$/m, "");
if (current.includes("laoshi-dsh-plugin")) ok(`${patchFile} 中已挂载插件，不改动（审批策略以文件中的为准）`);
else {
  if (!dry) {
    fs.mkdirSync(profileDir, { recursive: true });
    fs.writeFileSync(patchFile, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${block}`);
  }
  ok(`在 ${patchFile} 末尾挂载插件（审批策略 ${values.approvals}）`);
}

step("skill");
if (!dry) {
  const r = spawnSync(process.execPath, [tsx, path.join(kit, "engine", "src", "skills-render.ts"), "--out", skillsDir, "--config", configPath], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, LAOSHI_HOME: home },
  });
  if (r.status !== 0) fail(`渲染 skill 失败：${(r.stderr || r.stdout).trim()}`);
  else ok(`${r.stdout.trim()}（/laoshi、/laoshi-setup、/laoshi-doctor、/laoshi-retro）`);
} else ok(`渲染 skill 到 ${skillsDir}`);

step("接下来");
console.log(
  [
    `1. 重启 dsh（用 profile ${profile}），让插件生效。`,
    `2. 新开一个 cmd 窗口，执行体检：node "${path.join(kit, "bin", "req.mjs")}" doctor --no-project`,
    "   插件一节应为 ✓（已连接 laoshi 的 dsh 插件），能力表中 worktree、服务为\"laoshi 内置\"。",
    "3. 按 docs/intranet/install-verify.md 的验证清单逐项验证。",
  ].join("\n"),
);
process.exit(problems > 0 ? 1 : 0);
