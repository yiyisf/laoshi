#!/usr/bin/env node
// `laoshi install`: sets up this machine for the laoshi in this directory (installed with npm,
// or unpacked from an offline package). Plain Node.js; on Windows it starts only node and cmd.exe.
//
//   laoshi install [--platform <id>] [--home <LAOSHI_HOME>] [--target <skills dir>]… [--force]
//                  [--check] [--uninstall] [--dry-run] [platform options, e.g. --dsh-home, --profile]
//
// 1. the install root (LAOSHI_HOME) and its install-level config.json (platform, agents)
// 2. the skills, rendered for the platform (engine/src/skills-render.ts), into the platform's
//    skills directories (adapters/<id>/install.mjs) and any --target; each skill directory gets a
//    .laoshi-install.json marker, and directories without it are left alone unless --force
// 3. the platform's own setup (adapters/<id>/install.mjs), e.g. dsh's plugin
// 4. `laoshi` and `req` commands in <install root>/bin, for installs that npm did not put on PATH
// install.json in the install root records what was installed, for --check and --uninstall.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(fs.readFileSync(path.join(kit, "package.json"), "utf8")).version;
export const MARKER = ".laoshi-install.json";
const REQ_KIT_MARKER = ".req-kit-install.json";

const platforms = fs.readdirSync(path.join(kit, "adapters")).filter((d) => fs.existsSync(path.join(kit, "adapters", d, "install.mjs")));
const modules = Object.fromEntries(await Promise.all(platforms.map(async (p) => [p, await import(pathToFileURL(path.join(kit, "adapters", p, "install.mjs")).href)])));
const platformOptions = Object.assign({}, ...Object.values(modules).map((m) => m.options ?? {}));
const { values: args } = parseArgs({
  options: {
    platform: { type: "string" },
    home: { type: "string" },
    target: { type: "string", multiple: true, default: [] },
    force: { type: "boolean", default: false },
    check: { type: "boolean", default: false },
    uninstall: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
    ...platformOptions,
  },
});
if (args.help) {
  console.log(`用法：laoshi install --platform <${platforms.join("|")}> [选项]

  --platform <平台>     装到哪个 agent 平台（第一次安装时要写；之后沿用安装记录）
  --home <目录>         安装根，默认 LAOSHI_HOME 或 ~/.laoshi
  --target <目录>       另外把 skill 装到这个目录（可以写多次）
  --force               覆盖同名的、不是 laoshi 装的 skill
  --check               只检查安装，不改动
  --dry-run             演练：显示要做的事，不写文件
  --uninstall           卸载 skill 和平台的设置（安装根保留）
dsh 的选项：--dsh-home <DSH_HOME> --profile <名称> --dsh-bin <dsh 的 bin.js> --approvals ask|allow`);
  process.exit(0);
}
const dry = args["dry-run"] || args.check;
const home = path.resolve(args.home ?? process.env.LAOSHI_HOME ?? path.join(os.homedir(), ".laoshi"));
const configPath = path.join(home, "config.json");
const recordPath = path.join(home, "install.json");

let problems = 0;
const SYMBOL = { ok: "✓", warn: "⚠", fail: "✗", info: "·" };
function report(level, text, fix) {
  if (level === "fail") problems += 1;
  console.log(`${SYMBOL[level]} ${text}${fix ? `\n    修复：${fix}` : ""}`);
}
const section = (title) => console.log(`\n## ${title}\n`);
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

/** "ours", "req-kit" (installed by req-kit), "foreign", "symlink" or "absent". */
function ownership(dir) {
  try {
    if (fs.lstatSync(dir).isSymbolicLink()) return "symlink";
  } catch {
    return "absent";
  }
  if (fs.existsSync(path.join(dir, MARKER))) return "ours";
  if (fs.existsSync(path.join(dir, REQ_KIT_MARKER))) return "req-kit";
  return "foreign";
}

/** Every file of the rendered skill is in the installed one with the same content. */
function sameFiles(src, dest) {
  try {
    return listFiles(src).every((f) => fs.readFileSync(path.join(src, f)).equals(fs.readFileSync(path.join(dest, f))));
  } catch {
    return false;
  }
}

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]));
}

console.log(`laoshi ${version} 安装${args.check ? "检查（只报告，不改动）" : args["dry-run"] ? "（演练：不写文件）" : args.uninstall ? "：卸载" : ""}\n程序目录：${kit}\n安装根：${home}`);

// ---------------------------------------------------------------------------------------------
section("环境");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major > 22 || (major === 22 && minor >= 19)) report("ok", `Node.js ${process.versions.node}`);
else report("fail", `Node.js ${process.versions.node} 太旧`, "laoshi 需要 Node.js 22.19 或更新");
const git = spawnSync("git", ["--version"], { encoding: "utf8", windowsHide: true });
if (git.status === 0) report("ok", git.stdout.trim());
else report("fail", "找不到 git", "安装 git（Windows：Git for Windows），并确认 git 在 PATH 中");
const tsx = path.join(kit, "node_modules", "tsx", "dist", "cli.mjs");
const tsxCli = fs.existsSync(tsx) ? tsx : (() => {
  try {
    return path.join(path.dirname(fileURLToPath(import.meta.resolve("tsx/package.json"))), "dist", "cli.mjs");
  } catch {
    return null;
  }
})();
if (tsxCli && fs.existsSync(tsxCli)) report("ok", "依赖已就绪");
else report("fail", "缺少依赖（tsx）", "用 npm 安装 laoshi，或在程序目录执行 npm ci --omit=dev；内网用带依赖的离线安装包");
if (problems > 0) process.exit(1);

const existing = readJson(configPath);
const record = readJson(recordPath);
const platform = args.platform ?? existing?.platform?.adapter ?? record?.platform ?? null;
if (!platform) {
  report("fail", "没有指定平台", `加上 --platform ${platforms.join(" 或 --platform ")}`);
  process.exit(1);
}
const mod = modules[platform];
if (!mod) {
  report("fail", `没有平台「${platform}」`, `可选：${platforms.join("、")}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
if (args.uninstall) {
  section("卸载");
  for (const dir of record?.targets ?? []) {
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (ownership(path.join(dir, name)) === "ours") fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    }
    report("ok", `已从 ${dir} 删除 laoshi 安装的 skill`);
  }
  mod.uninstall?.({ args, config: existing, report });
  for (const f of ["laoshi", "laoshi.cmd", "req", "req.cmd"]) fs.rmSync(path.join(home, "bin", f), { force: true });
  fs.rmSync(recordPath, { force: true });
  report("ok", `保留了安装根 ${home}（配置、使用记录）；不再需要时可以手工删除`);
  process.exit(problems > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------
section("安装级配置");
if (existing) {
  const current = existing.platform?.adapter ?? "paseo";
  if (current !== platform) {
    report("fail", `${configPath} 用的平台是 ${current}，这次要装的是 ${platform}`, `把其中的 platform 改成 { "adapter": "${platform}" }，或用 --home 换一个安装根`);
    process.exit(1);
  }
  report("ok", `已有 ${configPath}（平台 ${platform}），不改动`);
} else {
  const config = { platform: mod.platformConfig(args), agents: mod.defaultAgents };
  if (!dry) {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  }
  report("ok", `${dry ? "将写入" : "写入"} ${configPath}（平台 ${platform}）`);
}
const config = existing ?? { platform: mod.platformConfig(args) };

// ---------------------------------------------------------------------------------------------
section("skill");
const targets = [...mod.skillTargets(args, config, process.env, home), ...args.target.map((t) => ({ dir: path.resolve(t), label: `自定义目录 ${path.resolve(t)}` }))];
const rendered = fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-skills-"));
const renderConfig = path.join(rendered, "config.json");
fs.writeFileSync(renderConfig, JSON.stringify(config));
const out = path.join(rendered, "skills");
const r = spawnSync(process.execPath, [tsxCli, path.join(kit, "engine", "src", "skills-render.ts"), "--out", out, "--config", renderConfig], { encoding: "utf8", windowsHide: true, env: { ...process.env, LAOSHI_HOME: home } });
if (r.status !== 0) {
  report("fail", `为 ${platform} 渲染 skill 失败：${(r.stderr || r.stdout).trim()}`);
  process.exit(1);
}
const skills = fs.readdirSync(out).filter((n) => fs.existsSync(path.join(out, n, "SKILL.md")));
for (const target of targets) {
  const blocked = [];
  let changed = 0;
  for (const name of skills) {
    const dir = path.join(target.dir, name);
    const owner = ownership(dir);
    if (owner === "symlink" || ((owner === "foreign" || owner === "req-kit") && !args.force)) {
      blocked.push(`${name}（${owner === "req-kit" ? "req-kit 安装的" : owner === "symlink" ? "符号链接" : "不是 laoshi 安装的"}）`);
      continue;
    }
    if (dry) {
      if (!sameFiles(path.join(out, name), dir)) changed += 1;
      continue;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.cpSync(path.join(out, name), dir, { recursive: true });
    const files = Object.fromEntries(listFiles(dir).map((f) => [f.split(path.sep).join("/"), crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex")]));
    fs.writeFileSync(path.join(dir, MARKER), `${JSON.stringify({ name: "laoshi", skill: name, version, root: kit, platform, installedAt: new Date().toISOString(), files }, null, 2)}\n`);
    changed += 1;
  }
  // Skills an earlier laoshi installed that this one no longer has.
  const stale = fs.existsSync(target.dir) ? fs.readdirSync(target.dir).filter((n) => !skills.includes(n) && ownership(path.join(target.dir, n)) === "ours") : [];
  if (!dry) for (const n of stale) fs.rmSync(path.join(target.dir, n), { recursive: true, force: true });
  const done = dry ? (changed ? `将安装或更新 ${changed} 个 skill` : `${skills.length - blocked.length} 个 skill 已是这个版本的`) : `已安装 ${changed} 个 skill`;
  report(blocked.length || (args.check && changed) ? "warn" : "ok", `${target.label}：${done}${stale.length ? `，删除旧版本留下的 ${stale.join("、")}` : ""}${blocked.length ? `；没有覆盖 ${blocked.join("、")}` : ""}`, blocked.length ? "确认可以覆盖时加 --force" : undefined);
}
fs.rmSync(rendered, { recursive: true, force: true });

// ---------------------------------------------------------------------------------------------
section(`平台：${platform}`);
let next = [];
try {
  next = mod.setup({ kit, args, config, dry, report }) ?? [];
} catch (error) {
  report("fail", error.message);
}

// ---------------------------------------------------------------------------------------------
section("命令");
const bin = path.join(home, "bin");
if (!dry) {
  fs.mkdirSync(bin, { recursive: true });
  const entry = path.join(kit, "bin", "req.mjs");
  for (const name of ["laoshi", "req"]) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nexec node "${entry}" "$@"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, `${name}.cmd`), `@echo off\r\nnode "${entry}" %*\r\n`);
  }
}
const onPath = (process.env.PATH ?? "").split(path.delimiter).some((p) => p && path.resolve(p) === bin);
report("ok", `laoshi、req 命令在 ${bin}${onPath ? "" : `（不在 PATH 中：用 npm 全局安装时可以忽略；否则把它加进 PATH${process.platform === "win32" ? `，例如在 cmd 中执行 setx PATH "%PATH%;${bin}"` : ""}）`}`);
if (path.resolve(process.env.LAOSHI_HOME ?? path.join(os.homedir(), ".laoshi")) !== home) {
  report("warn", `安装根不是默认位置，需要设置环境变量 LAOSHI_HOME=${home}（之后新开的终端和平台都要能读到它）`);
}

if (!dry) {
  fs.writeFileSync(recordPath, `${JSON.stringify({ version, root: kit, platform, targets: targets.map((t) => t.dir), installedAt: new Date().toISOString() }, null, 2)}\n`);
}

section("接下来");
for (const [i, line] of [...next, `体检：laoshi doctor --no-project`].entries()) console.log(`${i + 1}. ${line}`);
process.exit(problems > 0 ? 1 : 0);
