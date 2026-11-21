#!/usr/bin/env node
// Updates every version string in the repository in one step:
//   node scripts/set-version.mjs 0.2.0
//   node scripts/set-version.mjs 0.2.1-dev
//
// Files updated:
//   - package.json (version)
//   - package-lock.json (version and packages[""].version)
//   - adapters/dsh/plugin/package.json (version)
//   - adapters/dsh/plugin/index.mjs (const VERSION = "...")
//   - adapters/paseo/plugin/package.json (version)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function updateJsonVersion(file, version, alsoRootPackage = false) {
  const raw = fs.readFileSync(file, "utf8");
  const data = JSON.parse(raw);
  data.version = version;
  if (alsoRootPackage && data.packages && data.packages[""]) {
    data.packages[""].version = version;
  }
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const next = `${JSON.stringify(data, null, 2)}${eol}`;
  fs.writeFileSync(file, next, "utf8");
}

function updateDshPluginIndex(file, version) {
  const raw = fs.readFileSync(file, "utf8");
  const pattern = /^(const VERSION = ")([^"]+)(";)/m;
  if (!pattern.test(raw)) {
    throw new Error(`找不到 VERSION 常量：${file}`);
  }
  fs.writeFileSync(file, raw.replace(pattern, `$1${version}$3`), "utf8");
}

export function setVersion(root, version) {
  if (!SEMVER.test(version)) {
    throw new Error(`版本号格式不对（应为 x.y.z 或 x.y.z-tag）：${version}`);
  }
  const targets = [
    path.join(root, "package.json"),
    path.join(root, "package-lock.json"),
    path.join(root, "adapters", "dsh", "plugin", "package.json"),
    path.join(root, "adapters", "dsh", "plugin", "index.mjs"),
    path.join(root, "adapters", "paseo", "plugin", "package.json"),
  ];
  for (const file of targets) {
    if (!fs.existsSync(file)) throw new Error(`缺少文件：${file}`);
  }
  updateJsonVersion(targets[0], version);
  updateJsonVersion(targets[1], version, true);
  updateJsonVersion(targets[2], version);
  updateDshPluginIndex(targets[3], version);
  updateJsonVersion(targets[4], version);
  return targets.map((f) => path.relative(root, f).split(path.sep).join("/"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.argv[2]?.trim();
  if (!version || version === "-h" || version === "--help") {
    console.log("用法：node scripts/set-version.mjs <版本号>");
    console.log("示例：node scripts/set-version.mjs 0.2.0");
    console.log("      node scripts/set-version.mjs 0.2.1-dev");
    process.exit(version ? 0 : 2);
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const updated = setVersion(root, version);
  console.log(`已将版本号统一更新为 ${version}：`);
  for (const file of updated) console.log(`  - ${file}`);
}
