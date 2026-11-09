// `laoshi migrate` (M7, docs/design/compat-migration.md §5): moves a req-kit 1.x machine setup to
// laoshi. By default it only shows what it would do; --apply does it, --rollback undoes it.
//
// - The install-level config: ~/.req-kit/config.json → ~/.laoshi/config.json, with req-kit's
//   setting names turned into laoshi's (the Paseo daemon address under platform.paseo, the old
//   profile and services keys renamed). Everything else in the old directory (usage records, the
//   requirement index, local prompts, notifiers) is copied.
// - Requirements: state files still in the 1.x format are moved to the current format, keeping
//   the old file as state.json.bak-v1 (as the engine does when it reads one).
// - Nothing in the old directory is changed or removed: req-kit 1.x keeps working from it, so a
//   rollback only has to restore the state files and remove what was written.
// - Projects' .requirement-pipeline.json and req-kit's /req* skills are left as they are: laoshi
//   reads the old project file, and the skills go with req-kit.
//
//   laoshi migrate [--from <req-kit 目录>] [--to <laoshi 目录>] [--apply | --rollback]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { LEGACY_PROJECT_CONFIG_FILE, normalizeLegacyKeys, PROJECT_CONFIG_FILE } from "../../engine/src/config.js";
import { isAlive, migrateState, STATE_VERSION } from "../../engine/src/state.js";

export interface MigrationPlan {
  from: string;
  to: string;
  /** Reasons it cannot be applied now. */
  blockers: string[];
  /** The new install-level config, or null when there is none to write. */
  config: Record<string, unknown> | null;
  /** Files copied from the old directory (relative paths). */
  copies: string[];
  /** State files to move to the current format. */
  states: string[];
  /** Things people should know or do themselves. */
  notes: string[];
}

/** What --apply wrote, so --rollback can undo exactly that. */
export interface MigrationRecord {
  schema: 1;
  at: string;
  from: string;
  to: string;
  /** Files created in the new directory (absolute). */
  created: string[];
  /** State files moved to the current format; each has its state.json.bak-v<n>. */
  states: Array<{ file: string; from: number }>;
}

export const RECORD_FILE = "migrate.json";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** req-kit 1.x's install-level config in laoshi's terms. */
export function migrateConfig(old: Record<string, unknown>): Record<string, unknown> {
  const config = normalizeLegacyKeys(structuredClone(old));
  const platform: Record<string, unknown> = isRecord(config.platform) ? { ...config.platform } : { adapter: "paseo" };
  if (typeof platform.adapter !== "string") platform.adapter = "paseo";
  // 1.x kept the daemon's address at the top level; laoshi keeps it with the Paseo adapter's settings.
  const daemon: Record<string, unknown> = {};
  for (const key of ["daemonUrl", "daemonPasswordEnv"]) {
    if (config[key] !== undefined) {
      daemon[key] = config[key];
      delete config[key];
    }
  }
  if (Object.keys(daemon).length) platform.paseo = { ...daemon, ...(isRecord(platform.paseo) ? platform.paseo : {}) };
  return { ...config, platform };
}

function filesUnder(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return filesUnder(full, base);
    return e.isFile() ? [path.relative(base, full)] : [];
  });
}

/** The requirements req-kit recorded: their repositories and feature directories. */
function indexed(from: string): Array<{ repo: string; featureDir: string }> {
  const dir = path.join(from, "index");
  if (!fs.existsSync(dir)) return [];
  const out: Array<{ repo: string; featureDir: string }> = [];
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    try {
      const e = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as { repo?: unknown; featureDir?: unknown };
      if (typeof e.repo === "string" && typeof e.featureDir === "string") out.push({ repo: e.repo, featureDir: e.featureDir });
    } catch {
      // A broken entry is skipped.
    }
  }
  return out;
}

export function defaultDirs(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): { from: string; to: string } {
  const legacy = env.REQ_KIT_HOME?.trim();
  const current = env.LAOSHI_HOME?.trim();
  return { from: path.resolve(legacy || path.join(home, ".req-kit")), to: path.resolve(current || path.join(home, ".laoshi")) };
}

export function planMigration(from: string, to: string, env: NodeJS.ProcessEnv = process.env): MigrationPlan {
  const plan: MigrationPlan = { from, to, blockers: [], config: null, copies: [], states: [], notes: [] };
  const oldConfig = path.join(from, "config.json");
  if (path.resolve(from) === path.resolve(to)) {
    plan.blockers.push(`新旧目录相同（${from}）：用 --to 指定 laoshi 的目录`);
    return plan;
  }
  if (!fs.existsSync(oldConfig)) {
    plan.blockers.push(`${from} 下没有 req-kit 的配置（config.json），没有可迁移的内容`);
    return plan;
  }
  if (fs.existsSync(path.join(to, RECORD_FILE))) plan.blockers.push(`${to} 已经迁移过（有 ${RECORD_FILE}）；要重来，先 laoshi migrate --rollback`);
  else if (fs.existsSync(path.join(to, "config.json"))) plan.blockers.push(`${to} 已经有 laoshi 的配置：用 --to 换一个目录，或先把它移走`);
  try {
    const raw = JSON.parse(fs.readFileSync(oldConfig, "utf8")) as unknown;
    if (!isRecord(raw)) throw new Error("顶层不是对象");
    plan.config = migrateConfig(raw);
  } catch (error) {
    plan.blockers.push(`${oldConfig} 读不出来：${(error as Error).message}`);
  }
  plan.copies = filesUnder(from).filter((f) => f !== "config.json" && !fs.existsSync(path.join(to, f)));

  const projects = new Set<string>();
  for (const { repo, featureDir } of indexed(from)) {
    const file = path.join(repo, featureDir, ".pipeline", "state.json");
    if (fs.existsSync(path.join(repo, LEGACY_PROJECT_CONFIG_FILE)) && !fs.existsSync(path.join(repo, PROJECT_CONFIG_FILE))) projects.add(repo);
    if (!fs.existsSync(file)) continue;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      plan.notes.push(`${file} 读不出来，跳过`);
      continue;
    }
    if (raw.status === "running" && typeof raw.pid === "number" && isAlive(raw.pid)) {
      plan.blockers.push(`需求 ${path.join(repo, featureDir)} 的流水线正在运行（进程 ${raw.pid}）：先等它停下，或用 laoshi stop 停止`);
      continue;
    }
    const version = typeof raw.version === "number" ? raw.version : 1;
    if (version < STATE_VERSION) plan.states.push(file);
  }

  plan.notes.push("skill：运行 laoshi install --platform paseo 安装 /laoshi、/laoshi-setup 等；req-kit 的 /req* 先保留，以后由 paseo-req-kit 2.0 换成转到 /laoshi 的说明");
  for (const repo of projects) plan.notes.push(`项目 ${repo} 用的是旧的 ${LEGACY_PROJECT_CONFIG_FILE}：laoshi 照常读取；要改名为 ${PROJECT_CONFIG_FILE}，请在仓库里改名后提交`);
  if (env.REQ_KIT_HOME?.trim()) plan.notes.push("环境变量 REQ_KIT_HOME 还在：laoshi 也认它，会继续用旧目录；迁移后请改为设置 LAOSHI_HOME（或去掉 REQ_KIT_HOME）");
  return plan;
}

export function applyMigration(plan: MigrationPlan): MigrationRecord {
  if (plan.blockers.length) throw new Error(plan.blockers.join("\n"));
  const record: MigrationRecord = { schema: 1, at: new Date().toISOString(), from: plan.from, to: plan.to, created: [], states: [] };
  const write = (file: string, content: string | Buffer) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    record.created.push(file);
  };
  fs.mkdirSync(plan.to, { recursive: true });
  try {
    if (plan.config) write(path.join(plan.to, "config.json"), `${JSON.stringify(plan.config, null, 2)}\n`);
    for (const rel of plan.copies) write(path.join(plan.to, rel), fs.readFileSync(path.join(plan.from, rel)));
    for (const file of plan.states) {
      const text = fs.readFileSync(file, "utf8");
      const { state, from } = migrateState(JSON.parse(text) as Record<string, unknown>, file);
      const backup = `${file}.bak-v${from}`;
      if (!fs.existsSync(backup)) fs.writeFileSync(backup, text);
      fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
      record.states.push({ file, from });
    }
  } finally {
    // Written even when a step failed, so --rollback can undo what was done.
    fs.writeFileSync(path.join(plan.to, RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`);
  }
  return record;
}

/** Undoes --apply: the state files as they were, and the new directory's migrated files gone. */
export function rollbackMigration(to: string): { restored: string[]; removed: string[]; kept: string[] } {
  const recordFile = path.join(to, RECORD_FILE);
  if (!fs.existsSync(recordFile)) throw new Error(`${to} 下没有迁移记录（${RECORD_FILE}），没有可回滚的内容`);
  const record = JSON.parse(fs.readFileSync(recordFile, "utf8")) as MigrationRecord;
  const restored: string[] = [];
  const kept: string[] = [];
  for (const { file, from } of record.states) {
    const backup = `${file}.bak-v${from}`;
    if (!fs.existsSync(backup)) {
      kept.push(`${file}（没有 ${path.basename(backup)}）`);
      continue;
    }
    fs.copyFileSync(backup, file);
    restored.push(file);
  }
  const removed: string[] = [];
  for (const file of record.created) {
    if (fs.existsSync(file)) {
      fs.rmSync(file);
      removed.push(file);
    }
  }
  fs.rmSync(recordFile);
  // Directories the migration made and left empty.
  const dirs = [...new Set(record.created.map((f) => path.dirname(f)))].sort((a, b) => b.length - a.length);
  for (const dir of [...dirs, to]) {
    try {
      if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch {
      // Gone already or not empty: leave it.
    }
  }
  return { restored, removed, kept };
}

function show(plan: MigrationPlan, applied: boolean): void {
  const verb = applied ? "已" : "将";
  console.log(`从 req-kit 迁移到 laoshi${applied ? "" : "（预览：不改任何东西）"}\n旧目录：${plan.from}\n新目录：${plan.to}\n`);
  if (plan.config) {
    console.log(`- 安装级配置：${verb}写入 ${path.join(plan.to, "config.json")}（平台 ${String((plan.config.platform as { adapter?: string }).adapter)}${(plan.config.platform as { paseo?: unknown }).paseo ? "，daemon 地址移到 platform.paseo" : ""}）`);
    console.log(`- 其他文件（使用记录、需求索引、本机提示词、通知模块）：${verb}复制 ${plan.copies.length} 个`);
    console.log(`- 需求状态：${plan.states.length ? `${verb}把 ${plan.states.length} 个旧格式的状态文件改为第 ${STATE_VERSION} 版（原文件保留为 state.json.bak-v1）` : "没有要改的"}`);
    console.log("- 旧目录不改、不删：req-kit 1.x 仍然可以用");
    for (const n of plan.notes) console.log(`· ${n}`);
  }
  if (plan.blockers.length) {
    console.log("\n现在不能迁移：");
    for (const b of plan.blockers) console.log(`✗ ${b}`);
  } else if (!applied) {
    console.log("\n确认后执行：laoshi migrate --apply");
    console.log("回滚：laoshi migrate --rollback（恢复状态文件、删除新目录里迁移写入的文件；之后接着用 req-kit 1.x）");
  }
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { from: { type: "string" }, to: { type: "string" }, apply: { type: "boolean", default: false }, rollback: { type: "boolean", default: false } },
    allowPositionals: false,
  });
  const dirs = defaultDirs();
  const from = values.from ? path.resolve(values.from) : dirs.from;
  const to = values.to ? path.resolve(values.to) : dirs.to;
  if (values.rollback) {
    const r = rollbackMigration(to);
    console.log(`已回滚：恢复了 ${r.restored.length} 个状态文件，删除了 ${r.removed.length} 个迁移写入的文件。`);
    for (const k of r.kept) console.log(`· 没有恢复：${k}`);
    console.log(`req-kit 1.x 继续使用 ${from}。`);
    return 0;
  }
  const plan = planMigration(from, to);
  if (!values.apply || plan.blockers.length) {
    show(plan, false);
    return plan.blockers.length ? 1 : 0;
  }
  applyMigration(plan);
  show(plan, true);
  console.log(`\n迁移记录：${path.join(to, RECORD_FILE)}。接下来：laoshi install --platform paseo，然后 laoshi doctor。`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error((error as Error).message);
      process.exit(1);
    },
  );
}
