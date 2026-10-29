// Scripted OpenAI-compatible chat endpoint for probing dsh without a real model.
// Rules on the latest message:
//   user text containing "BASH: <cmd>"  -> one bash tool call running <cmd>
//   user text containing "SLOW"         -> waits 20s before answering (for cancel/steer probes)
//   tool result                         -> final text "DONE"
//   anything else                       -> final text "OK: <first 60 chars>"
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
  // dsh appends context user messages after the real prompt: read every user message since the last assistant/tool one.
  let from = msgs.length;
  while (from > 0 && msgs[from - 1].role === 'user') from--;
  const lastText = last.role === 'tool' ? textOf(last.content) : msgs.slice(from).map((m) => textOf(m.content)).join('\n');
  log({ at: new Date().toISOString(), url: req.url, roles: msgs.map((m) => m.role), last: lastText.slice(0, 300), tools: (json.tools ?? []).map((t) => t.function?.name), stream: json.stream });

  let reply;
  const bash = last.role === 'user' && /BASH: (.+)$/m.exec(lastText);
  const escalate = last.role === 'user' && /ESCALATE: (.+)$/m.exec(lastText);
  if (escalate) {
    reply = { tool: { name: 'bash', args: { description: 'Run escalated probe command', command: escalate[1].trim(), sandbox_permissions: 'danger-full-access', justification: 'probe: needs to write outside the workspace' } } };
  } else if (bash) {
    reply = { tool: { name: 'bash', args: { description: 'Run probe command', command: bash[1].trim() } } };
  } else if (last.role === 'tool') {
    reply = { text: 'DONE' };
  } else {
    if (/SLOW/.test(lastText)) await sleep(20000);
    reply = { text: `OK: ${lastText.replace(/\s+/g, ' ').slice(0, 60)}` };
  }

  const id = 'cmpl-' + Date.now();
  const base = { id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: json.model ?? 'mock-1' };
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (o) => res.write(`data: ${JSON.stringify({ ...base, ...o })}\n\n`);
  if (reply.tool) {
    send({ choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + Date.now(), type: 'function', function: { name: reply.tool.name, arguments: JSON.stringify(reply.tool.args) } }] }, finish_reason: null }] });
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
  } else {
    send({ choices: [{ index: 0, delta: { role: 'assistant', content: reply.text }, finish_reason: null }] });
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  }
  send({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 34, total_tokens: 1234 } });
  res.write('data: [DONE]\n\n');
  res.end();
}).listen(port, '127.0.0.1', () => log({ listening: port }));
