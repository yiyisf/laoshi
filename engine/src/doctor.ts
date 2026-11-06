// req-kit doctor: read-only health check, run by the /laoshi-doctor skill.
//
//   node bin/req-doctor.mjs [--repo <dir>] [--no-project] [--offline] [--config <file>]
//
// Sections: installation (delegated to install.mjs --check), configuration,
// the platform daemon, and the current project with its pipelines.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { ConfigError, loadConfig, type PipelineConfig, PROJECT_CONFIG_FILE, projectConfigPath, resolveRelatedRepo } from "./config.js";
import { FlowError, loadFlow, PROJECT_FLOWS_DIR, readFlowFile } from "./flows.js";
import { gitInfo } from "./git.js";
import { codebaseOf, userOf } from "./identity.js";
import { defaultConfigPath, homeOf, KIT_ROOT, kitVersion } from "./locations.js";
import { PROJECT_DIR } from "./prompts.js";
import { readProjectServices, SERVICES_FILE } from "./builtin/project-services.js";
import { CAPABILITIES, type CapabilityName, type DoctorTools, type PlatformAdapter, SOURCE_LABELS, sourceOf } from "./platform.js";
import { adapterForFile, describeProfile, originFromEnv, wordsFor } from "./runtime-loader.js";
import { satisfies } from "./semver.js";
import { isAlive, STATE_VERSION } from "./state.js";
import { readRuns, runsFile } from "./records.js";
import { byRequirement, dedupe } from "./stats.js";
import { resolveCommand } from "./integrations.js";

const counts = { fail: 0, warn: 0 };
const SYMBOL = { ok: "✓", warn: "⚠", fail: "✗" } as const;

const report: DoctorTools["report"] = (level, text, fix) => {
  if (level !== "ok") counts[level] += 1;
  console.log(`${SYMBOL[level]} ${text}`);
  if (fix) console.log(`    修复：${fix}`);
};

function section(title: string): void {
  console.log(`\n## ${title}\n`);
}

/** Newer published version (npm view, from the configured npm registry), as an informational line; never counted as a problem. */
function newVersion(): void {
  const windows = process.platform === "win32";
  const result = spawnSync(windows ? "npm.cmd" : "npm", ["view", "laoshi@latest", "version"], {
    encoding: "utf8",
    windowsHide: true,
    shell: windows,
    timeout: 20_000,
  });
  const latest = result.status === 0 ? (result.stdout ?? "").trim().split("\n")[0] : "";
  const current = kitVersion();
  if (!latest) {
    const reason = (result.stderr ?? "").split("\n").find((l) => /\bE\d{3}\b|ENOTFOUND|ETIMEDOUT|ECONNREFUSED|404/.test(l))?.replace(/^npm (error|ERR!)\s*/, "").trim();
    console.log(`· 无法检查是否有新版本（${reason || "网络不通、超时或 npm 源上还没有 laoshi"}），不影响使用`);
  } else if (latest !== current && newer(latest, current)) {
    console.log(`↑ 有新版本 ${latest}（当前 ${current}）。升级：laoshi upgrade`);
  } else {
    report("ok", `已是最新版本 ${current}`);
  }
}

/** a > b in semver order (prereleases before their release). */
function newer(a: string, b: string): boolean {
  const parse = (v: string) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v);
    return m ? { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null } : null;
  };
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] > pb.nums[i];
  if (pa.pre === pb.pre) return false;
  if (pa.pre === null) return true;
  if (pb.pre === null) return false;
  return pa.pre.localeCompare(pb.pre, "en", { numeric: true }) > 0;
}

function installation(offline: boolean): void {
  section("安装");
  const result = spawnSync(process.execPath, [path.join(KIT_ROOT, "bin", "install.mjs"), "--check"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trimEnd();
  // Only the findings (and their fixes): the check's own headings and next steps belong to `laoshi install`.
  let keep = false;
  for (const line of out.split("\n")) {
    if (/^[✓⚠✗·] /.test(line)) keep = true;
    else if (!/^\s+修复：/.test(line)) keep = false;
    if (!keep) continue;
    if (line.startsWith("✗")) counts.fail += 1;
    else if (line.startsWith("⚠")) counts.warn += 1;
    console.log(line);
  }
  if (result.status !== 0 && !/^[✗]/m.test(out)) report("fail", `安装检查没有完成（laoshi install --check 退出码 ${result.status}）`, "运行 laoshi install --check 查看");
  if (!offline) newVersion();
}

function configuration(configPath: string, repo: string | null): PipelineConfig | null {
  section("配置");
  if (!fs.existsSync(configPath)) {
    report("fail", `找不到本机配置 ${configPath}`, "运行 laoshi install --platform <平台> 生成");
    return null;
  }
  try {
    const loaded = loadConfig(configPath, repo ?? undefined);
    report("ok", `配置：${loaded.sources.join(" → ")}`);
    for (const note of loaded.notes) report("warn", note);
    if (loaded.ignored.length > 0) {
      report("warn", `${loaded.ignored.join("、")} 只能在本机配置中设置，已被忽略`, "从团队或项目配置中删除这些字段");
    }
    const { builder, reviewer } = loaded.config.agents;
    report("ok", `builder：${describeProfile(loaded.config, builder)}；reviewer：${describeProfile(loaded.config, reviewer)}`);
    report("ok", `默认档位：${loaded.config.defaultProfile}`);
    const panel = loaded.config.reviewPanel;
    if (panel.enabled) {
      report("ok", `评审小组：${panel.members.length} 位成员，用于 ${panel.steps.join("、")}（${panel.profiles.join("、")}档，首轮）`);
      if (panel.members.length === 1) report("warn", "评审小组只有 1 位成员，效果接近单人评审", "建议配置 2–3 位，使用不同厂商的模型");
    }
    const proposals = loaded.config.designProposals;
    if (proposals.enabled) {
      report("ok", `方案提案：${proposals.members.length || "builder 和 reviewer 各"} ${proposals.members.length ? "位成员" : "一份"}，用于 ${proposals.profiles.join("、")}档`);
    }
    if (repo) {
      const { checks, relatedRepos } = loaded.config;
      if (checks.length > 0) {
        report("ok", `质量门：${checks.length} 项检查（${checks.map((c) => c.name).join("、")}），流水线在写代码和修复的步骤之后自己运行`);
        for (const c of checks) {
          if (c.cwd && !fs.existsSync(path.join(repo, c.cwd))) report("warn", `检查「${c.name}」的目录 ${c.cwd} 不存在`, `修改 ${path.basename(projectConfigPath(repo))} 中的 checks`);
        }
      } else {
        report(
          "warn",
          "没有配置质量门的检查（checks）：流水线不会自己运行 lint、测试等检查，只能依靠各步骤自己的记录",
          "在项目根目录的对话中运行 /laoshi-setup，它会把实际跑通的检查命令写进项目配置",
        );
      }
      for (const r of relatedRepos) {
        const dir = resolveRelatedRepo(r, repo);
        if (fs.existsSync(dir)) report("ok", `关联仓库（只读参考）：${r.name} → ${dir}`);
        else report("warn", `关联仓库「${r.name}」不在这台机器上：${dir}`, "把它克隆到这个位置；或修改 relatedRepos 中的路径（相对项目目录，团队约定把相关仓库放在同一个上级目录最方便）");
      }
    }
    const push = loaded.config.push;
    if (push.enabled) {
      report("ok", `推送分支：${push.remote}/${push.branchPrefix}<卡号>（只对从卡片开始的需求）`);
      const mr = push.mergeRequest;
      if (mr) {
        if (mr.check && mr.check.length > 0) {
          const { file, prefix } = resolveCommand(mr.command);
          const r = spawnSync(file, [...prefix, ...mr.check], { encoding: "utf8", timeout: 30_000, windowsHide: true, cwd: repo ?? undefined });
          if (r.status === 0) report("ok", `草稿合并请求：${mr.command} 已登录`);
          else report("warn", `草稿合并请求：${mr.command} ${mr.check.join(" ")} 没有通过（${(r.error?.message ?? `${r.stderr ?? ""}${r.stdout ?? ""}`).trim().split("\n").slice(-1)[0] || `退出码 ${r.status}`}）`, `在这台机器上登录 ${mr.command}（例如 ${mr.command} auth login），否则分支照常推送，但不会建合并请求`);
        } else report("ok", `草稿合并请求：推送后用 ${mr.command} 建（没有配置 check，无法检查是否已登录）`);
      }
    }
    const required = loaded.config.requiredVersion;
    if (required) {
      if (satisfies(kitVersion(), required)) report("ok", `版本要求 ${required}：当前 ${kitVersion()} 满足`);
      else report("warn", `团队或项目要求 laoshi ${required}，当前为 ${kitVersion()}`, "升级：npm install -g laoshi@<版本>，然后 laoshi install");
    }
    budgetUsage(loaded.config);
    return loaded.config;
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    report("fail", error.message, `编辑 ${configPath}`);
    return null;
  }
}

/** 1.13: a token budget only works when the agents report usage; this machine's recent requirements say whether they do. */
function budgetUsage(config: PipelineConfig): void {
  if (config.budget.tokens === null) return;
  let recent: ReturnType<typeof byRequirement> = [];
  try {
    recent = byRequirement(dedupe(readRuns(runsFile()))).slice(-3);
  } catch {
    return;
  }
  if (recent.length === 0) return;
  if (recent.every((q) => q.inputTokens === null && q.outputTokens === null)) {
    report("warn", `设了 token 预算（每个需求 ${config.budget.tokens}），但本机最近 ${recent.length} 个需求的 agent 都没有报告 token 用量，预算不会起作用`, "换用会报告用量的 agent；不需要预算时把 budget.tokens 设为 null");
  } else report("ok", "token 预算：agent 会报告用量");
}

/** Informational line: never counted as a problem. */
function info(text: string): void {
  console.log(`· ${text}`);
}

/** Files whose change usually means the build, test or start commands changed. */
const BUILD_FILES = [
  "package.json",
  "pnpm-workspace.yaml",
  "Makefile",
  "justfile",
  "docker-compose.yml",
  "compose.yaml",
  "pyproject.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Cargo.toml",
];

function lastCommitTime(repo: string, files: string[]): number | null {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%ct", "--", ...files], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out ? Number(out) * 1000 : null;
  } catch {
    return null;
  }
}

function verifyInstructions(repo: string, isRepo: boolean): void {
  const rel = `${PROJECT_DIR}/verify.md`;
  const file = path.join(repo, PROJECT_DIR, "verify.md");
  if (!fs.existsSync(file)) {
    report("warn", "没有验证方法说明，服务启动和功能验证步骤需要自己摸索，耗时更长、结果更不稳定", "在项目根目录的对话中运行 /laoshi-setup");
    return;
  }
  if (!isRepo) {
    report("ok", `验证方法：${rel}`);
    return;
  }
  const verifyTime = lastCommitTime(repo, [path.join(PROJECT_DIR, "verify.md")]);
  const buildFiles = BUILD_FILES.filter((f) => fs.existsSync(path.join(repo, f)));
  const buildTime = buildFiles.length > 0 ? lastCommitTime(repo, buildFiles) : null;
  if (verifyTime === null) {
    report("warn", `验证方法 ${rel} 还没有提交，其他工作区看不到它`, "确认内容后提交，并合并到主分支");
  } else if (buildTime !== null && buildTime > verifyTime) {
    const day = (ms: number) => new Date(ms).toLocaleDateString("zh-CN");
    report("warn", `验证方法可能过时：构建文件在 ${day(buildTime)} 改过，验证方法最后更新于 ${day(verifyTime)}`, "运行 /laoshi-setup 更新，或确认内容仍然准确");
  } else {
    report("ok", `验证方法：${rel}`);
  }
}

interface RawState {
  version?: number;
  status?: string;
  mode?: string;
  updatedAt?: string;
  pid?: number;
  stopReason?: string | null;
}

function projectFlows(repo: string, config: PipelineConfig | null): void {
  const dir = path.join(repo, PROJECT_FLOWS_DIR);
  if (fs.existsSync(dir)) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        const flow = readFlowFile(full);
        report("ok", `自定义流程 ${PROJECT_FLOWS_DIR}/${f}：${flow.title}（${flow.nodes.length} 项顶层节点）`);
      } catch (e) {
        report("fail", `自定义流程 ${PROJECT_FLOWS_DIR}/${f} 无效：${(e as Error).message}`, `修正 ${full} 或运行 laoshi flow validate ${full}`);
      }
    }
  }
  const activeFlow = config?.orchestration?.flow;
  if (activeFlow && activeFlow !== "default") {
    try {
      const loaded = loadFlow(activeFlow, repo);
      if (loaded) report("ok", `配置的默认流程 "${activeFlow}"：${loaded.title}（来自 ${loaded.source}）`);
    } catch (e) {
      if (e instanceof FlowError) report("fail", e.message, "修正 orchestration.flow 配置，或用 laoshi flow init 创建该流程");
    }
  }
}

function project(repo: string, adapter: PlatformAdapter, config: PipelineConfig | null = null): void {
  section(`项目：${repo}`);
  const git = gitInfo(repo);
  if (!git.isRepo) {
    report("warn", "不是 git 仓库：流水线可以运行，但不会提交代码");
  } else if (git.detached) {
    report("warn", "当前没有处在任何分支上（detached HEAD），流水线会拒绝启动", "切换到需求的工作分支");
  } else if (git.branch && git.protectedBranches.includes(git.branch)) {
    report("warn", `当前在默认分支 ${git.branch} 上：新需求会被建议改用独立的 worktree 工作区`, wordsFor({ platform: { adapter: adapter.id } }).newWorkspace ?? "启动时加 --worktree，让流水线为需求新建 worktree 工作区");
  } else {
    report("ok", `当前分支：${git.branch}`);
  }
  const projectConfig = projectConfigPath(repo);
  if (fs.existsSync(projectConfig)) report("ok", `项目配置：${path.basename(projectConfig)}${path.basename(projectConfig) === PROJECT_CONFIG_FILE ? "" : `（旧名，可以改名为 ${PROJECT_CONFIG_FILE}）`}`);
  projectFlows(repo, config);
  const notes = path.join(repo, PROJECT_DIR, "project-notes.md");
  if (fs.existsSync(notes)) report("ok", `项目说明：${PROJECT_DIR}/project-notes.md`);
  else report("warn", "没有项目说明（包管理工具、不能改的目录、提交格式等），步骤 agent 需要自己摸索", "在项目根目录的对话中运行 /laoshi-setup");
  verifyInstructions(repo, git.isRepo);
  adapter.doctorProject?.({ repo, isRepo: git.isRepo, tools: { report, info } });
  if (sourceOf(adapter, "services") === "builtin" || sourceOf(adapter, "worktree") === "builtin") builtinServicesFile(repo, git.isRepo);
  if (!fs.existsSync(path.join(repo, "GLOSSARY.md")) && fs.existsSync(path.join(repo, "CONTEXT.md"))) {
    report("ok", "术语表为旧名 CONTEXT.md：会继续读取，新术语写入 GLOSSARY.md");
  } else if (fs.existsSync(path.join(repo, "GLOSSARY.md"))) {
    report("ok", "术语表：GLOSSARY.md");
  } else {
    report("warn", "没有术语表 GLOSSARY.md：需求方的说法和代码里的叫法对不上时容易做偏", "在项目根目录的对话中运行 /laoshi-setup，它会整理主要的业务词和代码中的名字");
  }

  const featuresDir = path.join(repo, "docs", "features");
  if (!fs.existsSync(featuresDir)) {
    report("ok", "还没有需求（docs/features 不存在）");
    return;
  }
  let found = 0;
  for (const name of fs.readdirSync(featuresDir).sort()) {
    const file = path.join(featuresDir, name, ".pipeline", "state.json");
    if (!fs.existsSync(file)) continue;
    found += 1;
    let raw: RawState;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8")) as RawState;
    } catch (error) {
      report("fail", `${name}：状态文件无法读取：${(error as Error).message}`, `检查 ${file}`);
      continue;
    }
    const version = typeof raw.version === "number" ? raw.version : 1;
    if (version > STATE_VERSION) {
      report("fail", `${name}：状态文件由更新版本的 laoshi 写入（第 ${version} 版）`, "升级 laoshi，或恢复同目录下的 state.json.bak-v* 备份");
      continue;
    }
    const migrate = version < STATE_VERSION ? `（格式第 ${version} 版，下次继续时会自动迁移并保留备份）` : "";
    const label = `docs/features/${name}`;
    switch (raw.status) {
      case "running":
        if (raw.mode === "chat") {
          const staleHours = raw.updatedAt ? (Date.now() - Date.parse(String(raw.updatedAt))) / 3_600_000 : 0;
          if (staleHours > 2) {
            report("warn", `${label}：会话内编排进行中，但已超过 ${Math.floor(staleHours)} 小时没有新记录${migrate}`, `在对话中运行 laoshi run status --feature ${label} 查看待执行的步骤，或用 laoshi run next --feature ${label} 继续`);
          } else {
            report("ok", `${label}：会话内编排进行中（模式 B）${migrate}`);
          }
        } else if (raw.pid && isAlive(raw.pid)) report("ok", `${label}：运行中（进程 ${raw.pid}）${migrate}`);
        else report("warn", `${label}：状态为运行中，但进程已不在${migrate}`, `在该需求的对话中对 /laoshi 说"继续开发"，或执行 start-pipeline --feature ${label} --resume`);
        break;
      case "waiting_for_approval":
        report("warn", `${label}：方案等待需求方确认${migrate}`, "在该需求的对话中看 preview.md 并确认（或修改需求）");
        break;
      case "waiting_for_business":
        report("warn", `${label}：等待需求方决定${migrate}`, "在该需求的对话中回答问题、更新 spec 后继续");
        break;
      case "failed":
        report("warn", `${label}：已中断：${raw.stopReason ?? "原因未记录"}${migrate}`, `查看 ${label}/.pipeline/pipeline.log，解决后继续`);
        break;
      case "completed":
        report("ok", `${label}：已完成${migrate}`);
        break;
      default:
        report("warn", `${label}：未知状态 ${raw.status}`);
    }
  }
  if (found === 0) report("ok", "没有运行过流水线的需求");
}

/** laoshi M2c: the install root, who this is for, and the codebase (ADR 0007). */
function identity(repo: string | null): void {
  section("安装根与身份");
  const home = homeOf();
  const how = { LAOSHI_HOME: "环境变量 LAOSHI_HOME", REQ_KIT_HOME: "环境变量 REQ_KIT_HOME（req-kit 的旧名，可以改用 LAOSHI_HOME）", default: "默认位置", legacy: "req-kit 的旧目录（还没有 ~/.laoshi）" }[home.source];
  report("ok", `安装根：${home.dir}（${how}）`);
  report("ok", `使用者：${userOf()}${process.env.LAOSHI_USER?.trim() ? "（环境变量 LAOSHI_USER）" : ""}`);
  if (repo) {
    const c = codebaseOf(repo);
    report("ok", `代码库：${c.root}${c.remote ? `（${c.remote}）` : "（没有 origin 远程地址）"}`);
  }
}

/** .laoshi/services.json, for laoshi's builtin services and worktree setup (M2b). */
function builtinServicesFile(repo: string, isRepo: boolean): void {
  let defs;
  try {
    defs = readProjectServices(repo);
  } catch (error) {
    report("fail", (error as Error).message, `修正 ${SERVICES_FILE}`);
    return;
  }
  if (!defs) {
    info(`没有 ${SERVICES_FILE}。可选：写上新工作区的准备命令（setup）和服务（services），laoshi 会在新建 worktree 时准备环境，并为验证启动服务、分配端口`);
    return;
  }
  const names = Object.keys(defs.services);
  report("ok", `${SERVICES_FILE}：${defs.setup.length ? `新建 worktree 时运行 ${defs.setup.length} 条准备命令；` : ""}服务 ${names.length ? names.join("、") : "（无）"}（由 laoshi 启动）`);
  for (const [name, s] of Object.entries(defs.services)) {
    if (s.port === undefined && !/\{PORT\}|PORT/.test(s.command)) info(`服务 ${name} 的命令里没有 {PORT}：laoshi 分配的端口通过环境变量 PORT 给出，服务要读取它，否则几个工作区同时运行时会端口冲突`);
  }
  if (!isRepo) return;
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", SERVICES_FILE], { cwd: repo, stdio: "ignore" });
  } catch {
    report("warn", `${SERVICES_FILE} 还没有提交：新建的 worktree 读取的是已提交的版本`, `提交 ${SERVICES_FILE}`);
  }
}

/** Which optional capabilities this platform has, and who provides them (ADR 0008). */
function capabilities(adapter: PlatformAdapter): void {
  section(`平台能力：${adapter.displayName}`);
  for (const [name, { label }] of Object.entries(CAPABILITIES)) {
    const source = sourceOf(adapter, name as CapabilityName);
    console.log(`${source === "none" ? "–" : "·"} ${label}：${SOURCE_LABELS[source]}${source === "none" ? "（不可用，相关功能会跳过或提示）" : ""}`);
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      repo: { type: "string" },
      config: { type: "string" },
      "no-project": { type: "boolean", default: false },
      offline: { type: "boolean", default: false },
    },
  });
  const configPath = values.config ? path.resolve(values.config) : defaultConfigPath();
  const adapter = adapterForFile(configPath);
  const repo = values["no-project"] ? null : path.resolve(values.repo ?? originFromEnv(process.env, adapter)?.cwd ?? process.cwd());

  console.log(`laoshi ${kitVersion()} 体检（程序目录 ${KIT_ROOT}）`);
  identity(repo);
  installation(values.offline ?? false);
  const config = configuration(configPath, repo);
  section(adapter.doctorTitle);
  if (values.offline) console.log("（已跳过：--offline）");
  else if (adapter.doctorPlatform) await adapter.doctorPlatform({ config, configPath, tools: { report, info } });
  else console.log("（没有要检查的项目）");
  capabilities(adapter);
  if (repo) project(repo, adapter, config);

  console.log("");
  if (counts.fail === 0 && counts.warn === 0) console.log("结论：全部正常。");
  else console.log(`结论：${counts.fail} 项必须处理（✗），${counts.warn} 项建议处理（⚠）。`);
  return counts.fail === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: Error) => {
    console.error(`体检出错：${error.message}`);
    process.exit(2);
  },
);
