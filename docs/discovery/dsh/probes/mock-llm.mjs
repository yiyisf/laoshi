// Scripted OpenAI-compatible chat endpoint, for probing dsh without a real model
// (used by `run.mjs --self-test`). Rules, on the user messages since the last
// assistant or tool message:
//   a line "BASH: <cmd>"          -> one bash tool call running <cmd>
//   a line "ESCALATE: <cmd>"      -> the same, asking for danger-full-access up front
//   "请只回复 <WORD>"              -> final text <WORD>
//   "SLOW"                        -> waits 20s before answering
// On a tool result: when the sandbox offers escalation, retry the same command
// once with sandbox_permissions; otherwise final text "DONE".
// usage: node mock-llm.mjs <port> <log-file>
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.argv[2] ?? 4010);
const logFile = process.argv[3] ?? 'mock-llm.log';
const log = (o) => fs.appendFileSync(logFile, JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => p.text ?? '').join('');
  return '';
}

function lastBashCall(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    for (const call of msgs[i].tool_calls ?? []) {
      if (call.function?.name === 'bash') return JSON.parse(call.function.arguments);
    }
  }
  return null;
}

http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  if (req.method === 'GET' && req.url.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'mock-1', object: 'model' }] }));
    return;
  }
  const json = body ? JSON.parse(body) : {};
  const msgs = json.messages ?? [];
  const last = msgs[msgs.length - 1] ?? {};
  // dsh appends context user messages after the real prompt.
  let from = msgs.length;
  while (from > 0 && msgs[from - 1].role === 'user') from--;
  const text = last.role === 'tool' ? textOf(last.content) : msgs.slice(from).map((m) => textOf(m.content)).join('\n');
  log({ at: new Date().toISOString(), roles: msgs.map((m) => m.role).join(','), last: text.slice(-300) });

  let reply;
  const bash = last.role === 'user' && /^BASH: (.+)$/m.exec(text);
  const escalate = last.role === 'user' && /^ESCALATE: (.+)$/m.exec(text);
  const only = last.role === 'user' && /请只回复\s*([A-Z0-9-]+)/.exec(text);
  if (escalate) {
    reply = { tool: { description: 'Run escalated probe command', command: escalate[1].trim(), sandbox_permissions: 'danger-full-access', justification: 'probe: needs to write outside the workspace' } };
  } else if (bash) {
    reply = { tool: { description: 'Run probe command', command: bash[1].trim() } };
  } else if (last.role === 'tool') {
    const prev = lastBashCall(msgs);
    if (/escalation available/.test(text) && prev && !prev.sandbox_permissions) {
      reply = { tool: { ...prev, sandbox_permissions: 'danger-full-access', justification: 'probe: needs to write outside the workspace' } };
    } else {
      reply = { text: 'DONE' };
    }
  } else if (only) {
    reply = { text: only[1] };
  } else {
    if (/SLOW/.test(text)) await sleep(20000);
    reply = { text: `OK: ${text.replace(/\s+/g, ' ').slice(0, 60)}` };
  }

  const base = { id: 'cmpl-' + Date.now(), object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: json.model ?? 'mock-1' };
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (o) => res.write(`data: ${JSON.stringify({ ...base, ...o })}\n\n`);
  if (reply.tool) {
    send({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: 'bash', arguments: JSON.stringify(reply.tool) } }] }, finish_reason: null }] });
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
  } else {
    send({ choices: [{ index: 0, delta: { role: 'assistant', content: reply.text }, finish_reason: null }] });
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  }
  send({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 34, total_tokens: 1234 } });
  res.write('data: [DONE]\n\n');
  res.end();
}).listen(port, '127.0.0.1', () => log({ listening: port }));
