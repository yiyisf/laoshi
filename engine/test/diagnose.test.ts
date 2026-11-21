import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../src/config.js";
import { collectDiagnoseBundle, redactText } from "../src/diagnose.js";

test("redactText 脱敏常见凭据、环境变量、Bearer 与私钥", () => {
  const sample = [
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdef123456",
    "MY_API_TOKEN=super-secret-value-123",
    '{"apiKey": "sk-1234567890abcdefghij", "password": "my-password-99"}',
    "ghp_1234567890abcdefghijklmnop",
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
  ].join("\n");
  const clean = redactText(sample);
  assert.doesNotMatch(clean, /eyJhbGciOi/);
  assert.doesNotMatch(clean, /super-secret-value-123/);
  assert.doesNotMatch(clean, /sk-1234567890abcdefghij/);
  assert.doesNotMatch(clean, /my-password-99/);
  assert.doesNotMatch(clean, /ghp_1234567890/);
  assert.doesNotMatch(clean, /MIIEowIBAAKCAQEA/);
  assert.match(clean, /\*\*\*REDACTED\*\*\*/);
});

test("collectDiagnoseBundle 收集状态、日志、结果、步骤输出并脱敏", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-diag-")));
  const repo = path.join(base, "repo");
  const home = path.join(base, "home");
  const featureDir = "docs/features/20261121-demo";
  const pipelineDir = path.join(repo, featureDir, ".pipeline");
  fs.mkdirSync(path.join(pipelineDir, "results"), { recursive: true });

  fs.writeFileSync(
    path.join(pipelineDir, "state.json"),
    JSON.stringify({
      version: 2,
      featureDir,
      status: "failed",
      branch: "feature/20261121-demo",
      profile: "standard",
      startedAt: "2026-11-21T01:00:00.000Z",
      updatedAt: "2026-11-21T01:10:00.000Z",
      history: [
        {
          key: "design",
          stepId: "design",
          round: null,
          attempt: 1,
          agentId: "agent-001",
          startedAt: "2026-11-21T01:00:00.000Z",
          endedAt: "2026-11-21T01:10:00.000Z",
          outcome: "failed",
          followUps: 0,
          result: null,
          error: "HTTP 401 token=SECRET_VALUE_999",
        },
      ],
    }),
  );
  fs.writeFileSync(path.join(pipelineDir, "pipeline.log"), "start\nAuthorization: Bearer topsecretvalue12345\nend\n");
  fs.writeFileSync(path.join(pipelineDir, "results", "design.json"), JSON.stringify({ status: "ok", note: "password=hiddenpass" }));

  const agentDir = path.join(home, "custom-adapter", "agents", "agent-001");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(path.join(agentDir, "agent.json"), JSON.stringify({ id: "agent-001", runs: 1 }));
  fs.writeFileSync(path.join(agentDir, "events.jsonl"), '{"type":"done","token":"tok_secret_12345"}\n');
  fs.writeFileSync(path.join(agentDir, "run-1.out"), "output line\nSERVICE_SECRET=verysecretvalue\n");

  const outDir = path.join(base, "out");
  const config = { ...DEFAULT_CONFIG, platform: { adapter: "custom-adapter" } };
  const res = collectDiagnoseBundle({ repo, featureDir, home, config, outDir, now: new Date("2026-11-21T02:00:00.000Z") });

  assert.equal(res.outDir, outDir);
  assert.equal(res.agentCount, 1);
  assert.ok(res.files.includes("summary.json"));
  assert.ok(res.files.includes("state.json"));
  assert.ok(res.files.includes("pipeline.log"));
  assert.ok(res.files.includes("results/design.json"));
  assert.ok(res.files.includes("agents/agent-001/events.jsonl"));
  assert.ok(res.files.includes("agents/agent-001/run-1.out"));

  for (const rel of res.files) {
    const body = fs.readFileSync(path.join(outDir, rel), "utf8");
    assert.doesNotMatch(body, /SECRET_VALUE_999|topsecretvalue12345|hiddenpass|tok_secret_12345|verysecretvalue/, `${rel} 未脱敏`);
  }
});
