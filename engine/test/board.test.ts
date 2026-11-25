import assert from "node:assert/strict";
import { test } from "node:test";
import type { RequirementView } from "../../ui/shared/view-model.js";
import { createBoardServer } from "../src/board.js";

const SAMPLE: RequirementView[] = [
  {
    key: "repo::demo",
    repo: "/work/repo",
    project: "demo-app",
    featureDir: "docs/features/20261121-demo",
    title: "支持批量导出",
    branch: "feature/20261121-demo",
    type: null,
    profile: "standard",
    stage: "等待确认方案",
    status: "waiting_for_approval",
    attention: "approval",
    running: false,
    updatedAt: "2026-11-21T08:00:00.000Z",
    current: [],
    waiting: { since: "2026-11-21T08:00:00.000Z", questions: [] },
  },
];

test("createBoardServer 提供看板页面、详情/文件接口与受令牌保护的操作接口", async () => {
  const ran: Array<{ action: string; repo: string; featureDir: string }> = [];
  const { server, csrfToken } = createBoardServer({
    platformName: "dsh",
    handlers: {
      list: () => SAMPLE,
      detail: (repo, feature) => ({ repo, feature, files: ["preview.md", "spec.md"] }),
      file: (_repo, _feature, file) => ({ file, content: `# ${file}\n测试正文` }),
      run: (input) => {
        ran.push({ action: input.action, repo: input.repo, featureDir: input.featureDir });
        return { ok: true, message: `已执行 ${input.action}` };
      },
    },
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const base = `http://127.0.0.1:${addr.port}`;

  try {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /laoshi · 需求看板/);
    assert.match(html, /支持批量导出/);
    assert.match(html, /需要你处理/);

    const listRes = await fetch(`${base}/api/list`);
    assert.equal(listRes.status, 200);
    const listJson = (await listRes.json()) as { items: RequirementView[] };
    assert.equal(listJson.items.length, 1);

    const detailRes = await fetch(`${base}/api/detail?repo=/work/repo&feature=docs/features/20261121-demo`);
    assert.equal(detailRes.status, 200);
    const detailJson = (await detailRes.json()) as { files: string[] };
    assert.deepEqual(detailJson.files, ["preview.md", "spec.md"]);

    // History endpoint not enabled -> 404
    const noHist = await fetch(`${base}/api/history?repo=/work/repo&feature=docs/features/20261121-demo`);
    assert.equal(noHist.status, 404);

    // Empty change text -> 400
    const emptyChange = await fetch(`${base}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Laoshi-Token": csrfToken },
      body: JSON.stringify({ action: "change", repo: "/work/repo", featureDir: "docs/features/20261121-demo", text: "   " }),
    });
    assert.equal(emptyChange.status, 400);

    // Empty handover target -> 400
    const emptyHo = await fetch(`${base}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Laoshi-Token": csrfToken },
      body: JSON.stringify({ action: "handover", repo: "/work/repo", featureDir: "docs/features/20261121-demo", to: "" }),
    });
    assert.equal(emptyHo.status, 400);

    // Valid change & handover actions allowed
    const chAct = await fetch(`${base}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Laoshi-Token": csrfToken },
      body: JSON.stringify({ action: "change", repo: "/work/repo", featureDir: "docs/features/20261121-demo", text: "增加 Excel 导出" }),
    });
    assert.equal(chAct.status, 200);
    assert.equal(((await chAct.json()) as { ok: boolean }).ok, true);

    const hoAct = await fetch(`${base}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Laoshi-Token": csrfToken },
      body: JSON.stringify({ action: "handover", repo: "/work/repo", featureDir: "docs/features/20261121-demo", to: "wangwu", note: "请跟进" }),
    });
    assert.equal(hoAct.status, 200);
    assert.equal(((await hoAct.json()) as { ok: boolean }).ok, true);

    const fileRes = await fetch(`${base}/api/file?repo=/work/repo&feature=docs/features/20261121-demo&file=preview.md`);
    assert.equal(fileRes.status, 200);
    const fileJson = (await fileRes.json()) as { content: string };
    assert.match(fileJson.content, /测试正文/);

    // Missing CSRF token -> 403
    const noToken = await fetch(`${base}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", repo: "/work/repo", featureDir: "docs/features/20261121-demo" }),
    });
    assert.equal(noToken.status, 403);

    // Invalid action -> 400
    const badAct = await fetch(`${base}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Laoshi-Token": csrfToken },
      body: JSON.stringify({ action: "rm-rf", repo: "/work/repo", featureDir: "docs/features/20261121-demo" }),
    });
    assert.equal(badAct.status, 400);

    // Valid action with CSRF token -> 200
    const okAct = await fetch(`${base}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Laoshi-Token": csrfToken },
      body: JSON.stringify({ action: "approve", repo: "/work/repo", featureDir: "docs/features/20261121-demo" }),
    });
    assert.equal(okAct.status, 200);
    const okJson = (await okAct.json()) as { ok: boolean; message: string };
    assert.equal(okJson.ok, true);
    assert.deepEqual(
      ran.map((r) => r.action),
      ["change", "handover", "approve"],
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("createBoardServer 只读模式拒绝全部 POST /api/action", async () => {
  const { server, csrfToken } = createBoardServer({
    readOnly: true,
    handlers: {
      list: () => SAMPLE,
      detail: () => ({}),
      file: () => ({}),
      run: () => ({ ok: true, message: "should not run" }),
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Laoshi-Token": csrfToken },
      body: JSON.stringify({ action: "approve", repo: "/work/repo", featureDir: "docs/features/20261121-demo" }),
    });
    assert.equal(res.status, 403);
    const chRes = await fetch(`http://127.0.0.1:${addr.port}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Laoshi-Token": csrfToken },
      body: JSON.stringify({ action: "change", repo: "/work/repo", featureDir: "docs/features/20261121-demo", text: "改一下" }),
    });
    assert.equal(chRes.status, 403);
    const hoRes = await fetch(`http://127.0.0.1:${addr.port}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Laoshi-Token": csrfToken },
      body: JSON.stringify({ action: "handover", repo: "/work/repo", featureDir: "docs/features/20261121-demo", to: "lisi" }),
    });
    assert.equal(hoRes.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("createBoardServer 验收工作台支持读取清单、一键试用与提交验收结论", async () => {
  const calls: string[] = [];
  const { server, csrfToken } = createBoardServer({
    handlers: {
      list: () => SAMPLE,
      detail: () => ({ files: ["preview.md"] }),
      file: () => ({ content: "ok" }),
      run: () => ({ ok: true, message: "ok" }),
      acceptance: () => ({
        checklist: {
          title: "支持批量导出",
          specVersion: "1",
          reportVerdict: "已完成",
          items: [{ id: "AC-1.1", kind: "criterion", title: "可导出 CSV", details: [], required: true, pipeline: "pass", evidence: "AC-1.1 通过" }],
          notes: ["测试账号：demo"],
        },
        howTo: ["怎么跑起来：", "npm run dev"],
        hasAcceptanceRecord: false,
      }),
      tryRun: async ({ stop }) => {
        calls.push(stop ? "try:stop" : "try:start");
        return { ok: true, message: stop ? "已停止" : "已启动", services: stop ? [] : [{ name: "web", url: "http://127.0.0.1:4100", running: true, output: null }], howTo: [], stopped: stop };
      },
      submitAcceptance: ({ answers, reviewer }) => {
        calls.push(`accept:${reviewer}:${answers.length}`);
        if (answers.length === 0) return { ok: false, missing: ["AC-1.1"], message: "还有 1 条必验项未勾选" };
        return { ok: true, verdict: "通过", committed: true, message: "验收结论「通过」已写入 acceptance.md并提交。" };
      },
    },
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const base = `http://127.0.0.1:${addr.port}`;

  try {
    const acc = await fetch(`${base}/api/acceptance?repo=/work/repo&feature=docs/features/20261121-demo`);
    assert.equal(acc.status, 200);
    const accJson = (await acc.json()) as { checklist: { items: Array<{ id: string }> }; howTo: string[] };
    assert.equal(accJson.checklist.items[0].id, "AC-1.1");
    assert.ok(accJson.howTo.includes("npm run dev"));

    const tryStart = await fetch(`${base}/api/try`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Laoshi-Token": csrfToken },
      body: JSON.stringify({ repo: "/work/repo", featureDir: "docs/features/20261121-demo", stop: false }),
    });
    assert.equal(tryStart.status, 200);
    const tryJson = (await tryStart.json()) as { ok: boolean; services: Array<{ url: string }> };
    assert.equal(tryJson.services[0].url, "http://127.0.0.1:4100");

    const missing = await fetch(`${base}/api/acceptance`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Laoshi-Token": csrfToken },
      body: JSON.stringify({ repo: "/work/repo", featureDir: "docs/features/20261121-demo", reviewer: "测试同事", answers: [] }),
    });
    assert.equal(missing.status, 400);

    const submitted = await fetch(`${base}/api/acceptance`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Laoshi-Token": csrfToken },
      body: JSON.stringify({ repo: "/work/repo", featureDir: "docs/features/20261121-demo", reviewer: "测试同事", answers: [{ id: "AC-1.1", mark: "pass", note: "核对无误" }] }),
    });
    assert.equal(submitted.status, 200);
    const subJson = (await submitted.json()) as { ok: boolean; verdict: string };
    assert.equal(subJson.ok, true);
    assert.equal(subJson.verdict, "通过");
    assert.deepEqual(calls, ["try:start", "accept:测试同事:0", "accept:测试同事:1"]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("createBoardServer /api/history 返回变更记录、commit 与负责人信息", async () => {
  const { server } = createBoardServer({
    handlers: {
      list: () => SAMPLE,
      detail: () => ({ files: [] }),
      file: () => ({ content: "" }),
      run: () => ({ ok: true, message: "ok" }),
      history: () => ({
        specVersion: "2",
        changes: [{ title: "2026-11-23 调整导出", body: "- 支持 Excel" }],
        commits: [{ commit: "abc1234", date: "2026-11-23T10:00:00Z", author: "dev", subject: "v2", diff: "+Excel", truncated: false }],
        owner: { owner: "lisi", history: [] },
      }),
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/history?repo=/work/repo&feature=docs/features/20261121-demo`);
    assert.equal(res.status, 200);
    const json = (await res.json()) as { specVersion: string; changes: Array<{ title: string }>; owner: { owner: string } };
    assert.equal(json.specVersion, "2");
    assert.equal(json.changes[0].title, "2026-11-23 调整导出");
    assert.equal(json.owner.owner, "lisi");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("createBoardServer 支持代理前缀、dsh 内嵌标记、主题参数与执行记录跳转脚本", async () => {
  const vm = await import("node:vm");
  const { server } = createBoardServer({
    platformName: "dsh",
    handlers: {
      list: () => SAMPLE,
      detail: () => ({ files: ["spec.md"], run: { originAgentId: "sess-origin-1" }, steps: [{ key: "spec", stepId: "spec", title: "需求分析", attempt: 1, agentId: "sess-child-1", startedAt: "2026-11-24T01:00:00.000Z", minutes: 1.5, outcome: "completed", result: "通过" }] }),
      file: () => ({ content: "" }),
      run: () => ({ ok: true, message: "ok" }),
    },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}/?theme=light`, {
      headers: { "x-laoshi-prefix": "/laoshi/", "x-laoshi-host": "dsh" },
    });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /data-theme="light"/);
    assert.match(html, /"apiBase":"\/laoshi\/api"/);
    assert.match(html, /"embedHost":"dsh"/);
    assert.match(html, /laoshi:open-session/);
    assert.match(html, /查看执行记录 ↗/);
    assert.match(html, /打开需求对话 ↗/);
    assert.match(html, /laoshi:open-requirement/);

    const m = /<script>([\s\S]*?)<\/script>/.exec(html);
    assert.ok(m, "看板 HTML 包含内联脚本");
    assert.doesNotThrow(() => new vm.Script(m[1]), "内联脚本语法应合法");

    const missingSession = await fetch(`http://127.0.0.1:${addr.port}/api/session-requirement`);
    assert.equal(missingSession.status, 400);

    const originMatch = await fetch(`http://127.0.0.1:${addr.port}/api/session-requirement?sessionId=sess-origin-1`).then((r) => r.json()) as Record<string, unknown>;
    assert.equal(originMatch.matched, true);
    assert.equal(originMatch.key, SAMPLE[0].key);
    assert.equal(originMatch.featureDir, SAMPLE[0].featureDir);

    const stepMatch = await fetch(`http://127.0.0.1:${addr.port}/api/session-requirement?sessionId=sess-child-1`).then((r) => r.json()) as Record<string, unknown>;
    assert.equal(stepMatch.matched, true);
    assert.equal(stepMatch.key, SAMPLE[0].key);

    const unknownMatch = await fetch(`http://127.0.0.1:${addr.port}/api/session-requirement?sessionId=sess-none`).then((r) => r.json()) as Record<string, unknown>;
    assert.equal(unknownMatch.matched, false);

    const bad = await fetch(`http://127.0.0.1:${addr.port}/`, {
      headers: { "x-laoshi-prefix": "//evil.example" },
    });
    const badHtml = await bad.text();
    assert.match(badHtml, /"apiBase":"\/api"/, "非法前缀被忽略");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
