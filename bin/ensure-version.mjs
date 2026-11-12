// A command that must run a given laoshi version (LAOSHI_WANT_VERSION, which platforms such as 摸高
// put in front of every command in the skills they render) installs that version first when the
// installed one is different, then runs again with it. Only for laoshi installed in an install
// root's npm directory (<root>/npm/…/node_modules), as the 摸高 expert installs it: elsewhere upgrades
// go through `laoshi upgrade`.
//
// Without this, the version the expert asks for was only checked by one line the chat agent is told
// to run first; skipping it (or editing an expert by hand and missing a place) kept the old version.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Makes sure the running laoshi is the wanted version; returns only when it is (or nothing is
 * wanted, or it cannot change it), otherwise runs the command again with the new version and exits.
 */
export function ensureVersion({ kitRoot, version, packageName, script, argv, env = process.env }) {
  const want = env.LAOSHI_WANT_VERSION?.trim();
  if (!want || want === version || env.LAOSHI_WANT_VERSION_DONE) return;
  const m = /^(.*)[\\/]npm[\\/](?:lib[\\/])?node_modules[\\/]/.exec(kitRoot);
  if (!m) return;
  const root = m[1];
  console.error(`laoshi ${version} 不是要求的 ${want}：从 npm 安装 ${want}（约一分钟）…`);
  const fake = env.LAOSHI_NPM?.trim();
  const npmArgs = ["install", "--prefix", path.join(root, "npm"), "--no-audit", "--no-fund", `${packageName}@${want}`];
  const npm = fake
    ? spawnSync(process.execPath, [fake, ...npmArgs], { stdio: ["ignore", "inherit", "inherit"], env })
    : spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", npmArgs, { stdio: ["ignore", "inherit", "inherit"], env, shell: process.platform === "win32" });
  const installed = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(kitRoot, "package.json"), "utf8")).version;
    } catch {
      return null;
    }
  })();
  if (npm.status !== 0 || installed !== want) {
    console.error(`没能安装 ${want}（${installed ?? "读不到版本"}），这次仍用 ${version}。请检查 npm 镜像能否取到这个版本。`);
    return;
  }
  // The new version's own setup (skills, platform settings) for the install root.
  const config = path.join(root, "config.json");
  let platform = null;
  try {
    platform = JSON.parse(fs.readFileSync(config, "utf8")).platform?.adapter ?? null;
  } catch {
    // No install-level config: `laoshi install` writes one.
  }
  const installer = path.join(kitRoot, "bin", "install.mjs");
  if (platform && fs.existsSync(installer)) {
    spawnSync(process.execPath, [installer, "--platform", platform, "--home", root], { stdio: ["ignore", "ignore", "inherit"], env });
  }
  console.error(`已换成 ${want}。`);
  const again = spawnSync(process.execPath, [script, ...argv], { stdio: "inherit", env: { ...env, LAOSHI_WANT_VERSION_DONE: "1" }, windowsHide: true });
  process.exit(again.status ?? 1);
}
