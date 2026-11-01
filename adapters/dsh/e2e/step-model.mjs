// A scripted OpenAI-compatible model for the dsh end-to-end check (run-e2e.mjs). It does a
// pipeline step the way engine/test/fake-runtime.ts's agents do, but through dsh's real bash tool:
// for a step prompt it asks to run one command that writes the step's artifact and a valid result
// file; after the tool result it answers "完成". Anything else (the pipeline's notes to the chat)
// gets a short acknowledgement.
// usage: node step-model.mjs <port> <log-file>
import fs from "node:fs";
import http from "node:http";

const port = Number(process.argv[2] ?? 4030);
const logFile = process.argv[3] ?? "step-model.log";
const log = (o) => fs.appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...o }) + "\n");

// Same defaults as the engine's fake runtime: every step passes on the first try.
const RESULTS = {
  design: { has_runnable_service: false, files: ["src/"], ui_change: false },
  design_review: { verdict: "approved" },
  design_revise: { status: "done" },
  implement: { status: "done" },
  code_review: { verdict: "pass" },
  review_fix: { status: "done" },
  handoff: { status: "done" },
  service_start: { started: true },
  verify: { result: "pass" },
  defect_fix: { status: "done" },
  reverify: { result: "pass" },
  report: { outcome: "completed", summary: "端到端检查：流水线在 dsh 上跑完。" },
};
const ARTIFACTS = {
  design: "design.md",
  design_review: "design-review.md",
  design_revise: "design.md",
  implement: "implementation.md",
  code_review: "code-review.md",
  review_fix: "code-review.md",
  handoff: "handoff.md",
  service_start: "service-start.md",
  verify: "verification.md",
  defect_fix: "verification.md",
  reverify: "verification.md",
  report: "report.md",
};

const text = (content) => (typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => p.text ?? "").join("") : "");
const q = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

function stepCommand(prompt) {
  const block = prompt.slice(prompt.lastIndexOf("<pipeline-context>"));
  const field = (label) => new RegExp(`^${label}：(.+)$`, "m").exec(block)?.[1].trim();
  const resultAbs = field("结果文件绝对路径");
  const featureDir = field("功能目录");
  if (!resultAbs || !featureDir) return null;
  const key = resultAbs.split(/[\\/]/).pop().replace(/\.json$/, "");
  const stepId = key.replace(/@.*$/, "").replace(/-r\d+$/, "").replace(/-s\d+$/, "");
  const result = RESULTS[stepId] ?? { status: "done" };
  const artifact = `${featureDir}/${ARTIFACTS[stepId] ?? "progress.md"}`;
  return {
    key,
    command: [
      `mkdir -p ${q(featureDir)}`,
      `printf '\\n## %s（e2e 模拟模型）\\n' ${q(key)} >> ${q(artifact)}`,
      `printf -- '- %s：完成\\n' ${q(key)} >> ${q(`${featureDir}/progress.md`)}`,
      `printf '%s\\n' ${q(JSON.stringify(result))} > ${q(resultAbs)}`,
    ].join(" && "),
  };
}

http
  .createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    if (req.method === "GET" && req.url.endsWith("/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "step-1", object: "model" }] }));
      return;
    }
    const json = body ? JSON.parse(body) : {};
    const msgs = json.messages ?? [];
    const last = msgs.at(-1) ?? {};
    let from = msgs.length;
    while (from > 0 && msgs[from - 1].role === "user") from--;
    const prompt = msgs.slice(from).map((m) => text(m.content)).join("\n");
    const shell = (json.tools ?? []).map((t) => t.function?.name).find((n) => n === "bash" || n === "pwsh") ?? "bash";

    let reply;
    const step = last.role === "user" ? stepCommand(prompt) : null;
    if (step) {
      reply = { tool: { description: `Write ${step.key} result`, command: step.command } };
      log({ step: step.key });
    } else if (last.role === "tool") {
      reply = { text: "完成" };
    } else {
      reply = { text: "收到" };
      log({ chat: prompt.slice(-160) });
    }

    const base = { id: `cmpl-${Date.now()}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: json.model ?? "step-1" };
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const send = (o) => res.write(`data: ${JSON.stringify({ ...base, ...o })}\n\n`);
    if (reply.tool) {
      send({ choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: "function", function: { name: shell, arguments: JSON.stringify(reply.tool) } }] }, finish_reason: null }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
    } else {
      send({ choices: [{ index: 0, delta: { role: "assistant", content: reply.text }, finish_reason: null }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    }
    send({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 20, total_tokens: 1020 } });
    res.write("data: [DONE]\n\n");
    res.end();
  })
  .listen(port, "127.0.0.1", () => log({ listening: port }));
