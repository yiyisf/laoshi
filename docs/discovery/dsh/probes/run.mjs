#!/usr/bin/env node
// dsh 内网摸底包：一条命令跑完 dsh 摸底的全部探针，生成 report.md。
// 说明见同目录 README.md。
//
//   node run.mjs                 用 LAOSHI_PROBE_MODEL_* 指定的模型网关（Windows 上用 run.cmd 启动）
//   node run.mjs --self-test     用同目录的 mock-llm.mjs 代替模型（只验证摸底包本身）
//   node run.mjs --out <目录>    输出目录，默认 ./dsh-probe-<时间>
//   node run.mjs --task-timeout <分钟>   模型任务（P13）每项的超时，默认 15
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const selfTest = flag('--self-test');
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');
const out = path.resolve(option('--out', `dsh-probe-${stamp}`));
const taskTimeoutMs = Number(option('--task-timeout', '15')) * 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const facts = {};
const record = (id, name, status, detail) => {
  results.push({ id, name, status, detail });
  console.log(`[${status}] ${id} ${name}${detail ? ` — ${detail}` : ''}`);
};

// ---------------------------------------------------------------- inputs

const env = process.env;
const model = selfTest
  ? { baseURL: null, id: 'mock-1', api: 'openai-completions', keyVar: 'LAOSHI_PROBE_MODEL_API_KEY' }
  : {
      baseURL: env.LAOSHI_PROBE_MODEL_BASE_URL,
      id: env.LAOSHI_PROBE_MODEL_ID,
      api: env.LAOSHI_PROBE_MODEL_API ?? 'openai-completions',
      keyVar: 'LAOSHI_PROBE_MODEL_API_KEY',
    };
if (!selfTest) {
  const missing = ['LAOSHI_PROBE_MODEL_BASE_URL', 'LAOSHI_PROBE_MODEL_ID', 'LAOSHI_PROBE_MODEL_API_KEY'].filter((k) => !env[k]);
  if (missing.length) {
    console.error(`缺少环境变量：${missing.join('、')}。见 README.md。`);
    process.exit(2);
  }
  if (!['openai-completions', 'openai-responses', 'anthropic-messages'].includes(model.api)) {
    console.error('LAOSHI_PROBE_MODEL_API 只能是 openai-completions、openai-responses 或 anthropic-messages');
    process.exit(2);
  }
}
const redactUrl = (u) => {
  try {
    const x = new URL(u);
    return `${x.protocol}//<模型网关>${x.pathname}`;
  } catch {
    return '<模型网关>';
  }
};
const gatewayHost = model.baseURL ? new URL(model.baseURL).hostname : '127.0.0.1';

const isWin = process.platform === 'win32';

// dsh is started as `node <its bin script>`: on Windows node_modules/.bin/dsh is a .cmd
// shim, which Node refuses to spawn without a shell.
function findDsh() {
  const roots = [env.LAOSHI_PROBE_DSH, process.cwd(), here].filter(Boolean);
  try {
    roots.push(path.dirname(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', shell: isWin, stdio: ['ignore', 'pipe', 'ignore'] }).trim()));
  } catch {}
  for (const root of roots) {
    const dir = path.join(path.resolve(root), 'node_modules', '@deepseek-ai', 'dsh');
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.dsh;
    if (bin) return { dir, bin: path.join(dir, bin) };
  }
  return null;
}
const dsh = findDsh();
if (!dsh) {
  console.error('找不到 dsh。请先在当前目录 npm install @deepseek-ai/dsh，或用 LAOSHI_PROBE_DSH 指定安装了 dsh 的目录（其下有 node_modules/@deepseek-ai/dsh）。');
  process.exit(2);
}
const dshArgs = (...a) => [dsh.bin, ...a];

// Probe commands in the shell dsh gives the model: bash, or PowerShell (pwsh) on Windows.
const shellName = isWin ? 'PowerShell（pwsh）' : 'bash';
const cmd = isWin
  ? {
      hello: "Set-Content -Path hello.txt -Value ok; (Get-ChildItem Env: | Where-Object Name -like 'DSH_*' | Sort-Object Name).Name | Set-Content -Path dsh-env.txt; $PSVersionTable.PSVersion.ToString() | Set-Content -Path shell-version.txt",
      sleep: (sec) => `Start-Sleep -Seconds ${sec}`,
      write: (file, text) => `Set-Content -Path '${file}' -Value ${text}`,
    }
  : {
      hello: "echo ok > hello.txt && env | grep '^DSH_' | sed 's/=.*//' | sort > dsh-env.txt && echo \"bash $BASH_VERSION\" > shell-version.txt",
      sleep: (sec) => `sleep ${sec}`,
      write: (file, text) => `echo ${text} > '${file}'`,
    };
const readLines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []);

function dirSize(root) {
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) {
        try {
          total += fs.statSync(p).size;
        } catch {}
      }
    }
  }
  return total;
}

// ---------------------------------------------------------------- layout

const dirs = {
  home: path.join(out, 'dsh-home'),
  repo: path.join(out, 'repo'),
  plugin: path.join(out, 'plugin'),
  inbox: path.join(out, 'plugin-inbox'),
  outbox: path.join(out, 'plugin-outbox'),
  logs: path.join(out, 'logs'),
};
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
const outside = path.join(os.homedir(), `.laoshi-probe-outside-${stamp}`);
const files = {
  netlog: path.join(dirs.logs, 'net.log'),
  pluginLog: path.join(dirs.logs, 'plugin.log'),
  allow: path.join(out, 'ALLOW-APPROVALS'),
  mockLog: path.join(dirs.logs, 'mock-llm.log'),
};

function writeSampleRepo() {
  const r = dirs.repo;
  fs.mkdirSync(path.join(r, 'src'), { recursive: true });
  fs.mkdirSync(path.join(r, 'test'), { recursive: true });
  fs.mkdirSync(path.join(r, 'step'), { recursive: true });
  fs.writeFileSync(path.join(r, 'package.json'), JSON.stringify({ name: 'probe-sample', private: true, type: 'module', scripts: { test: 'node --test test/sum.test.js' } }, null, 2) + '\n');
  fs.writeFileSync(path.join(r, 'src/sum.js'), 'export function sum(a, b) {\n  return a - b;\n}\n');
  fs.writeFileSync(path.join(r, 'test/sum.test.js'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from '../src/sum.js';\n\ntest('sum adds two numbers', () => {\n  assert.equal(sum(2, 3), 5);\n});\n");
  fs.writeFileSync(path.join(r, 'README.md'), '# probe-sample\n\n`sum(a, b)` 应当返回两数之和。\n');
  fs.writeFileSync(path.join(r, '.gitignore'), 'step/\n');
  const git = (...a) => execFileSync('git', a, { cwd: r, stdio: 'ignore' });
  git('init', '-q');
  git('-c', 'user.name=probe', '-c', 'user.email=probe@localhost', 'add', '-A');
  git('-c', 'user.name=probe', '-c', 'user.email=probe@localhost', 'commit', '-q', '-m', 'sample');
}

// ---------------------------------------------------------------- dsh host

const hostEnv = () => ({
  ...env,
  DSH_HOME: dirs.home,
  LAOSHI_PROBE_NETLOG: files.netlog,
  NODE_OPTIONS: `${env.NODE_OPTIONS ?? ''} --import ${pathToFileURL(path.join(here, 'netlog.mjs')).href}`.trim(),
});

function run(cmd, cmdArgs, opts = {}) {
  return execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

function writeProfilePatch(compat) {
  const providerCompat = Object.keys(compat).length
    ? `        compat:\n${Object.entries(compat).map(([k, v]) => `          ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n')}\n`
    : '';
  const baseURL = selfTest ? `http://127.0.0.1:${mockPort}/v1` : model.baseURL;
  const patch = `# 由 laoshi dsh 摸底包生成。凭据只通过环境变量 ${model.keyVar} 读取，不写入文件。
- id: llm-pi-ai
  config:
    providers:
      laoshi-probe:
        apiKeyEnv: ${model.keyVar}
        api: ${model.api}
        baseURL: ${JSON.stringify(baseURL)}
${providerCompat}        models:
          - id: ${JSON.stringify(model.id)}
- id: agent-default-model
  config:
    provider: laoshi-probe
    model: ${JSON.stringify(model.id)}
- insert:
    - id: laoshi-probe
      name: 'laoshi-probe'
      config:
        log: ${JSON.stringify(files.pluginLog)}
        inbox: ${JSON.stringify(dirs.inbox)}
        outbox: ${JSON.stringify(dirs.outbox)}
        allowFile: ${JSON.stringify(files.allow)}
`;
  fs.mkdirSync(path.join(dirs.home, 'profiles/web'), { recursive: true });
  fs.writeFileSync(path.join(dirs.home, 'profiles/web/cordis.patch.yml'), patch);
}

let host = null;
async function startHost(label, port = 0) {
  const logFile = path.join(dirs.logs, `host-${label}.log`);
  const fd = fs.openSync(logFile, 'w');
  // cwd = repo: the sandbox's workspace root is the host's cwd.
  const child = spawn(process.execPath, dshArgs('--profile', 'web', '--no-open', '--port', String(port)), { cwd: dirs.repo, env: hostEnv(), stdio: ['ignore', fd, fd], detached: !isWin, windowsHide: true });
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const text = fs.readFileSync(logFile, 'utf8');
    const m = /(https?:\/\/[^\s/]+)\/\?token=([\w-]+)/.exec(text);
    if (m) {
      host = { child, base: m[1], token: m[2], logFile };
      host.cookie = await login(host);
      return host;
    }
    if (child.exitCode !== null) break;
    await sleep(500);
  }
  throw new Error(`dsh web host 没有启动（见 ${path.relative(out, logFile)}）`);
}

async function stopHost() {
  if (!host) return;
  const { child } = host;
  // The host and its workers: the process group on Linux/macOS, the process tree on Windows.
  const killTree = (force) => {
    try {
      if (isWin) execFileSync('taskkill', ['/pid', String(child.pid), '/T', ...(force ? ['/F'] : [])], { stdio: 'ignore' });
      else process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
    } catch {}
  };
  killTree(false);
  for (let i = 0; i < 30 && child.exitCode === null && child.signalCode === null; i++) await sleep(500);
  killTree(true);
  host = null;
  await sleep(1000);
}

async function login(h) {
  const res = await fetch(`${h.base}/?token=${h.token}`, { redirect: 'manual' });
  return res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

let rpcCount = 0;
async function rpc(method, a, cookie = host.cookie) {
  const res = await fetch(`${host.base}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: `probe-${rpcCount++}`, method, payload: { args: a } }),
  });
  const body = await res.json();
  if (!body.result?.ok) throw new Error(`${method}: ${JSON.stringify(body.result?.error ?? body).slice(0, 300)}`);
  return body.result.value;
}

const sessions = async () => (await rpc('session/list', { _request: {} })).items;
const summary = async (id) => (await sessions()).find((s) => s.sessionId === id) ?? null;
const createSession = async () => (await rpc('session/create', { request: { cwd: dirs.repo } })).sessionId;
const prompt = (sessionId, text, mode = 'queue') =>
  rpc('session/prompt', { request: { requestId: `probe-${Date.now()}-${rpcCount}`, sessionId, mode, content: [{ type: 'text', text }] } });

async function events(sessionId) {
  const page = await rpc('session/page', { request: { address: { kind: 'session', sessionId }, maxMessages: 1000 } });
  return page.records.filter((r) => r.type === 'event').map((r) => r.event);
}
const userText = (e) => (e.data?.content ?? []).map((p) => p.text ?? '').join('');
const assistantTexts = (evs) => evs.filter((e) => e.type === 'assistant/message').map((e) => (e.data.message?.content ?? []).filter((p) => p.type === 'text').map((p) => p.text).join(''));

async function waitIdle(sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  await sleep(1000);
  while (Date.now() < deadline) {
    const s = await summary(sessionId);
    if (s && !s.running) return s;
    await sleep(1000);
  }
  return null;
}

async function waitFor(fn, timeoutMs, everyMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await sleep(everyMs);
  }
  return null;
}

let opCount = 0;
async function pluginOp(op, timeoutMs) {
  const id = `op-${++opCount}`;
  const tmp = path.join(dirs.inbox, `${id}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(op));
  fs.renameSync(tmp, path.join(dirs.inbox, `${id}.json`));
  const reply = path.join(dirs.outbox, `${id}.json`);
  return waitFor(() => (fs.existsSync(reply) ? JSON.parse(fs.readFileSync(reply, 'utf8')) : null), timeoutMs, 500);
}

const run_ = (text) => `请用 ${shellName} 工具执行下面这条命令（不要改写），执行完简短回复"完成"。\nCMD: ${text}`;

// ---------------------------------------------------------------- probes

let mockPort = null;
let mock = null;

async function main() {
  console.log(`输出目录：${out}`);
  writeSampleRepo();

  // P01 environment and install
  facts.node = process.version;
  const [maj, min] = process.versions.node.split('.').map(Number);
  // dsh declares >= 24.9, but Node 22.19+ ran every probe in the self-test (22.20 and 22.22);
  // below 22.19 the previous dsh floor applies and we stop.
  const nodeDeclared = maj > 24 || (maj === 24 && min >= 9);
  const nodeOk = nodeDeclared || (maj === 22 && min >= 19);
  try {
    facts.dsh = run(process.execPath, dshArgs('--version'), { env: { ...env, DSH_HOME: dirs.home } }).trim();
  } catch (e) {
    facts.dsh = `无法运行：${e.message.split('\n')[0]}`;
  }
  try {
    facts.pnpm = run('pnpm', ['--version'], { shell: isWin }).trim();
  } catch {
    facts.pnpm = null;
  }
  facts.platform = `${process.platform} ${os.release()}`;
  facts.installRoot = path.resolve(dsh.dir, '..', '..'); // the node_modules holding @deepseek-ai/dsh
  facts.installSize = `${Math.round(dirSize(facts.installRoot) / 1024 / 1024)} MB`;
  record('P01', '环境与安装', !nodeOk || facts.dsh.startsWith('无法') ? 'fail' : nodeDeclared ? 'pass' : 'info',
    `Node ${facts.node}（dsh 声明要求 ≥ 24.9${nodeOk && !nodeDeclared ? '；低于声明，但 22.19 以上在自测中可以运行，继续' : ''}）；dsh ${facts.dsh}；pnpm ${facts.pnpm ?? '未安装'}；安装占用 ${facts.installSize ?? '未知'}`);
  if (!nodeOk) throw new Error('Node 版本低于 22.19，dsh 无法运行（声明要求 ≥ 24.9）');

  if (selfTest) {
    mockPort = 41000 + Math.floor(Math.random() * 1000);
    mock = spawn(process.execPath, [path.join(here, 'mock-llm.mjs'), String(mockPort), files.mockLog], { stdio: 'ignore' });
    env.LAOSHI_PROBE_MODEL_API_KEY = 'self-test';
    await sleep(800);
  }

  // Plugin install: dsh plugin add (pnpm), or copy into the profile when that fails.
  fs.cpSync(path.join(here, 'laoshi-probe-plugin'), dirs.plugin, { recursive: true });
  let pluginInstall;
  try {
    run(process.execPath, dshArgs('plugin', '--profile', 'web', 'add', `file:${dirs.plugin.replace(/\\/g, '/')}`), { env: { ...env, DSH_HOME: dirs.home } });
    pluginInstall = 'dsh plugin add';
  } catch (e) {
    const target = path.join(dirs.home, 'profiles/web/node_modules/laoshi-probe');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(dirs.plugin, target, { recursive: true });
    pluginInstall = `dsh plugin add 失败（${e.message.split('\n')[0].slice(0, 120)}），改为直接复制`;
  }
  facts.pluginInstall = pluginInstall;

  // P02 model access: try compat variants until one answers.
  const variants = model.api === 'openai-completions'
    ? [{}, { supportsDeveloperRole: false }, { supportsDeveloperRole: false, maxTokensField: 'max_tokens' }]
    : [{}];
  let main = null;
  const attempts = [];
  for (const [i, compat] of variants.entries()) {
    writeProfilePatch(compat);
    try {
      await startHost(`model-${i + 1}`);
    } catch (e) {
      attempts.push(`组合 ${i + 1} ${JSON.stringify(compat)}：host 未启动（${e.message}）`);
      await stopHost();
      continue;
    }
    const sid = await createSession();
    await prompt(sid, '这是连通性测试。请只回复 PONG');
    await waitIdle(sid, 180_000);
    const evs = await events(sid);
    const texts = assistantTexts(evs);
    const errs = evs.filter((e) => /error|attempt/.test(e.type)).map((e) => JSON.stringify(e.data).slice(0, 200));
    if (texts.some((t) => /PONG/i.test(t))) {
      attempts.push(`组合 ${i + 1} ${JSON.stringify(compat)}：成功`);
      facts.compat = compat;
      main = sid;
      break;
    }
    attempts.push(`组合 ${i + 1} ${JSON.stringify(compat)}：失败（回复：${JSON.stringify(texts.at(-1) ?? '').slice(0, 80)}；错误：${errs.at(-1) ?? '无'}）`);
    await stopHost();
  }
  facts.modelAttempts = attempts;
  record('P02', '模型接入', main ? 'pass' : 'fail', attempts.join('；'));
  if (!main) throw new Error('所有兼容组合都没能得到模型应答，其余探针无法进行');
  facts.pluginLoaded = fs.existsSync(files.pluginLog) && fs.readFileSync(files.pluginLog, 'utf8').includes('"loaded":true');
  const hostLog = fs.readFileSync(host.logFile, 'utf8');
  facts.pluginPending = /laoshi-probe.*pending/.test(hostLog) ? hostLog.split('\n').filter((l) => l.includes('laoshi-probe')).join(' ') : null;

  // P03 tool call, files in cwd, DSH_* variables
  await prompt(main, run_(cmd.hello));
  await waitIdle(main, 300_000);
  const hello = fs.existsSync(path.join(dirs.repo, 'hello.txt'));
  const dshVars = readLines(path.join(dirs.repo, 'dsh-env.txt'));
  facts.shell = readLines(path.join(dirs.repo, 'shell-version.txt'))[0] ?? null;
  facts.dshVars = dshVars;
  record('P03', '工具调用与会话识别', hello && dshVars.includes('DSH_SESSION_ID') ? 'pass' : 'fail',
    `shell：${facts.shell ?? '未知'}；hello.txt ${hello ? '在会话目录' : '没有出现'}；环境变量：${dshVars.join('、') || '无'}`);

  // P04 status and usage
  const s4 = await summary(main);
  const usage = s4?.projections?.values?.tokenUsage;
  record('P04', '状态与用量', s4 && s4.running === false && usage ? 'pass' : 'fail', `running=${s4?.running}；tokenUsage=${JSON.stringify(usage ?? null)}`);

  // P05 cancel a running turn
  await prompt(main, run_(cmd.sleep(60)));
  const running5 = await waitFor(async () => (await summary(main))?.running, 60_000);
  await sleep(5000);
  const t5 = Date.now();
  await rpc('session/cancel', { request: { sessionId: main } });
  const idle5 = await waitIdle(main, 60_000);
  const cancelSec = ((Date.now() - t5) / 1000).toFixed(1);
  record('P05', '打断（session/cancel）', running5 && idle5 && Date.now() - t5 < 20_000 ? 'pass' : 'fail', `取消后 ${cancelSec} 秒回到空闲`);

  // P06 queue while running: handled after the running turn, not interrupting it
  await prompt(main, run_(cmd.sleep(15)));
  await waitFor(async () => (await summary(main))?.running, 60_000);
  await sleep(2000);
  await prompt(main, '这是排队测试。请只回复 QUEUED-OK', 'queue');
  await waitIdle(main, 300_000);
  {
    const evs = await events(main);
    const sleepMsg = evs.findLast((e) => e.type === 'user/message' && userText(e).includes(cmd.sleep(15)));
    const queued = evs.findLast((e) => e.type === 'user/message' && userText(e).includes('QUEUED-OK'));
    const endAfterSleep = evs.find((e) => e.type === 'turn/end' && sleepMsg && e.seq > sleepMsg.seq);
    const ok = sleepMsg && queued && endAfterSleep && queued.seq > endAfterSleep.seq;
    const answered = assistantTexts(evs.filter((e) => queued && e.seq > queued.seq)).some((t) => t.includes('QUEUED-OK'));
    record('P06', '运行中投递消息（queue）', ok ? 'pass' : 'fail', `${ok ? '在运行中的回合结束后才处理' : '顺序不符合预期'}；模型${answered ? '按要求' : '没有按要求'}回复`);
  }

  // P07 steer while running: enters the running turn
  await prompt(main, run_(cmd.sleep(15)));
  await waitFor(async () => (await summary(main))?.running, 60_000);
  await sleep(2000);
  await prompt(main, '这是插话测试。命令结束后请只回复 STEER-OK', 'steer');
  await waitIdle(main, 300_000);
  {
    const evs = await events(main);
    const steer = evs.findLast((e) => e.type === 'user/message' && userText(e).includes('STEER-OK'));
    const sleepMsg = evs.findLast((e) => e.type === 'user/message' && userText(e).includes(cmd.sleep(15)));
    const endAfterSleep = evs.find((e) => e.type === 'turn/end' && sleepMsg && e.seq > sleepMsg.seq);
    const inTurn = steer && endAfterSleep && steer.seq < endAfterSleep.seq;
    record('P07', '运行中插话（steer）', inTurn ? 'pass' : 'info', inTurn ? '插入到正在运行的回合中' : '没有插入当前回合（可能命令已先结束）');
  }

  // P08 child agent under the session, through the plugin
  let childId = null;
  if (!facts.pluginLoaded) {
    record('P08', '插件在会话下创建子 agent', 'fail', `插件没有加载（安装方式：${pluginInstall}${facts.pluginPending ? `；${facts.pluginPending}` : ''}）`);
  } else {
    const r8 = await pluginOp({ op: 'spawn', parent: main, label: 'laoshi 探针：子步骤', prompt: run_(cmd.write('child.txt', 'child-ok')), cwd: path.join(dirs.repo, 'step') }, 600_000);
    childId = r8?.childId ?? null;
    const parent = await summary(main);
    const child = childId ? await summary(childId) : null;
    const catalog = parent?.projections?.values?.subagentCatalog ?? [];
    const listed = catalog.some((c) => c.id === childId && c.label === 'laoshi 探针：子步骤');
    const file = fs.existsSync(path.join(dirs.repo, 'step/child.txt'));
    const ok = r8?.ok && listed && child?.origin === 'subagent' && child?.parentSessionId === main && file;
    record('P08', '插件在会话下创建子 agent', ok ? 'pass' : 'fail',
      `结果：${r8 ? (r8.ok ? r8.result?.stopReason ?? 'ok' : r8.error) : '超时'}；出现在父会话子 agent 列表：${listed}；origin=${child?.origin}；文件写在指定目录：${file}`);
  }

  // P09 follow up the child from outside
  if (childId) {
    await rpc('subagents/prompt', { request: { requestId: `probe-child-${Date.now()}`, parentSessionId: main, childSessionId: childId, mode: 'continuable', delivery: 'queue', content: [{ type: 'text', text: run_(cmd.write('child2.txt', 'child-2')) }] } });
    await waitIdle(childId, 300_000);
    const ok = fs.existsSync(path.join(dirs.repo, 'step/child2.txt'));
    record('P09', '外部追问子 agent（subagents/prompt）', ok ? 'pass' : 'fail', ok ? '子 agent 执行了追问' : '没有执行');
  } else {
    record('P09', '外部追问子 agent（subagents/prompt）', 'skip', '没有子 agent');
  }

  // P10 schedule a message into the session, through the plugin
  if (facts.pluginLoaded) {
    const r10 = await pluginOp({ op: 'schedule', sessionId: main, title: 'laoshi 探针：定时消息', prompt: '这是定时探针。请只回复 SCHEDULED-OK', after_seconds: 30 }, 60_000);
    const due = r10?.record?.scheduledAt ? Date.parse(r10.record.scheduledAt) : null;
    const delivered = await waitFor(async () => {
      const evs = await events(main);
      return evs.find((e) => e.type === 'user/message' && userText(e).includes('这是定时探针')) ?? null;
    }, 120_000, 2000);
    const lateSec = delivered && due ? ((delivered.time - due) / 1000).toFixed(1) : null;
    record('P10', '插件创建定时消息', r10?.ok && delivered ? 'pass' : 'fail', r10?.ok ? (delivered ? `到点送达，延迟 ${lateSec} 秒` : '到点后 90 秒内没有送达') : `创建失败：${r10?.error ?? '超时'}`);
    await waitIdle(main, 300_000);
  } else {
    record('P10', '插件创建定时消息', 'skip', '插件没有加载');
  }

  // P11 approval: answered by the plugin; and left unanswered
  fs.mkdirSync(outside, { recursive: true });
  const outsideFile = path.join(outside, 'approval.txt');
  const escalation = (file) =>
    `请用 ${shellName} 工具执行下面这条命令（不要改写）。它要写工作区之外的文件，如果被沙箱拒绝，请按工具结果的提示带上 sandbox_permissions 和 justification 重试一次。\nCMD: ${cmd.write(file, 'x')}`;
  if (facts.pluginLoaded) {
    fs.writeFileSync(files.allow, '');
    await prompt(main, escalation(outsideFile));
    await waitIdle(main, 300_000);
    fs.rmSync(files.allow, { force: true });
    const asked = fs.readFileSync(files.pluginLog, 'utf8').includes('"decision":"allowed-once"');
    const wrote = fs.existsSync(outsideFile);
    record('P11a', '插件代为审批', asked && wrote ? 'pass' : asked ? 'fail' : 'info',
      asked ? `插件收到审批请求并批准；文件${wrote ? '已写入' : '没有写入'}` : `没有出现审批请求：${wrote ? '沙箱没有拦截这次写入（工作区之外仍可写）' : '模型没有申请升级'}`);

    const before = (fs.readFileSync(files.pluginLog, 'utf8').match(/"decision":"defer"/g) ?? []).length;
    await prompt(main, escalation(path.join(outside, 'pending.txt')));
    const deferred = await waitFor(() => (fs.readFileSync(files.pluginLog, 'utf8').match(/"decision":"defer"/g) ?? []).length > before, 180_000);
    let hanging = false;
    if (deferred) {
      await sleep(20_000);
      hanging = (await summary(main))?.running === true;
    }
    await rpc('session/cancel', { request: { sessionId: main } });
    await waitIdle(main, 60_000);
    record('P11b', '无人作答的审批', deferred ? 'info' : 'skip',
      deferred ? `交给界面后${hanging ? '一直挂起（列表只显示 running=true）' : '没有挂起'}；已用 cancel 结束` : '没有出现审批请求');
  } else {
    record('P11a', '插件代为审批', 'skip', '插件没有加载');
  }
  fs.rmSync(outside, { recursive: true, force: true });

  // P12 restart: sessions, cookie, cold resume of session and child
  const oldCookie = host.cookie;
  const port = new URL(host.base).port; // the cookie is bound to host:port
  await stopHost();
  await startHost('restart', port);
  let cookieOk = false;
  try {
    await rpc('session/list', { _request: {} }, oldCookie);
    cookieOk = true;
  } catch {}
  const listAfter = await sessions();
  const kept = listAfter.some((s) => s.sessionId === main) && (!childId || listAfter.some((s) => s.sessionId === childId));
  await prompt(main, '这是重启后的测试。请只回复 RESTART-OK');
  const mainBack = await waitIdle(main, 300_000);
  const mainAnswered = assistantTexts(await events(main)).some((t) => t.includes('RESTART-OK'));
  let childBack = null;
  if (childId) {
    try {
      await rpc('subagents/prompt', { request: { requestId: `probe-child-r-${Date.now()}`, parentSessionId: main, childSessionId: childId, mode: 'continuable', delivery: 'queue', content: [{ type: 'text', text: run_(cmd.write('child3.txt', 'after-restart')) }] } });
      await waitIdle(childId, 300_000);
      childBack = fs.existsSync(path.join(dirs.repo, 'step/child3.txt')) ? '续上了' : '没有执行';
    } catch (e) {
      childBack = `失败：${e.message.slice(0, 160)}`;
    }
  }
  record('P12', 'host 重启后续跑', kept && mainBack && cookieOk ? 'pass' : 'fail',
    `会话保留：${kept}；旧 cookie 仍有效：${cookieOk}；主会话续跑：${mainBack ? (mainAnswered ? '正常' : '回到空闲但没有按要求回复') : '超时'}；子 agent 续跑：${childBack ?? '无子 agent'}`);

  // P13 model tasks: req-kit style steps writing result files
  if (!facts.pluginLoaded) {
    record('P13', '模型完成步骤任务（结果文件）', 'skip', '插件没有加载');
  } else {
    await modelTasks(main);
  }

  // P14 outbound connections
  const lines = fs.existsSync(files.netlog) ? fs.readFileSync(files.netlog, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const local = (h) => !h || h === 'localhost' || h === '::1' || h.startsWith('127.') || h === gatewayHost;
  const external = new Map();
  for (const l of lines) {
    if (l.kind === 'ipc' || local(l.host)) continue;
    const k = `${l.host}${l.port ? `:${l.port}` : ''}`;
    external.set(k, (external.get(k) ?? 0) + 1);
  }
  facts.external = [...external];
  record('P14', '对外连接', external.size === 0 ? 'pass' : 'fail',
    external.size === 0 ? `共记录 ${lines.length} 次解析/连接，全部是本机或模型网关` : `除本机和模型网关外，还尝试连接：${[...external].map(([k, v]) => `${k}（${v} 次）`).join('、')}`);
}

async function modelTasks(parent) {
  const resultsDir = path.join(dirs.repo, '.pipeline/results');
  fs.mkdirSync(resultsDir, { recursive: true });
  const tasks = [
    {
      key: 'design',
      label: 'laoshi 探针：方案设计',
      prompt: `你是需求开发流水线中的"方案设计"步骤。需求：修复 src/sum.js 中 sum 函数的错误，使其返回两数之和。
1. 阅读仓库，把简短的技术方案写到 docs/design.md（改什么、为什么、怎么验证）。不要修改代码。
2. 把结果写到 .pipeline/results/design.json，只包含一个 JSON 对象，字段：
   - has_runnable_service：boolean，这个项目是否有需要启动的服务
   - files：字符串数组，预计改动的文件
   - ui_change：boolean，改动是否改变使用者看到的界面
写完结果文件就结束。`,
      check: (j) => typeof j.has_runnable_service === 'boolean' && Array.isArray(j.files) && j.files.some((f) => f.includes('sum.js')) && typeof j.ui_change === 'boolean',
    },
    {
      key: 'implement',
      label: 'laoshi 探针：代码实现',
      prompt: `你是需求开发流水线中的"代码实现"步骤。按 docs/design.md 修复 src/sum.js，运行 npm test 确认通过。不要提交。
完成后把结果写到 .pipeline/results/implement.json，只包含一个 JSON 对象：{"status": "done"} 或 {"status": "partial"}。`,
      check: (j) => ['done', 'partial'].includes(j.status),
      extra: () => {
        try {
          execFileSync(process.execPath, ['--test', 'test/sum.test.js'], { cwd: dirs.repo, stdio: 'ignore' });
          return '测试通过';
        } catch {
          return '测试没有通过';
        }
      },
    },
    {
      key: 'code_review',
      label: 'laoshi 探针：代码评审',
      prompt: `你是需求开发流水线中的"代码评审"步骤。用 git diff 查看未提交的改动，对照 docs/design.md 评审。不要修改代码。
把结果写到 .pipeline/results/code_review.json，只包含一个 JSON 对象：{"verdict": "pass"} 或 {"verdict": "changes_required"}。`,
      check: (j) => ['pass', 'changes_required'].includes(j.verdict),
    },
  ];
  for (const t of tasks) {
    const started = Date.now();
    const r = await pluginOp({ op: 'spawn', parent, label: t.label, prompt: t.prompt, cwd: dirs.repo }, taskTimeoutMs);
    const minutes = ((Date.now() - started) / 60_000).toFixed(1);
    const file = path.join(resultsDir, `${t.key}.json`);
    let status = 'fail';
    let detail;
    if (!r) detail = `超过 ${taskTimeoutMs / 60_000} 分钟没有结束`;
    else if (!fs.existsSync(file)) detail = '没有写结果文件';
    else {
      try {
        const j = JSON.parse(fs.readFileSync(file, 'utf8'));
        status = t.check(j) ? 'pass' : 'fail';
        detail = `${status === 'pass' ? '结果文件符合约定' : '字段不符合约定'}：${JSON.stringify(j).slice(0, 160)}`;
      } catch (e) {
        detail = `结果文件不是合法 JSON：${e.message.slice(0, 80)}`;
      }
    }
    if (t.extra) detail += `；${t.extra()}`;
    // Self-test runs the flow only; the mock model cannot do the task.
    record(`P13-${t.key}`, `模型完成步骤任务：${t.label.replace('laoshi 探针：', '')}`, selfTest ? 'info' : status, `${selfTest ? '自测，只验证流程：' : ''}${detail}；用时 ${minutes} 分钟`);
  }
}

function writeReport(error) {
  const icon = { pass: '✓', fail: '✗', info: 'ℹ', skip: '–' };
  const lines = [
    '# dsh 内网摸底结果',
    '',
    `- 时间：${new Date().toISOString()}`,
    `- 模式：${selfTest ? '自测（模拟模型，只验证摸底包本身）' : '真实模型'}`,
    `- 平台：${facts.platform ?? process.platform}；shell：${facts.shell ?? '未知'}`,
    `- dsh：${facts.dsh ?? '未知'}；Node：${facts.node ?? process.version}；pnpm：${facts.pnpm ?? '未安装'}；安装占用：${facts.installSize ?? '未知'}`,
    `- 模型：协议 ${model.api}，地址 ${selfTest ? '本机模拟' : redactUrl(model.baseURL)}，模型 ID ${selfTest ? 'mock-1' : '（已省略）'}；凭据来自环境变量 ${model.keyVar}，没有写入任何文件`,
    `- 采用的兼容设置：${facts.compat ? JSON.stringify(facts.compat) : '无（没有成功的组合）'}`,
    `- 探针插件安装方式：${facts.pluginInstall ?? '未安装'}`,
    '',
    '| 编号 | 探针 | 结果 | 说明 |',
    '| --- | --- | --- | --- |',
    ...results.map((r) => `| ${r.id} | ${r.name} | ${icon[r.status]} ${r.status} | ${String(r.detail ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`),
    '',
  ];
  if (error) lines.push(`**中途停止：** ${error}`, '');
  lines.push(
    '## 回传说明',
    '',
    '请把整个输出目录打包回传（`logs/`、`report.md`、`results.json`、`repo/.pipeline/`、`repo/docs/`）。',
    '`dsh-home/` 中有会话记录，可以不回传；如需回传，请先确认里面没有敏感内容。',
    '`logs/host-*.log` 中的 token 只在本机 loopback 地址上有效，回传前也可以删掉 token 那一行。',
    '',
  );
  fs.writeFileSync(path.join(out, 'report.md'), lines.join('\n'));
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ selfTest, facts, results, error: error ?? null }, null, 2));
}

let failure = null;
try {
  await main();
} catch (e) {
  failure = e.message;
  console.error(`中途停止：${e.message}`);
} finally {
  await stopHost();
  if (mock) mock.kill();
  fs.rmSync(outside, { recursive: true, force: true });
  fs.rmSync(files.allow, { force: true });
  writeReport(failure);
  console.log(`\n报告：${path.join(out, 'report.md')}`);
}
process.exit(failure ? 1 : 0);
