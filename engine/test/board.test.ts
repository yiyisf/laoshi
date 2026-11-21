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
    assert.equal(ran.length, 1);
    assert.equal(ran[0].action, "approve");
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
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
