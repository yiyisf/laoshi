#!/usr/bin/env node
// A stand-in for `claude -p --output-format stream-json` and `codex exec --json` in tests: reads the
// prompt from standard input and prints the command line's JSON events, one per line. Which one it
// plays follows its arguments (`exec` → Codex, `-p` → Claude). What a run does follows the prompt:
//   RUN:<command>   a shell tool call (shown, not run)
//   WRITE:<file>:<text>  write a file in the working directory (as a tool call)
//   SLEEP:<ms>      take this long
//   FAIL            end with an error
//   DIE             exit without a result (a cut-off run)
// A laoshi step prompt (a <pipeline-context> block) writes the step's result file, like the
// engine's fake runtime. Calls go to $FAKE_AGENT_DIR/calls.jsonl; sessions to $FAKE_AGENT_DIR/sessions.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.env.FAKE_AGENT_DIR;
const argv = process.argv.slice(2);
if (argv[0] === "--version") {
  console.log("9.9.9 (fake)");
  process.exit(0);
}
const kind = argv[0] === "exec" ? "codex" : "claude";
const prompt = fs.readFileSync(0, "utf8");
fs.mkdirSync(path.join(root, "sessions"), { recursive: true });
const resumeAt = kind === "codex" ? argv.indexOf("resume") : argv.indexOf("--resume");
const existing = resumeAt >= 0 ? argv[resumeAt + 1] : null;
fs.appendFileSync(path.join(root, "calls.jsonl"), `${JSON.stringify({ kind, argv, cwd: process.cwd(), prompt: prompt.slice(0, 200), resume: existing })}\n`);

const sessionFile = (id) => path.join(root, "sessions", `${id}.json`);
const session = existing ? JSON.parse(fs.readFileSync(sessionFile(existing), "utf8")) : { id: kind === "codex" ? crypto.randomUUID() : `claude-${crypto.randomBytes(4).toString("hex")}`, prompts: [] };
session.prompts.push(prompt.slice(0, 200));
fs.writeFileSync(sessionFile(session.id), JSON.stringify(session));

const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;

async function tool(command, effect) {
  const id = `call_${++n}`;
  if (kind === "claude") {
    emit({ type: "assistant", session_id: session.id, message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } });
    effect?.();
    await sleep(20);
    emit({ type: "user", session_id: session.id, message: { content: [{ type: "tool_result", tool_use_id: id, content: "ok token=SECRET123456", is_error: false }] } });
  } else {
    emit({ type: "item.started", item: { id, type: "command_execution", command, status: "in_progress" } });
    effect?.();
    await sleep(20);
    emit({ type: "item.completed", item: { id, type: "command_execution", command, aggregated_output: "ok token=SECRET123456", exit_code: 0, status: "completed" } });
  }
}

function finish(ok, text) {
  if (kind === "claude") {
    emit({ type: "result", subtype: ok ? "success" : "error_during_execution", is_error: !ok, result: text, session_id: session.id, total_cost_usd: 0.01, usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 200 } });
  } else if (ok) {
    emit({ type: "item.completed", item: { id: `msg_${++n}`, type: "agent_message", text } });
    emit({ type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 900, output_tokens: 200 } });
  } else {
    emit({ type: "turn.failed", error: { message: text } });
  }
  process.exit(ok ? 0 : 1);
}

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
  report: { outcome: "completed", summary: "端到端检查：流水线在命令行适配器上跑完。" },
};

function laoshiStep(text) {
  const at = text.lastIndexOf("<pipeline-context>");
  if (at < 0) return null;
  const block = text.slice(at);
  const field = (label) => new RegExp(`^${label}：(.+)$`, "m").exec(block)?.[1].trim();
  const resultAbs = field("结果文件绝对路径");
  const featureDir = field("功能目录");
  if (!resultAbs || !featureDir) return null;
  const key = path.basename(resultAbs).replace(/\.json$/, "");
  return { key, stepId: key.replace(/@.*$/, "").replace(/-r\d+$/, "").replace(/-s\d+$/, ""), resultAbs, featureDir };
}

if (kind === "claude") emit({ type: "system", subtype: "init", session_id: session.id });
else emit({ type: "thread.started", thread_id: session.id });

const wait = Number(/SLEEP:(\d+)/.exec(prompt)?.[1] ?? 0);
if (wait) await sleep(wait);
for (const [, command] of prompt.matchAll(/RUN:(\S+)/g)) await tool(command.replace(/_/g, " "));
for (const [, file, text] of prompt.matchAll(/WRITE:([^:\s]+):(\S+)/g)) await tool(`echo ${text} > ${file}`, () => fs.writeFileSync(path.join(process.cwd(), file), text));
if (/\bDIE\b/.test(prompt)) process.exit(137);
if (/\bFAIL\b/.test(prompt)) finish(false, "boom");
const step = laoshiStep(prompt);
if (step) {
  await tool(`write ${step.key} result`, () => {
    const dir = path.join(process.cwd(), step.featureDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "progress.md"), `- ${step.key}：完成（模拟 ${kind}）\n`);
    fs.mkdirSync(path.dirname(step.resultAbs), { recursive: true });
    fs.writeFileSync(step.resultAbs, `${JSON.stringify(RESULTS[step.stepId] ?? { status: "done" })}\n`);
  });
}
finish(true, `done: ${session.prompts.length} prompt(s)`);
