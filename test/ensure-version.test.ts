// bin/ensure-version.mjs: a command run with LAOSHI_WANT_VERSION installs that version first when
// the installed one differs (摸高: the expert pins the version), then runs again with it.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");

/** An install root with a tiny "laoshi" in its npm directory and a stand-in npm that installs any version. */
function installRoot(version: string) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-want-")));
  const kit = path.join(root, "npm", "node_modules", "@yiyi_zhang", "laoshi");
  fs.mkdirSync(path.join(kit, "bin"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "bin", "ensure-version.mjs"), path.join(kit, "bin", "ensure-version.mjs"));
  fs.writeFileSync(path.join(kit, "package.json"), JSON.stringify({ name: "@yiyi_zhang/laoshi", version }));
  fs.writeFileSync(
    path.join(kit, "bin", "run.mjs"),
    `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureVersion } from "./ensure-version.mjs";
const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { name, version } = JSON.parse(fs.readFileSync(path.join(kitRoot, "package.json"), "utf8"));
ensureVersion({ kitRoot, version, packageName: name, script: fileURLToPath(import.meta.url), argv: process.argv.slice(2) });
console.log("ran " + version + " " + process.argv.slice(2).join(" "));
`,
  );
  const npm = path.join(root, "fake-npm.mjs");
  fs.writeFileSync(
    npm,
    `import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(path.join(root, "npm.log"))}, args.join(" ") + "\\n");
const spec = args.at(-1);
const version = spec.slice(spec.lastIndexOf("@") + 1);
if (version === "9.9.9") process.exit(1);
fs.writeFileSync(${JSON.stringify(path.join(kit, "package.json"))}, JSON.stringify({ name: "@yiyi_zhang/laoshi", version }));
`,
  );
  const run = (env: Record<string, string>, ...args: string[]) =>
    spawnSync(process.execPath, [path.join(kit, "bin", "run.mjs"), ...args], { encoding: "utf8", env: { ...process.env, LAOSHI_NPM: npm, ...env } });
  return { root, kit, run, npmLog: () => (fs.existsSync(path.join(root, "npm.log")) ? fs.readFileSync(path.join(root, "npm.log"), "utf8") : "") };
}

test("要求的版本和装的不同：先装那个版本，再用它运行同一条命令", () => {
  const r = installRoot("0.2.0-beta.2");
  const out = r.run({ LAOSHI_WANT_VERSION: "0.2.0-beta.3" }, "status", "x");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^ran 0\.2\.0-beta\.3 status x$/m);
  assert.doesNotMatch(out.stdout, /ran 0\.2\.0-beta\.2/);
  const log = r.npmLog();
  assert.ok(log.includes(`install --prefix ${path.join(r.root, "npm")} `), log);
  assert.ok(log.trim().endsWith("@yiyi_zhang/laoshi@0.2.0-beta.3"), log);
});

test("版本相同、没有要求、或装不上时，照常用现在的版本运行", () => {
  const same = installRoot("0.2.0-beta.3");
  assert.match(same.run({ LAOSHI_WANT_VERSION: "0.2.0-beta.3" }).stdout, /ran 0\.2\.0-beta\.3/);
  assert.equal(same.npmLog(), "");
  const none = installRoot("0.2.0-beta.3");
  const env: Record<string, string> = {};
  assert.match(none.run(env).stdout, /ran 0\.2\.0-beta\.3/);
  const fails = installRoot("0.2.0-beta.3");
  const out = fails.run({ LAOSHI_WANT_VERSION: "9.9.9" });
  assert.match(out.stdout, /ran 0\.2\.0-beta\.3/);
  assert.match(out.stderr, /没能安装 9\.9\.9/);
});
