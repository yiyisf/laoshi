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

  --platform <平台>     装到哪个 agent 平台（第一次安装时要写；之后沿用安装记录，省略时会更新全部已安装平台）
  --home <目录>         安装根，默认 LAOSHI_HOME 或 ~/.laoshi
  --target <目录>       另外把 skill 装到这个目录（可以写多次）
  --force               覆盖同名的、不是 laoshi 装的 skill
  --check               只检查安装，不改动
  --dry-run             演练：显示要做的事，不写文件
  --uninstall           卸载 skill 和平台的设置（安装根保留）
Paseo 的选项：--no-plugin（跳过自动安装/刷新 Paseo 需求插件）
dsh 的选项：--dsh-home <DSH_HOME> --profile <名称> --dsh-bin <dsh 的 bin.js> --approvals ask|allow --no-board --board-port <端口>`);
  process.exit(0);
}
const dry = args["dry-run"] || args.check;
// Without --home or LAOSHI_HOME: the install root this program was installed into with npm
// (<root>/npm/…/node_modules, as engine/src/locations.ts programHome finds it), else ~/.laoshi.
const programRoot = /^(.*)[\\/]npm[\\/](?:lib[\\/])?node_modules[\\/]/.exec(kit)?.[1] ?? null;
const programHome = programRoot && fs.existsSync(path.join(programRoot, "config.json")) ? programRoot : null;
const home = path.resolve(args.home ?? process.env.LAOSHI_HOME ?? programHome ?? path.join(os.homedir(), ".laoshi"));
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
const isObj = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
function normalizedRecordPlatforms(rec) {
  if (isObj(rec?.platforms)) {
    return Object.fromEntries(
      Object.entries(rec.platforms).map(([id, entry]) => [
        id,
        { targets: Array.isArray(entry?.targets) ? entry.targets : [], installedAt: entry?.installedAt },
      ]),
    );
  }
  if (typeof rec?.platform === "string" && rec.platform) {
    return { [rec.platform]: { targets: Array.isArray(rec.targets) ? rec.targets : [], installedAt: rec.installedAt } };
  }
  return {};
}
const recordedPlatforms = normalizedRecordPlatforms(record);
const configuredPlatforms = isObj(existing?.platform)
  ? [
      ...(typeof existing.platform.adapter === "string" && existing.platform.adapter ? [existing.platform.adapter] : []),
      ...Object.entries(existing.platform)
        .filter(([k, v]) => k !== "adapter" && isObj(v))
        .map(([k]) => k),
    ]
  : [];

if (args.uninstall) {
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
  section("卸载");
  const knownPlatforms = [...new Set([...Object.keys(recordedPlatforms), ...configuredPlatforms])];
  const remainingIds = knownPlatforms.filter((id) => id !== platform);
  const sharedTargets = new Set(remainingIds.flatMap((id) => recordedPlatforms[id]?.targets ?? []).map((d) => path.resolve(d)));
  const ownTargets =
    recordedPlatforms[platform]?.targets ??
    mod.skillTargets(args, existing ?? { platform: mod.platformConfig(args) }, process.env, home).map((t) => t.dir);
  for (const dir of ownTargets) {
    if (sharedTargets.has(path.resolve(dir))) {
      report("ok", `保留共用 skill 目录 ${dir}（仍被 ${remainingIds.join("、")} 使用）`);
      continue;
    }
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (ownership(path.join(dir, name)) === "ours") fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    }
    report("ok", `已从 ${dir} 删除 laoshi 安装的 skill`);
  }
  await mod.uninstall?.({ args, config: existing, report, home });
  if (remainingIds.length > 0) {
    const nextRecorded = Object.fromEntries(Object.entries(recordedPlatforms).filter(([id]) => id !== platform));
    const remainingTargets = [...new Set(Object.values(nextRecorded).flatMap((entry) => entry.targets))];
    if (isObj(existing?.platform)) {
      const nextPlatformObj = { ...existing.platform };
      delete nextPlatformObj[platform];
      let nextConfig = { ...existing, platform: nextPlatformObj };
      if (nextPlatformObj.adapter === platform) {
        const nextPrimary = remainingIds[0];
        nextPlatformObj.adapter = nextPrimary;
        if (isObj(nextPlatformObj[nextPrimary]) && "agents" in nextPlatformObj[nextPrimary]) {
          const { agents: promotedAgents, ...rest } = nextPlatformObj[nextPrimary];
          if (isObj(promotedAgents)) nextConfig = { ...nextConfig, agents: promotedAgents };
          nextPlatformObj[nextPrimary] = rest;
        }
      }
      fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
    }
    fs.writeFileSync(
      recordPath,
      `${JSON.stringify({ version, root: kit, platform: remainingIds[0], targets: remainingTargets, platforms: nextRecorded, installedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    report("ok", `已卸载平台 ${platform}，仍保留并存平台：${remainingIds.join("、")}（laoshi、req 命令与配置已保留）`);
  } else {
    for (const f of ["laoshi", "laoshi.cmd", "req", "req.cmd"]) fs.rmSync(path.join(home, "bin", f), { force: true });
    fs.rmSync(recordPath, { force: true });
    report("ok", `保留了安装根 ${home}（配置、使用记录）；不再需要时可以手工删除`);
  }
  process.exit(problems > 0 ? 1 : 0);
}

let targetPlatforms;
if (args.platform) {
  if (!modules[args.platform]) {
    report("fail", `没有平台「${args.platform}」`, `可选：${platforms.join("、")}`);
    process.exit(1);
  }
  targetPlatforms = [args.platform];
} else {
  const primary = existing?.platform?.adapter ?? record?.platform ?? null;
  targetPlatforms = [...new Set([primary, ...Object.keys(recordedPlatforms), ...configuredPlatforms].filter((id) => typeof id === "string" && id && modules[id]))];
  if (targetPlatforms.length === 0) {
    report("fail", "没有指定平台", `加上 --platform ${platforms.join(" 或 --platform ")}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------------------------
section("安装级配置");
let config = existing;
for (const platform of targetPlatforms) {
  const mod = modules[platform];
  if (config) {
    const current = config.platform?.adapter ?? "paseo";
    if (current === platform) {
      report("ok", `已有 ${configPath}（平台 ${platform}），不改动`);
    } else {
      const platformCfg = mod.platformConfig(args);
      const platformSection = isObj(platformCfg?.[platform]) ? platformCfg[platform] : {};
      const existingPlatform = isObj(config.platform) ? config.platform : { adapter: current };
      const prevSection = isObj(existingPlatform[platform]) ? existingPlatform[platform] : null;
      if (prevSection && isObj(prevSection.agents)) {
        report("ok", `已有 ${configPath}（默认 ${current}，并存平台 ${platform}），不改动`);
      } else {
        const nextSection = prevSection
          ? { ...platformSection, ...prevSection, agents: mod.defaultAgents }
          : { ...platformSection, agents: mod.defaultAgents };
        config = { ...config, platform: { ...existingPlatform, adapter: current, [platform]: nextSection } };
        if (!dry) {
          fs.mkdirSync(home, { recursive: true });
          fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
        }
        report(
          "ok",
          prevSection
            ? `${dry ? "将" : "已"}在 ${configPath} 中为并存平台 ${platform} 补齐默认 agents（默认仍为 ${current}）`
            : `${dry ? "将" : "已"}在 ${configPath} 中保留默认平台 ${current}，并添加并存平台 ${platform}`,
        );
      }
    }
  } else {
    config = { platform: mod.platformConfig(args), agents: mod.defaultAgents };
    if (!dry) {
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    }
    report("ok", `${dry ? "将写入" : "写入"} ${configPath}（平台 ${platform}）`);
  }
}

// ---------------------------------------------------------------------------------------------
const writtenSkillDirs = new Map();
const nextPlatforms = { ...recordedPlatforms };
const allNext = [];
for (const platform of targetPlatforms) {
  const mod = modules[platform];
  section(targetPlatforms.length > 1 ? `skill（${platform}）` : "skill");
  const targets = [...mod.skillTargets(args, config, process.env, home), ...args.target.map((t) => ({ dir: path.resolve(t), label: `自定义目录 ${path.resolve(t)}` }))];
  const rendered = fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-skills-"));
  const renderConfig = path.join(rendered, "config.json");
  const renderCfg = { ...config, platform: { ...(isObj(config.platform) ? config.platform : {}), adapter: platform } };
  fs.writeFileSync(renderConfig, JSON.stringify(renderCfg));
  const out = path.join(rendered, "skills");
  const r = spawnSync(process.execPath, [tsxCli, path.join(kit, "engine", "src", "skills-render.ts"), "--out", out, "--config", renderConfig], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, LAOSHI_HOME: home, LAOSHI_PLATFORM: platform },
  });
  if (r.status !== 0) {
    report("fail", `为 ${platform} 渲染 skill 失败：${(r.stderr || r.stdout).trim()}`);
    process.exit(1);
  }
  const skills = fs.readdirSync(out).filter((n) => fs.existsSync(path.join(out, n, "SKILL.md")));
  for (const target of targets) {
    const resolvedDir = path.resolve(target.dir);
    if (writtenSkillDirs.has(resolvedDir)) {
      report("info", `${target.label}：已由平台 ${writtenSkillDirs.get(resolvedDir)} 更新，跳过重复写入`);
      continue;
    }
    writtenSkillDirs.set(resolvedDir, platform);
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
  nextPlatforms[platform] = { targets: targets.map((t) => t.dir), installedAt: new Date().toISOString() };

  section(`平台：${platform}`);
  let next = [];
  try {
    next = (await mod.setup({ kit, args, config, dry, report, home })) ?? [];
  } catch (error) {
    report("fail", error.message);
  }
  for (const line of next) {
    if (!allNext.includes(line)) allNext.push(line);
  }
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
// Where the commands will look without --home: LAOSHI_HOME, else the root this program is installed
// in (its config.json is written above), else ~/.laoshi.
const foundAt = process.env.LAOSHI_HOME ?? (programRoot && path.resolve(programRoot) === home ? programRoot : path.join(os.homedir(), ".laoshi"));
if (path.resolve(foundAt) !== home) {
  report("warn", `安装根不是默认位置，需要设置环境变量 LAOSHI_HOME=${home}（之后新开的终端和平台都要能读到它）`);
}

if (!dry) {
  const allTargets = [...new Set(Object.values(nextPlatforms).flatMap((p) => p.targets))];
  const primaryPlatform = config?.platform?.adapter ?? targetPlatforms[0];
  fs.writeFileSync(
    recordPath,
    `${JSON.stringify({ version, root: kit, platform: primaryPlatform, targets: allTargets, platforms: nextPlatforms, installedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

section("接下来");
for (const [i, line] of [...allNext, `体检：laoshi doctor --no-project`].entries()) console.log(`${i + 1}. ${line}`);
process.exit(problems > 0 ? 1 : 0);
