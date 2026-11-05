#!/usr/bin/env node
// Builds the intranet package: laoshi as committed (git HEAD) plus its runtime dependencies for
// Windows x64, so the intranet machine needs neither GitHub nor an npm registry.
//
//   node scripts/pack-intranet.mjs [--out <dir>] [--platform win32] [--arch x64]
//
// Needs git, npm (with access to a registry) and zip on the machine that builds it.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({ options: { out: { type: "string", default: "." }, platform: { type: "string", default: "win32" }, arch: { type: "string", default: "x64" } } });
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const sha = run("git", ["rev-parse", "--short", "HEAD"]);
if (run("git", ["status", "--porcelain"])) console.warn("注意：有未提交的改动，安装包只包含已提交的内容（HEAD）。");
const name = `laoshi-${version}-${sha}-${values.platform}-${values.arch}`;
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-pack-"));
const dir = path.join(stage, name);

console.log(`打包 ${name} ……`);
fs.mkdirSync(dir);
// The committed tree only: no local results, no node_modules of this machine.
execFileSync("sh", ["-c", `git archive --format=tar HEAD | tar -x -C "${dir}"`], { cwd: root, stdio: "inherit" });
// The docs site, when built (the release builds it into site-dist/): `laoshi docs` without the internet.
if (fs.existsSync(path.join(root, "site-dist", "index.html"))) fs.cpSync(path.join(root, "site-dist"), path.join(dir, "site-dist"), { recursive: true });
else console.warn("注意：没有 site-dist/（先构建文档站点），安装包里不带文档站点。");
run("npm", ["ci", "--omit=dev", `--os=${values.platform}`, `--cpu=${values.arch}`, "--ignore-scripts", "--no-audit", "--no-fund"], dir);
const esbuild = path.join(dir, "node_modules", "@esbuild", `${values.platform}-${values.arch}`);
if (!fs.existsSync(esbuild)) throw new Error(`依赖里没有 ${values.platform}-${values.arch} 的 esbuild：tsx 在目标机器上无法运行`);
fs.writeFileSync(
  path.join(dir, "BUILD.txt"),
  [`laoshi ${version}`, `提交：${run("git", ["rev-parse", "HEAD"])}`, `目标：${values.platform}-${values.arch}，Node.js 22.19 或更新`, `打包时间：${new Date().toISOString()}`, "安装与验证：docs/intranet/install-verify.md", ""].join("\r\n"),
);
const out = path.resolve(values.out);
fs.mkdirSync(out, { recursive: true });
const zip = path.join(out, `${name}.zip`);
fs.rmSync(zip, { force: true });
run("zip", ["-qr", zip, name], stage);
fs.rmSync(stage, { recursive: true, force: true });
console.log(`已生成 ${zip}（${(fs.statSync(zip).size / 1024 / 1024).toFixed(1)} MB）`);
