import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  actionsFor,
  buildInboxCards,
  facts,
  filterRequirements,
  groupOf,
  type RequirementView,
  summarizeBoard,
  trackOf,
  urgencyOf,
} from "../ui/shared/view-model.js";
import { renderBoardHtml } from "../ui/web/board.js";

const NOW = Date.parse("2026-11-21T12:00:00.000Z");

function sampleItems(): RequirementView[] {
  return [
    {
      key: "repo-a::f1",
      repo: "/work/repo-a",
      project: "order-service",
      featureDir: "docs/features/20261119-refund",
      title: "支持部分退款",
      branch: "feature/20261119-refund",
      type: null,
      profile: "standard",
      stage: "等待确认方案",
      status: "waiting_for_approval",
      attention: "approval",
      running: false,
      updatedAt: "2026-11-20T06:00:00.000Z",
      current: [],
      jointCount: 2,
      waiting: { since: "2026-11-20T06:00:00.000Z", questions: [], card: { system: "ALM", id: "REQ-42" } },
    },
    {
      key: "repo-b::f2",
      repo: "/work/repo-b",
      project: "web-portal",
      featureDir: "docs/features/20261121-login",
      title: "修复登录态失效",
      branch: "feature/20261121-login",
      type: "defect",
      profile: "quick",
      stage: "开发中",
      status: "running",
      attention: null,
      running: true,
      updatedAt: "2026-11-21T11:50:00.000Z",
      current: [{ key: "implement" }],
    },
    {
      key: "repo-a::f3",
      repo: "/work/repo-a",
      project: "order-service",
      featureDir: "docs/features/20261121-export",
      title: "导出对账单 <script>alert(1)</script>",
      branch: "feature/20261121-export",
      type: null,
      profile: "standard",
      stage: "待测试验证",
      status: "phase_done",
      attention: null,
      running: false,
      updatedAt: "2026-11-21T10:00:00.000Z",
      current: [],
    },
  ];
}

test("ui/shared/view-model 不依赖 DOM、React Native 或 Node 内置模块", () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, "..", "ui", "shared", "view-model.ts"), "utf8");
  assert.doesNotMatch(src, /from "node:|from "react-native"|from "@getpaseo/);
  assert.doesNotMatch(src, /\b(document|window|localStorage)\./);
});

test("summarizeBoard、buildInboxCards 与 filterRequirements 正确聚合与筛选", () => {
  const items = sampleItems();
  const summary = summarizeBoard(items, NOW);
  assert.equal(summary.total, 3);
  assert.equal(summary.attention, 1);
  assert.equal(summary.running, 1);
  assert.equal(summary.verify, 1);
  assert.equal(summary.urgentCount, 1);
  assert.match(summary.longestWaitText ?? "", /等了 30 小时/);

  const inbox = buildInboxCards(items, NOW);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].urgency, "urgent");
  assert.equal(inbox[0].primaryAction, "approve");
  assert.match(facts(inbox[0].item), /多仓 \+2/);

  assert.equal(urgencyOf("2026-11-21T07:00:00.000Z", NOW), "elevated");
  assert.equal(urgencyOf("2026-11-21T11:30:00.000Z", NOW), "normal");

  assert.equal(filterRequirements(items, { project: "web-portal" }, NOW).length, 1);
  assert.equal(filterRequirements(items, { query: "REQ-42" }, NOW).length, 1);
  assert.equal(filterRequirements(items, { group: "verify" }, NOW).length, 1);

  assert.equal(groupOf(items[1], NOW), "running");
  assert.deepEqual(actionsFor(items[2]), ["verify"]);
  const stops = trackOf(items[1]);
  assert.equal(stops[2].state, "now");
});

test("renderBoardHtml 输出全中文 Bento 看板并安全转义 HTML", () => {
  const html = renderBoardHtml(sampleItems(), { platformName: "dsh", now: NOW });
  assert.match(html, /需要你处理 · 1/);
  assert.match(html, /进行中 · 1/);
  assert.match(html, /待测试验证 · 1/);
  assert.doesNotMatch(html, /NEEDS YOU|IN PROGRESS|READY TO TEST|DONE \(14D\)/, "界面分组与 KPI 文案应统一使用中文");
  assert.match(html, /多仓 \+2/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, "标题中的脚本标签必须被转义");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});
