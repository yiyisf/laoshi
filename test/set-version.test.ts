import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setVersion } from "../scripts/set-version.mjs";

test("setVersion 同步更新仓库内全部 5 处版本号，并拒绝非法版本号", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-ver-")));
  fs.mkdirSync(path.join(root, "adapters", "dsh", "plugin"), { recursive: true });
  fs.mkdirSync(path.join(root, "adapters", "paseo", "plugin"), { recursive: true });

  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@yiyi_zhang/laoshi", version: "0.2.0-dev" }, null, 2) + "\n");
  fs.writeFileSync(
    path.join(root, "package-lock.json"),
    JSON.stringify({ name: "@yiyi_zhang/laoshi", version: "0.2.0-dev", packages: { "": { name: "@yiyi_zhang/laoshi", version: "0.2.0-dev" } } }, null, 2) + "\n",
  );
  fs.writeFileSync(path.join(root, "adapters", "dsh", "plugin", "package.json"), JSON.stringify({ name: "laoshi-dsh-plugin", version: "0.2.0-dev" }, null, 2) + "\n");
  fs.writeFileSync(path.join(root, "adapters", "dsh", "plugin", "index.mjs"), 'const VERSION = "0.2.0-dev";\n');
  fs.writeFileSync(path.join(root, "adapters", "paseo", "plugin", "package.json"), JSON.stringify({ name: "laoshi-paseo-plugin", version: "0.2.0-dev" }, null, 2) + "\n");

  const updated = setVersion(root, "0.2.0");
  assert.equal(updated.length, 5);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version, "0.2.0");
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  assert.equal(lock.version, "0.2.0");
  assert.equal(lock.packages[""].version, "0.2.0");
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "adapters", "dsh", "plugin", "package.json"), "utf8")).version, "0.2.0");
  assert.match(fs.readFileSync(path.join(root, "adapters", "dsh", "plugin", "index.mjs"), "utf8"), /const VERSION = "0\.2\.0";/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "adapters", "paseo", "plugin", "package.json"), "utf8")).version, "0.2.0");

  assert.throws(() => setVersion(root, "v0.2.0"), /版本号格式不对/);
});
