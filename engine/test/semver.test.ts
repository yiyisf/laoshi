import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSemver, satisfies, supportedPlatformRange } from "../src/semver.js";

test("extractSemver 从平台版本输出中提取语义化版本号", () => {
  assert.equal(extractSemver("0.36.0"), "0.36.0");
  assert.equal(extractSemver("aimax v0.36.2-beta.1 (linux)"), "0.36.2-beta.1");
  assert.equal(extractSemver("0.2.2-alpha.2"), "0.2.2-alpha.2");
  assert.equal(extractSemver("unknown"), null);
});

test("package.json 为各主流平台声明了支持的版本范围", () => {
  for (const [id, okVer, badVer] of [
    ["paseo", "0.11.2", "0.12.0"],
    ["dsh", "0.2.2-alpha.2", "0.3.0"],
    ["mogao", "0.36.0", "0.35.9"],
  ] as const) {
    const range = supportedPlatformRange(id);
    assert.ok(range, `package.json 应声明 reqKit.${id}`);
    assert.equal(satisfies(okVer, range), true, `${id} ${okVer} 应满足 ${range}`);
    assert.equal(satisfies(badVer, range), false, `${id} ${badVer} 不应满足 ${range}`);
  }
});
