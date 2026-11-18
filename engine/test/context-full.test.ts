// A step whose agent filled its context is redone with a note to read less (pipeline.ts withRetryNote).
import assert from "node:assert/strict";
import { test } from "node:test";
import { isContextFull, isTransientError } from "../src/pipeline.js";

test("上下文占满的报错能认出来（各平台、中英文写法），和临时错误分开", () => {
  for (const m of [
    "This model's maximum context length is 131072 tokens",
    "prompt is too long: 210000 tokens > 200000 maximum",
    "context_length_exceeded",
    "Input exceeds context window",
    "上下文长度超出限制",
    "请求超出上下文",
  ]) {
    assert.ok(isContextFull(m), m);
    assert.ok(!isTransientError(m), `${m} 不是临时错误：等一会儿重试也一样`);
  }
  for (const m of ["boom", "rate limit exceeded", "Run timed out after 600000ms"]) assert.ok(!isContextFull(m), m);
});
