#!/usr/bin/env node
// Checks the npm package as users get it: packs this checkout, installs the .tgz with npm into a
// temporary prefix (dependencies from the npm registry), then from the installed copy:
// skill references resolve, `laoshi install` works for each platform, `laoshi doctor`, `laoshi
// list` and `laoshi docs --help` start. CI runs it on Linux and Windows; the release runs it on the
// package it publishes.
//
//   node scripts/check-package.mjs [--tgz <file>] [--require-docs] [--keep]
//
// --tgz           check this package instead of packing the checkout
// --require-docs  the package must carry the docs site (site-dist/), as a release does
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WINDOWS = process.platform === "win32";
const { values: args } = parseArgs({ options: { tgz: { type: "string" }, "require-docs": { type: "boolean", default: false }, keep: { type: "boolean", default: false } } });

let failures = 0;
const ok = (text) => console.log(`✓ ${text}`);
const fail = (text, detail) => {
  failures += 1;
  console.log(`✗ ${text}${detail ? `\n${detail.trim().split("\n").slice(-20).map((l) => `    ${l}`).join("\n")}` : ""}`);
};

function run(command, argv, options = {}) {
  const shell = WINDOWS && !/\.exe$/i.test(command) && command !== process.execPath;
  const quoted = shell ? argv.map((a) => (/[\s&()^|<>"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)) : argv;
  const r = spawnSync(command, quoted, { encoding: "utf8", windowsHide: true, shell, timeout: 600_000, ...options });
  return { code: r.error ? null : r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? r.error.message : ""}` };
}
const npm = (argv, options) => run(WINDOWS ? "npm.cmd" : "npm", argv, options);
const node = (argv, options) => run(process.execPath, argv, options);

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-package-")));
const home = path.join(work, "home");
const prefix = path.join(work, "prefix");
fs.mkdirSync(home);
fs.mkdirSync(prefix);
const env = { ...process.env, HOME: home, USERPROFILE: home };
for (const key of ["LAOSHI_HOME", "REQ_KIT_HOME", "DSH_HOME", "LAOSHI_DOCS_DIR", "REQ_KIT_DOCS_DIR"]) delete env[key];

try {
  // 1. The package.
  let tgz = args.tgz ? path.resolve(args.tgz) : null;
  if (!tgz) {
    const packed = npm(["pack", "--pack-destination", work, "--json"], { cwd: ROOT });
    if (packed.code !== 0) throw new Error(`npm pack 失败：${packed.out}`);
    tgz = path.join(work, JSON.parse(packed.out.slice(packed.out.indexOf("[")))[0].filename);
  }
  ok(`安装包 ${path.basename(tgz)}（${(fs.statSync(tgz).size / 1024).toFixed(0)} KB）`);

  // 2. Installed as `npm install -g` does it.
  const installed = npm(["install", "-g", "--prefix", prefix, "--no-audit", "--no-fund", tgz], { env });
  if (installed.code !== 0) throw new Error(`npm install 失败：${installed.out}`);
  const copy = path.join(prefix, WINDOWS ? "node_modules" : path.join("lib", "node_modules"), "laoshi");
  const bin = path.join(prefix, WINDOWS ? "laoshi.cmd" : path.join("bin", "laoshi"));
  if (!fs.existsSync(path.join(copy, "package.json"))) throw new Error(`安装后没有 ${copy}`);
  ok(`npm 安装到 ${copy}`);
  fs.existsSync(bin) ? ok(`laoshi 命令：${bin}`) : fail(`npm 没有生成 laoshi 命令（${bin}）`);

  // 3. Files the skills and the docs name are in the package.
  const missing = [];
  const scan = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) scan(full);
      else if (e.name.endsWith(".md")) for (const [, rel] of fs.readFileSync(full, "utf8").matchAll(/\{\{REQ_KIT_ROOT\}\}\/([\w./-]+)/g)) if (!fs.existsSync(path.join(copy, rel))) missing.push(`${path.relative(copy, full)} → ${rel}`);
    }
  };
  for (const dir of ["skills", "engine/skill-fragments", ...fs.readdirSync(path.join(copy, "adapters")).map((a) => `adapters/${a}/skill`)]) if (fs.existsSync(path.join(copy, dir))) scan(path.join(copy, dir));
  missing.length ? fail("skill 引用的文件不在安装包里", missing.join("\n")) : ok("skill 引用的文件都在安装包里");
  const docs = fs.existsSync(path.join(copy, "site-dist", "index.html"));
  if (docs) ok("带有文档站点（site-dist/）");
  else if (args["require-docs"]) fail("安装包里没有文档站点 site-dist/（发布前先构建站点）");
  else console.log("· 安装包里没有文档站点（发布时才构建进去）");

  // 4. The installed copy at work.
  const req = path.join(copy, "bin", "req.mjs");
  const version = node([req, "version"], { env });
  version.code === 0 && version.out.includes(copy) ? ok(version.out.trim()) : fail("laoshi version", version.out);

  const paseo = node([req, "install", "--platform", "paseo"], { env });
  const paseoSkill = path.join(home, ".agents", "skills", "laoshi", "SKILL.md");
  if (paseo.code !== 0 || !fs.existsSync(paseoSkill)) fail("laoshi install --platform paseo", paseo.out);
  else if (!fs.readFileSync(paseoSkill, "utf8").includes(copy.split(path.sep).join("/"))) fail("Paseo 的 skill 没有指向安装的那份程序");
  else ok("laoshi install --platform paseo：skill 已渲染并指向安装的那份程序");
  const check = node([req, "install", "--check"], { env });
  check.code === 0 && !/^[⚠✗]/m.test(check.out) ? ok("laoshi install --check：没有问题") : fail("laoshi install --check", check.out);

  const doctor = node([req, "doctor", "--no-project"], { env, timeout: 120_000 });
  /## 安装[\s\S]*## 配置/.test(doctor.out) && !/安装检查没有完成/.test(doctor.out) ? ok("laoshi doctor 能运行（平台不在时报告的问题不算）") : fail("laoshi doctor", doctor.out);

  const project = path.join(work, "project");
  fs.mkdirSync(project);
  run("git", ["init", "-q"], { cwd: project });
  const list = node([req, "list"], { cwd: project, env });
  list.code === 0 ? ok("laoshi list（引擎经 tsx 启动）") : fail("laoshi list", list.out);
  const docsHelp = node([req, "docs", "--help"], { env });
  docsHelp.code === 0 ? ok("laoshi docs --help") : fail("laoshi docs --help", docsHelp.out);

  const uninstall = node([req, "install", "--uninstall"], { env });
  uninstall.code === 0 && !fs.existsSync(paseoSkill) ? ok("laoshi install --uninstall") : fail("laoshi install --uninstall", uninstall.out);

  // dsh: a dsh whose `plugin add` fails, so the installer copies the plugin itself.
  const dshHome = path.join(work, "dsh");
  fs.mkdirSync(path.join(dshHome, "profiles", "web"), { recursive: true });
  const fakeDsh = path.join(work, "fake-dsh.mjs");
  fs.writeFileSync(fakeDsh, "process.exit(1);\n");
  const dshEnv = { ...env, LAOSHI_HOME: path.join(work, "laoshi-dsh") };
  const dsh = node([req, "install", "--platform", "dsh", "--dsh-home", dshHome, "--dsh-bin", fakeDsh], { env: dshEnv });
  const plugin = path.join(dshHome, "profiles", "web", "node_modules", "laoshi-dsh-plugin", "index.mjs");
  dsh.code === 0 && fs.existsSync(path.join(dshHome, "skills", "laoshi", "SKILL.md")) && fs.existsSync(plugin)
    ? ok("laoshi install --platform dsh：skill 和 dsh 插件已就位")
    : fail("laoshi install --platform dsh", dsh.out);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  if (args.keep) console.log(`保留了 ${work}`);
  else fs.rmSync(work, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} 项没有通过` : "\n安装包检查通过");
process.exit(failures ? 1 : 0);
