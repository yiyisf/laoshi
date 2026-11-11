#!/usr/bin/env node
// A stand-in for 摸高's `aimax` command line in tests, following the formats recorded in the sandbox
// probes (docs/discovery/mogao/report.md): `run` prints one JSON object (sessionId, text, usage;
// paused for an approval; error on failure or timeout) and POSTs progress events to --callback-url;
// `resume` answers an approval. What a run does is read from the message:
//   WRITE:<file>:<text>   write a file in the project directory (as a tool call)
//   SLEEP:<ms>            take this long (honours --timeout)
//   PAUSE                 stop for an approval the first time; after "approve" write approved.txt
//   FAIL                  end with an error
// A laoshi step prompt (a <pipeline-context> block; or "请先完整阅读文件 <prompt.md>" naming one) is
// done the way the engine's fake runtime does it: the step's artifact and a valid result file.
// $FAKE_AIMAX_PAUSE_STEP names a step (e.g. implement) that first stops for an approval.
// $FAKE_AIMAX_LINGER_MS / $FAKE_AIMAX_HOLD_OUTPUT: see finish().
// Calls are logged to $FAKE_AIMAX_DIR/calls.jsonl; sessions kept in $FAKE_AIMAX_DIR/sessions.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.env.FAKE_AIMAX_DIR;
const argv = process.argv.slice(2);
fs.mkdirSync(path.join(root, "sessions"), { recursive: true });
fs.appendFileSync(path.join(root, "calls.jsonl"), `${JSON.stringify({ argv, cwd: process.cwd() })}\n`);

const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const sessionFile = (id) => path.join(root, "sessions", `${id}.json`);
const load = (id) => JSON.parse(fs.readFileSync(sessionFile(id), "utf8"));
const save = (s) => fs.writeFileSync(sessionFile(s.id), JSON.stringify(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(event) {
  const url = opt("--callback-url");
  if (!url) return;
  try {
    await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(event) });
  } catch {
    // Fire and forget, as the platform does.
  }
}

// $FAKE_AIMAX_LINGER_MS: like the real one in the sandbox, the process stays this long after the
// agent is done; with $FAKE_AIMAX_HOLD_OUTPUT its result is printed only when it finally exits.
function finish(result, code = 0) {
  const linger = Number(process.env.FAKE_AIMAX_LINGER_MS ?? 0);
  const hold = Boolean(process.env.FAKE_AIMAX_HOLD_OUTPUT);
  if (!hold || !linger) process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!linger) process.exit(code);
  setTimeout(() => {
    if (hold) process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exit(code);
  }, linger);
  // Keeps running: nothing after finish() must run.
  return new Promise(() => {});
}

const usage = { input: 1000, output: 200, total: 1200 };

// Same defaults as the engine's fake runtime: every step passes on the first try.
const RESULTS = {
  design: { has_runnable_service: false, files: ["src/"], ui_change: false },
  design_review: { verdict: "approved" },
  implement: { status: "done" },
  code_review: { verdict: "pass" },
  review_fix: { status: "done" },
  handoff: { status: "done" },
  service_start: { started: true },
  verify: { result: "pass" },
  defect_fix: { status: "done" },
  reverify: { result: "pass" },
  report: { outcome: "completed", summary: "端到端检查：流水线在摸高适配器上跑完。" },
};

/** The step a laoshi prompt asks for: its key, result file and feature directory. */
function laoshiStep(message) {
  const file = /请先完整阅读文件 (\S+?prompt\.md)/.exec(message)?.[1];
  const prompt = file ? fs.readFileSync(file, "utf8") : message;
  const block = prompt.slice(prompt.lastIndexOf("<pipeline-context>"));
  if (block.length === prompt.length && !prompt.includes("<pipeline-context>")) return null;
  const field = (label) => new RegExp(`^${label}：(.+)$`, "m").exec(block)?.[1].trim();
  const resultAbs = field("结果文件绝对路径");
  const featureDir = field("功能目录");
  if (!resultAbs || !featureDir) return null;
  const key = path.basename(resultAbs).replace(/\.json$/, "");
  const stepId = key.replace(/@.*$/, "").replace(/-r\d+$/, "").replace(/-s\d+$/, "");
  return { key, stepId, resultAbs, featureDir };
}

async function doStep(session, step) {
  await tool(session, `write ${step.key} result`, () => {
    const dir = path.join(session.cwd, step.featureDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "progress.md"), `- ${step.key}：完成（模拟 aimax）\n`);
    fs.mkdirSync(path.dirname(step.resultAbs), { recursive: true });
    fs.writeFileSync(step.resultAbs, `${JSON.stringify(RESULTS[step.stepId] ?? { status: "done" })}\n`);
  });
}

async function tool(session, command, effect) {
  const toolCallId = `t${crypto.randomBytes(3).toString("hex")}`;
  // The platform's CallbackEventPayload: flat, discriminated by type; tool calls come inside "progress".
  await post({ type: "progress", sessionId: session.id, event: { type: "tool_start", toolCallId, name: "exec", input: { command, riskLevel: "low", isReadOnly: false } } });
  effect();
  await post({ type: "progress", sessionId: session.id, event: { type: "tool_end", toolCallId, output: "ok token=SECRET123456", details: { exitCode: 0, cwd: session.cwd, sessionId: session.id } } });
}

const [command] = argv;
if (command === "--version") {
  console.log("0.36.0");
  process.exit(0);
}

if (command === "run") {
  const existing = opt("-s");
  const session = existing ? load(existing) : { id: `sess-${crypto.randomBytes(4).toString("hex")}`, cwd: path.resolve(opt("--project-dir")), messages: [], approved: false, pending: null };
  const message = opt("--message") ?? "";
  session.messages.push(message);
  save(session);
  await post({ type: "start", sessionId: session.id, message });
  const timeout = Number(opt("--timeout") ?? 0);
  const wait = Number(/SLEEP:(\d+)/.exec(message)?.[1] ?? 0);
  if (wait) {
    if (timeout && wait > timeout) {
      await sleep(timeout);
      await finish({ sessionId: session.id, error: `Run timed out after ${timeout}ms`, usage }, 1);
    }
    await sleep(wait);
  }
  for (const [, file, text] of message.matchAll(/WRITE:([^:\s]+):(\S+)/g)) {
    await tool(session, `echo ${text} > ${file}`, () => fs.writeFileSync(path.join(session.cwd, file), text));
  }
  if (/FAIL/.test(message)) await finish({ sessionId: session.id, error: "boom", usage }, 1);
  const step = laoshiStep(message);
  if (step) {
    session.step = step;
    if (process.env.FAKE_AIMAX_PAUSE_STEP === step.stepId && !session.approved) {
      session.pending = `req-${step.key}`;
      save(session);
      await finish({ sessionId: session.id, text: "⚠ 自定义规则拦截确认：rm -rf build", paused: { requestId: session.pending, kind: "approval", title: "⚠ 自定义规则拦截确认：rm -rf build" }, usage });
    }
    save(session);
    await doStep(session, step);
  }
  if (/PAUSE/.test(message) && !session.approved) {
    session.pending = `req-${session.messages.length}`;
    save(session);
    await finish({ sessionId: session.id, text: "⚠ 自定义规则拦截确认：rm -rf build", paused: { requestId: session.pending, kind: "approval", title: "⚠ 自定义规则拦截确认：rm -rf build" }, usage });
  }
  await post({ type: "usage", sessionId: session.id, usage: { ...usage, cacheReadTokens: 500 } });
  await post({ type: "title_updated", sessionId: session.id, title: "t", message });
  await post({ type: "done", sessionId: session.id, result: { text: "done", usage: { ...usage, cacheReadTokens: 500 }, durationMs: 10 } });
  await finish({ sessionId: session.id, text: `done: ${session.messages.length} message(s)`, usage, durationMs: 10, modelName: "fake" });
}

if (command === "resume") {
  const session = load(opt("-s"));
  const requestId = opt("--request-id");
  const input = JSON.parse(opt("--input-json") ?? "{}");
  if (session.pending !== requestId) await finish({ sessionId: session.id, error: `request ${requestId} already "resolved", cannot resume` }, 1);
  session.pending = null;
  if (input.action === "approve") {
    session.approved = true;
    await tool(session, "rm -rf build", () => fs.writeFileSync(path.join(session.cwd, "approved.txt"), "yes"));
    if (session.step) await doStep(session, session.step);
  }
  save(session);
  await finish({ sessionId: session.id, text: input.action === "approve" ? "approved and done" : "HITL approval denied. The tool was NOT executed.", usage });
}

console.error(`fake aimax: unknown command ${argv.join(" ")}`);
process.exit(2);
