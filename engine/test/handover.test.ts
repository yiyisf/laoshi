import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { handover, ownerPath, readOwner } from "../src/handover.js";
import { writeState, statePath } from "../src/state.js";

test("readOwner 在未转交时返回空记录；handover 首次与二次转交正确记录历史与来源", () => {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-handover-")));
  const featureDir = "docs/features/20261123-demo";
  const featureAbs = path.join(repo, featureDir);
  fs.mkdirSync(path.join(featureAbs, ".pipeline"), { recursive: true });

  const initial = readOwner(featureAbs);
  assert.deepEqual(initial, { owner: null, history: [] });

  writeState(statePath(repo, featureDir), {
    version: 2,
    repo,
    featureDir,
    status: "phase_done",
    attempt: 1,
    specHash: "abc",
    originSessionId: null,
    pid: 0,
    startedBy: "alice",
    startedAt: "2026-11-23T00:00:00.000Z",
    updatedAt: "2026-11-23T00:00:00.000Z",
    results: {},
    history: [],
    stopReason: null,
    outcome: null,
    profile: "standard",
    branch: "feature/20261123-demo",
    milestones: [],
  });

  // First handover uses state.startedBy as default `from`
  const first = handover(featureAbs, { to: "  bob  ", note: "前端收尾" });
  assert.equal(first.owner, "bob");
  assert.equal(first.history.length, 1);
  assert.equal(first.history[0].from, "alice");
  assert.equal(first.history[0].to, "bob");
  assert.equal(first.history[0].note, "前端收尾");
  assert.ok(fs.existsSync(ownerPath(featureAbs)));

  // Second handover uses previous owner ("bob") as `from`
  const second = handover(featureAbs, { to: "carol" });
  assert.equal(second.owner, "carol");
  assert.equal(second.history.length, 2);
  assert.equal(second.history[1].from, "bob");
  assert.equal(second.history[1].to, "carol");
  assert.equal(second.history[1].note, null);

  // Stored file round-trip matches
  assert.deepEqual(readOwner(featureAbs), second);

  // Empty / oversized assignee rejected
  assert.throws(() => handover(featureAbs, { to: "   " }), /不能为空/);
  assert.throws(() => handover(featureAbs, { to: "a".repeat(65) }), /64/);
});
