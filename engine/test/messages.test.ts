import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalMessage, blockedMessage, failedMessage, permissionMessage, phaseDoneMessage } from "../src/messages.js";
import { NEUTRAL_WORDS } from "../src/words.js";

test("所有停顿通知都包含统一的【停下原因】与【下一步请说】提示", () => {
  const cases = [
    ["方案确认", approvalMessage({ words: NEUTRAL_WORDS, featureDir: "docs/features/demo", previewPath: "preview.md", prototypePath: null, approveCommand: "cmd --approve", resumeCommand: "cmd --resume" })],
    ["业务问题", blockedMessage({ featureDir: "docs/features/demo", questions: ["Q1"], resumeCommand: "cmd --resume" })],
    ["无法复现", blockedMessage({ featureDir: "docs/features/demo", questions: ["复现步骤"], resumeCommand: "cmd --resume", source: "reproduce" })],
    ["等待批准", permissionMessage({ words: NEUTRAL_WORDS, stepTitle: "代码实现", agentTitle: "[demo] 代码实现", requests: ["执行构建"] })],
    ["分阶段待验证", phaseDoneMessage({ words: NEUTRAL_WORDS, featureDir: "docs/features/demo", handoffPath: "handoff.md", verifyCommand: "cmd --phase verify", environment: "local" })],
    ["中断失败", failedMessage({ words: NEUTRAL_WORDS, stepTitle: "代码实现", reason: "token 预算已用完", logPath: "pipeline.log", resumeCommand: "cmd --resume" })],
  ] as const;

  for (const [label, text] of cases) {
    assert.match(text, /【停下原因】.+/, `${label} 缺少【停下原因】`);
    assert.match(text, /【下一步请说】.+/, `${label} 缺少【下一步请说】`);
  }
});
