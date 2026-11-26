#!/usr/bin/env node
// The one-step install from npm, as paseo-req-kit does it: a machine that can reach an npm registry
// (the public one or a company mirror) needs nothing else.
//
//   npx -y @yiyi_zhang/laoshi@latest install --platform dsh
//   npx -y --registry=https://npm.example.internal/ @yiyi_zhang/laoshi@latest install --platform dsh
//   laoshi upgrade [--registry <url>]                    (the same with @yiyi_zhang/laoshi@latest)
//
// Steps: check Node.js, npm and git; use (and save) the npm registry; npm install -g this version
// (into <install root>/npm when the global directory is not writable); then run the installed
// copy's `laoshi install` (bin/install.mjs) with the remaining options. npx's copy is temporary,
// so nothing may point at it. Running it again upgrades in place. On Windows npm runs through
// cmd.exe, never PowerShell.
//
// Tests: LAOSHI_NPM is a script standing in for npm.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = JSON.parse(fs.readFileSync(path.join(KIT, "package.json"), "utf8"));
const WINDOWS = process.platform === "win32";
const DEFAULT_REGISTRY = "https://registry.npmjs.org/";

class Abort extends Error {}
const die = (text) => {
  throw new Abort(text);
};
const say = (text) => console.log(text);
const ok = (text) => console.log(`✓ ${text}`);
const warn = (text) => console.log(`⚠ ${text}`);
const step = (title) => console.log(`\n## ${title}\n`);

/** Bootstrap options; everything else goes to `laoshi install`. */
export function parseArgs(argv) {
  const opts = { registry: null, saveRegistry: true, spec: null, allowRunning: false, help: false, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = (name) => {
      if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) die(`${name} 后面要写值，例如 ${name} https://npm.example.internal/`);
      return argv[++i];
    };
    if (a === "--registry") opts.registry = value("--registry");
    else if (a.startsWith("--registry=")) opts.registry = a.slice("--registry=".length);
    else if (a === "--spec") opts.spec = value("--spec");
    else if (a.startsWith("--spec=")) opts.spec = a.slice("--spec=".length);
    else if (a === "--no-save-registry") opts.saveRegistry = false;
    else if (a === "--allow-running") opts.allowRunning = true;
    else if (a === "-h" || a === "--help") opts.help = true;
    else opts.rest.push(a);
  }
  if (opts.registry !== null && !/^https?:\/\/\S+$/.test(opts.registry)) die(`--registry 要写完整的地址，例如 https://npm.example.internal/（现在是 ${opts.registry || "空"}）`);
  return opts;
}

export const sameRegistry = (a, b) => String(a ?? "").trim().replace(/\/+$/, "").toLowerCase() === String(b ?? "").trim().replace(/\/+$/, "").toLowerCase();

/** The environment for npm: without the settings npx adds for itself; the registry set explicitly. */
function childEnv(registry) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    const k = key.toLowerCase();
    if (["npm_config_package", "npm_config_yes", "npm_config_call", "npm_config_local_prefix", "npm_command", "npm_package_json", "npm_config_registry"].includes(k) || k.startsWith("npm_lifecycle_")) delete env[key];
  }
  if (registry) env.npm_config_registry = registry;
  return env;
}
let ENV = childEnv(null);

const quoteForCmd = (args) => args.map((a) => (/[\s&()^|<>"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a));

/** Runs a command; on Windows the npm.cmd shim needs cmd.exe (the shell node uses there). */
function run(command, args, { inherit = false, env = ENV, timeout = 900_000 } = {}) {
  const shell = WINDOWS && !/\.exe$/i.test(command);
  const r = spawnSync(command, shell ? quoteForCmd(args) : args, { encoding: "utf8", windowsHide: true, shell, env, timeout, stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"] });
  return { status: r.error ? null : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function npm(args, options = {}) {
  const fake = process.env.LAOSHI_NPM?.trim();
  if (fake) return run(process.execPath, [fake, ...args], options);
  return run(WINDOWS ? "npm.cmd" : "npm", args, options);
}
const writable = (dir) => {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const WAITING_LABELS = {
  waiting_for_approval: "等待确认方案",
  waiting_for_business: "等待需求方回复",
  phase_done: "开发阶段已完成，等待测试验证",
};

function isZombie(pid) {
  if (process.platform !== "linux") return false;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z");
  } catch {
    return false;
  }
}

function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
  } catch (error) {
    return error?.code === "EPERM";
  }
  return !isZombie(pid);
}

function engineAlive(state) {
  if (!state || typeof state.pid !== "number") return false;
  if (state.host && state.host !== os.hostname()) return false;
  return isAlive(state.pid);
}

export function resolveHome(restArgs = [], env = process.env, kit = KIT) {
  for (let i = 0; i < restArgs.length; i++) {
    const a = restArgs[i];
    if (a.startsWith("--home=")) {
      const val = a.slice("--home=".length).trim();
      if (val) return path.resolve(val);
    } else if (a === "--home" && i + 1 < restArgs.length && !restArgs[i + 1].startsWith("--")) {
      return path.resolve(restArgs[i + 1]);
    }
  }
  const laoshiEnv = env.LAOSHI_HOME?.trim();
  if (laoshiEnv) return path.resolve(laoshiEnv);
  const legacyEnv = env.REQ_KIT_HOME?.trim();
  if (legacyEnv) return path.resolve(legacyEnv);
  const programRoot = /^(.*)[\\/]npm[\\/](?:lib[\\/])?node_modules[\\/]/.exec(kit)?.[1] ?? null;
  if (programRoot && fs.existsSync(path.join(programRoot, "config.json"))) return programRoot;
  const userHome = os.homedir();
  const preferred = path.join(userHome, ".laoshi");
  const legacy = path.join(userHome, ".req-kit");
  if (!fs.existsSync(preferred) && fs.existsSync(path.join(legacy, "config.json"))) return legacy;
  return preferred;
}

/** Lists active running and waiting requirements recorded under the install root (ADR 0007 decision 7). */
export function findActiveRequirements(home) {
  const running = [];
  const waiting = [];
  const indexDir = path.join(home, "index");
  if (!fs.existsSync(indexDir)) return { running, waiting };
  let files = [];
  try {
    files = fs.readdirSync(indexDir).filter((n) => n.endsWith(".json"));
  } catch {
    return { running, waiting };
  }
  for (const name of files) {
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(path.join(indexDir, name), "utf8"));
    } catch {
      continue;
    }
    if (!entry || typeof entry.repo !== "string" || typeof entry.featureDir !== "string") continue;
    const stateFile = path.join(entry.repo, entry.featureDir, ".pipeline", "state.json");
    let state;
    try {
      state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    } catch {
      continue;
    }
    if (!state || typeof state.status !== "string") continue;
    const project = entry.project || path.basename(entry.sourceRepo || entry.repo);
    if (state.status === "running" && engineAlive(state)) {
      const history = Array.isArray(state.history) ? state.history : [];
      const activeStep = [...history].reverse().find((h) => h && h.outcome === "running");
      const step = activeStep?.key || activeStep?.stepId || state.phase || "运行中";
      running.push({ project, repo: entry.repo, featureDir: entry.featureDir, pid: state.pid, step });
    } else if (state.status in WAITING_LABELS) {
      waiting.push({ project, repo: entry.repo, featureDir: entry.featureDir, status: state.status });
    }
  }
  return { running, waiting };
}

const HELP = `用法：npx -y [--registry=<npm 源>] @yiyi_zhang/laoshi@latest install --platform <平台> [安装选项]

  --registry <地址>     这次安装用的 npm 源（公司内网的镜像），默认保存为本机的 npm 源
  --no-save-registry    只这次用，不保存
  --spec <包>           安装哪个版本，默认是正在运行的这个（如 @yiyi_zhang/laoshi@0.1.1）
  --allow-running       发现有正在运行的流水线时，仍继续原地升级（默认先列出并中止）
其余选项交给 laoshi install（--platform、--home、--target、--force、平台的选项，见 laoshi install --help）。`;

export async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    say(HELP);
    return 0;
  }
  const spec = opts.spec ?? `${PKG.name}@${PKG.version}`;
  say(`安装 laoshi（${spec}）`);

  step("检查环境");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 19)) die(`需要 Node.js 22.19 或更新版本，当前是 ${process.version}`);
  ok(`Node.js ${process.version}`);
  const npmVersion = npm(["--version"], { timeout: 60_000 });
  if (npmVersion.status !== 0) die("没有找到 npm（通常随 Node.js 一起安装）");
  ok(`npm ${npmVersion.stdout.trim() || "?"}`);

  const home = resolveHome(opts.rest);
  const { running, waiting } = findActiveRequirements(home);
  if (running.length > 0 || waiting.length > 0) {
    step("进行中的需求");
    for (const w of waiting) {
      say(`· ${w.project} / ${w.featureDir}（${WAITING_LABELS[w.status] ?? w.status}，不受升级影响）`);
    }
    for (const r of running) {
      warn(`${r.project} / ${r.featureDir}（步骤：${r.step}，进程 ${r.pid}）`);
    }
    if (running.length > 0) {
      if (!opts.allowRunning) {
        die(
          `安装根 ${home} 下有 ${running.length} 个正在运行的流水线，原地升级会替换正在使用的程序文件。请先等待结束或执行 laoshi stop <需求>；确认仍要继续请加 --allow-running`,
        );
      }
      warn("已按 --allow-running 继续原地升级，请关注上述运行中的流水线");
    }
  }

  step("npm 源");
  // `npx --registry=…` passes it on as npm_config_registry; --registry says it explicitly.
  const wanted = opts.registry ?? process.env.npm_config_registry?.trim() ?? process.env.NPM_CONFIG_REGISTRY?.trim() ?? null;
  const savedResult = npm(["config", "get", "registry"], { env: childEnv(null), timeout: 60_000 });
  const saved = savedResult.status === 0 ? savedResult.stdout.trim() || DEFAULT_REGISTRY : DEFAULT_REGISTRY;
  let registry = saved;
  if (wanted && !sameRegistry(wanted, saved)) {
    registry = wanted;
    if (opts.saveRegistry && npm(["config", "set", "registry", wanted], { env: childEnv(null), timeout: 60_000 }).status === 0) ok(`已把本机的 npm 源设为 ${wanted}（原来是 ${saved}）。以后 laoshi upgrade 也从这里取`);
    else ok(`这次安装使用 ${wanted}（本机的 npm 源仍是 ${saved}）`);
  } else ok(`npm 源：${saved}`);
  ENV = childEnv(registry);
  if (sameRegistry(registry, DEFAULT_REGISTRY)) say("  公司内网请改用镜像：npx -y --registry=<镜像地址> @yiyi_zhang/laoshi@latest install");

  step(`安装 ${spec}`);
  const found = npm(["view", spec, "version"], { timeout: 120_000 });
  if (found.status !== 0 || !found.stdout.trim()) die(`npm 源 ${registry} 上找不到 ${spec}。镜像可能还没有同步这个版本，稍后再试；或用 --registry 换一个 npm 源`);
  let prefix = npm(["prefix", "-g"], { timeout: 60_000 }).stdout.trim();
  let ownPrefix = false;
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (!prefix || (!isRoot && !writable(prefix))) {
    // A system Node.js (e.g. /usr/local) needs sudo for global installs; use a directory of our own.
    const home = path.resolve(process.env.LAOSHI_HOME ?? path.join(os.homedir(), ".laoshi"));
    prefix = path.join(home, "npm");
    ownPrefix = true;
    fs.mkdirSync(prefix, { recursive: true });
    warn(`npm 的全局目录不可写，改装到 ${prefix}（不需要 sudo）`);
  }
  const prefixArgs = ownPrefix ? ["--prefix", prefix] : [];
  if (npm(["install", "-g", ...prefixArgs, spec], { inherit: true }).status !== 0) die("npm 安装失败（见上面的输出）。公司内网请确认 npm 源是镜像地址（--registry）");
  const npmRoot = npm(["root", "-g", ...prefixArgs], { timeout: 60_000 }).stdout.trim();
  const copy = path.join(npmRoot, PKG.name);
  const installer = path.join(copy, "bin", "install.mjs");
  if (!fs.existsSync(installer)) die(`安装后没有找到 ${installer}`);
  const version = JSON.parse(fs.readFileSync(path.join(copy, "package.json"), "utf8")).version;
  ok(`已安装 laoshi ${version} 到 ${copy}`);
  const binDir = WINDOWS ? prefix : path.join(prefix, "bin");
  const onPath = (process.env.PATH ?? "").split(path.delimiter).some((p) => p && path.resolve(p) === path.resolve(binDir) && !p.split(/[\\/]/).includes("_npx"));
  if (!onPath) warn(`laoshi 命令在 ${binDir}，它不在 PATH 中：把它加进 PATH，或使用安装根 bin 目录中的 laoshi（见下面的"命令"一节）`);

  // From here on, the installed copy: npx's copy goes away.
  const r = spawnSync(process.execPath, [installer, ...opts.rest], { stdio: "inherit", windowsHide: true, env: childEnv(registry) });
  return r.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Abort ? `✗ ${error.message}` : error);
      process.exit(1);
    },
  );
}
