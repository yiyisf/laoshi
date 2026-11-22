import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetWarnLine, typicalLine, type Typical } from "../src/estimate.js";

test("typicalLine 与 budgetWarnLine 按历史中位数与预算阈值生成开工前提示", () => {
  const sample: Typical = {
    profile: "standard",
    basis: 5,
    agentMinutes: 75,
    tokens: 900_000,
  };
  const line = typicalLine(sample);
  assert.ok(line);
  assert.match(line, /最近 5 个标准档需求/);
  assert.match(line, /1 小时 15 分/);
  assert.match(line, /90 万 tokens/);

  // Budget null or plenty of headroom -> no warning
  assert.equal(budgetWarnLine(sample, { tokens: null, warnPercent: 80 }), null);
  assert.equal(budgetWarnLine(sample, { tokens: 2_000_000, warnPercent: 80 }), null);

  // Median 900k >= 80% of 1M -> emits warning
  const warn = budgetWarnLine(sample, { tokens: 1_000_000, warnPercent: 80 });
  assert.ok(warn);
  assert.match(warn, /预算提醒/);
  assert.match(warn, /90%/);

  // Missing token history -> no warning
  assert.equal(budgetWarnLine({ ...sample, tokens: null }, { tokens: 1_000_000, warnPercent: 80 }), null);
});
