// `laoshi diagnose <需求> [--out <目录>]`: collects a redacted diagnostic bundle for a requirement
// (state, pipeline log tail, step results, step agent outputs/events, sanitized config, environment)
// so users can hand one clean folder to maintainers for troubleshooting.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { locate } from "./api.js";
import { DEFAULT_CONFIG, loadConfig, type PipelineConfig } from "./config.js";
import { defaultConfigPath, kitHome, kitVersion } from "./locations.js";
import { type PipelineState, readState, statePath } from "./state.js";

const MAX_LOG_BYTES = 200 * 1024;
const MAX_AGENT_FILE_BYTES = 64 * 1024;

/** Redacts credentials, tokens, private keys, and secret environment variables from diagnostic text. */
export function redactText(text: string): string {
  return text
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "-----BEGIN PRIVATE KEY-----\n***REDACTED***\n-----END PRIVATE KEY-----")
    .replace(/(authorization["']?\s*[:=]\s*["']?(?:bearer\s+|basic\s+)?)[^\s"',}]+/gi, "$1***")
    .replace(/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1***")
    .replace(/((?:token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|credential|cookie)[A-Za-z0-9_.-]*["']?\s*[:=]\s*["']?)[^\s"',;)}]{4,}/gi, "$1***")
    .replace(/\b([A-Z][A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*=)\S+/g, "$1***")
    .replace(/\b(sk-[A-Za-z0-9_-]{16,}|gh[pous]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{12,})\b/g, "***");
}

function readTail(file: string, maxBytes: number): string | null {
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (!stat.isFile()) return null;
  if (stat.size <= maxBytes) return fs.readFileSync(file, "utf8");
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
    return `...[已截断前 ${stat.size - maxBytes} 字节]...\n${buf.toString("utf8")}`;
  } finally {
    fs.closeSync(fd);
  }
}

function writeRedacted(dest: string, content: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, redactText(content), "utf8");
}

function sanitizeJson(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(sanitizeJson);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (/(token|secret|password|passwd|api[_-]?key|access[_-]?key|private[_-]?key|credential|cookie)/i.test(k) && typeof v === "string" && v.length > 0) {
        out[k] = "***";
      } else {
        out[k] = sanitizeJson(v);
      }
    }
    return out;
  }
  return value;
}

function collectAgentIds(state: PipelineState | null): string[] {
  if (!state) return [];
  const ids = new Set<string>();
  for (const step of state.history ?? []) {
    if (step.agentId) ids.add(step.agentId);
  }
  if (state.waitingPermission?.agentId) ids.add(state.waitingPermission.agentId);
  return [...ids];
}

export interface DiagnoseOptions {
  repo: string;
  featureDir: string;
  home?: string;
  config?: PipelineConfig;
  configSources?: string[];
  outDir?: string;
  now?: Date;
}

export interface DiagnoseResult {
  outDir: string;
  files: string[];
  agentCount: number;
}

/** Collects a redacted diagnostic bundle directory for one requirement. */
export function collectDiagnoseBundle(options: DiagnoseOptions): DiagnoseResult {
  const home = options.home ?? kitHome();
  const featureName = path.basename(options.featureDir);
  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outDir = path.resolve(options.outDir ?? path.join(home, "diagnose", `${featureName}-${stamp}`));
  fs.mkdirSync(outDir, { recursive: true });

  const files: string[] = [];
  const record = (rel: string, content: string) => {
    writeRedacted(path.join(outDir, rel), content);
    files.push(rel);
  };

  const pipelineDir = path.join(options.repo, options.featureDir, ".pipeline");
  const stateFile = statePath(options.repo, options.featureDir);
  const state = readState(stateFile);
  if (fs.existsSync(stateFile)) {
    record("state.json", fs.readFileSync(stateFile, "utf8"));
  }

  const logTail = readTail(path.join(pipelineDir, "pipeline.log"), MAX_LOG_BYTES);
  if (logTail !== null) {
    record("pipeline.log", logTail);
  }

  const resultsDir = path.join(pipelineDir, "results");
  if (fs.existsSync(resultsDir) && fs.statSync(resultsDir).isDirectory()) {
    for (const entry of fs.readdirSync(resultsDir).sort()) {
      const full = path.join(resultsDir, entry);
      if (fs.statSync(full).isFile() && entry.endsWith(".json")) {
        record(path.posix.join("results", entry), fs.readFileSync(full, "utf8"));
      }
    }
  }

  const adapter = state?.adapter?.id ?? options.config?.platform?.adapter ?? "default";
  const agentIds = collectAgentIds(state);
  let agentCount = 0;
  const agentsRoot = path.join(home, adapter, "agents");
  if (fs.existsSync(agentsRoot) && fs.statSync(agentsRoot).isDirectory()) {
    for (const id of agentIds) {
      const dir = path.join(agentsRoot, id);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      agentCount++;
      for (const entry of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, entry);
        if (!fs.statSync(full).isFile()) continue;
        if (entry === "agent.json" || entry === "decision.json" || entry.endsWith(".txt") || entry.endsWith(".md") || entry === "events.jsonl" || /^run-\d+\.(out|err)$/.test(entry)) {
          const limit = entry === "events.jsonl" ? MAX_LOG_BYTES : MAX_AGENT_FILE_BYTES;
          const text = readTail(full, limit);
          if (text !== null) record(path.posix.join("agents", id, entry), text);
        }
      }
    }
  }

  if (options.config) {
    record("config.json", `${JSON.stringify({ sources: options.configSources ?? [], config: sanitizeJson(options.config) }, null, 2)}\n`);
  }

  const summary = {
    generatedAt: (options.now ?? new Date()).toISOString(),
    laoshiVersion: kitVersion(),
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
    hostname: os.hostname(),
    adapter,
    repo: options.repo,
    featureDir: options.featureDir,
    state: state
      ? {
          status: state.status,
          stopKind: state.stopKind ?? null,
          stopReason: state.stopReason ? redactText(state.stopReason) : null,
          outcome: state.outcome ? redactText(state.outcome) : null,
          branch: state.branch,
          profile: state.profile,
          startedAt: state.startedAt,
          updatedAt: state.updatedAt,
          history: (state.history ?? []).map((s) => ({
            key: s.key,
            attempt: s.attempt,
            outcome: s.outcome,
            agentId: s.agentId,
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            error: s.error ? redactText(s.error) : null,
          })),
          waitingPermission: state.waitingPermission ?? null,
        }
      : null,
    agentCount,
    files: [...files, "summary.json"],
  };
  writeRedacted(path.join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  files.push("summary.json");

  return { outDir, files, agentCount };
}

function parseArgs(argv: string[]): { feature: string | null; outDir?: string; help: boolean } {
  let feature: string | null = null;
  let outDir: string | undefined;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") help = true;
    else if (a === "--out" && argv[i + 1]) outDir = argv[++i];
    else if (a.startsWith("--out=")) outDir = a.slice(6);
    else if (!a.startsWith("-") && !feature) feature = a;
  }
  return { feature, outDir, help };
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help || !args.feature) {
    console.log("用法：laoshi diagnose <需求> [--out <目录>]");
    console.log("导出已脱敏的诊断包（状态、日志尾部、步骤结果、步骤输出与事件），便于发给维护者排查问题。");
    return args.help ? 0 : 2;
  }
  const { repo, featureDir } = locate(process.cwd(), args.feature);
  let config: PipelineConfig = DEFAULT_CONFIG;
  let configSources: string[] = [];
  try {
    const loaded = loadConfig(defaultConfigPath(), repo);
    config = loaded.config;
    configSources = loaded.sources;
  } catch {
    // Use default config when install/project config is unreadable.
  }
  const res = collectDiagnoseBundle({ repo, featureDir, config, configSources, outDir: args.outDir });
  console.log(`已生成脱敏诊断包（${res.files.length} 个文件，含 ${res.agentCount} 个步骤记录）：`);
  console.log(`  ${res.outDir}`);
  console.log("请压缩这个目录发给维护者。");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: Error) => {
      console.error(`生成诊断包失败：${error.message}`);
      process.exit(1);
    },
  );
}
