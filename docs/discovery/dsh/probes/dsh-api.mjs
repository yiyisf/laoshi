// Minimal external client for the dsh web host's /api (what a laoshi dsh adapter would use).
// usage: node dsh-api.mjs <web-log-with-token-url> <namespace/method> '<args-json>'
//        node dsh-api.mjs <log> wait <sessionId> [timeoutSec]   poll session/list until not running
import fs from 'node:fs';

const [, , logPath, method, argJson, extra] = process.argv;
const url = /(http:\/\/127\.0\.0\.1:\d+)\/\?token=([\w-]+)/.exec(fs.readFileSync(logPath, 'utf8'));
if (!url) throw new Error('no token URL in log');
const [, base, token] = url;

async function login() {
  const res = await fetch(`${base}/?token=${token}`, { redirect: 'manual' });
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

let n = 0;
async function rpc(cookie, m, args) {
  const res = await fetch(`${base}/api/${m}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: `p${Date.now()}-${n++}`, method: m, payload: { args } }),
  });
  const body = await res.json();
  if (!body.result?.ok) throw new Error(`${m}: ${JSON.stringify(body.result?.error ?? body)}`);
  return body.result.value;
}

const cookie = await login();
if (method === 'wait') {
  const id = argJson;
  const deadline = Date.now() + Number(extra ?? 60) * 1000;
  for (;;) {
    const { items } = await rpc(cookie, 'session/list', { _request: {} });
    const s = items.find((i) => i.sessionId === id);
    if (s && !s.running) { console.log(JSON.stringify({ status: 'idle', summary: s })); break; }
    if (Date.now() > deadline) { console.log(JSON.stringify({ status: 'timeout', summary: s })); break; }
    await new Promise((r) => setTimeout(r, 500));
  }
} else {
  console.log(JSON.stringify(await rpc(cookie, method, JSON.parse(argJson ?? '{}')), null, 1));
}
