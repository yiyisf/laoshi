// The Paseo sections of `doctor` (moved from engine/src/doctor.ts in laoshi M2a): the daemon
// (connection, versions, providers, profiles, quota, each agent), the Paseo SDK's version, and
// paseo.json in the project.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { PipelineConfig } from "../../engine/src/config.js";
import { findDependency, KIT_ROOT } from "../../engine/src/locations.js";
import type { DoctorTools } from "../../engine/src/platform.js";
import { satisfies } from "../../engine/src/semver.js";
import { checkProfile, connect } from "./daemon-check.js";
import { daemonVersion } from "./daemon-version.js";
import { type DaemonSettings, daemonOf } from "./settings.js";
import { type PaseoJson, paseoJsonIssues } from "./paseo-json.js";
import { describeAgentProfile, ProfileResolutionError, profilesFromDaemonConfig, resolveConfigProfiles, usesPaseoProfiles } from "./paseo-profiles.js";

function readPaseoRange(): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, "package.json"), "utf8")) as { reqKit?: { paseo?: string } };
    return pkg.reqKit?.paseo ?? null;
  } catch {
    return null;
  }
}

/** Daemon address from the raw file, so the daemon can be checked even when the agents are not filled in yet. */
function daemonSettings(configPath: string): DaemonSettings {
  try {
    return daemonOf(JSON.parse(fs.readFileSync(configPath, "utf8")));
  } catch {
    return daemonOf(null);
  }
}

export async function doctorPlatform({ config, configPath, tools }: { config: PipelineConfig | null; configPath: string; tools: DoctorTools }): Promise<void> {
  const { report, info } = tools;
  const pkg = path.join(findDependency("@getpaseo/client") ?? path.join(KIT_ROOT, "node_modules", "@getpaseo", "client"), "package.json");
  const range = readPaseoRange();
  if (fs.existsSync(pkg) && range) {
    const sdk = (JSON.parse(fs.readFileSync(pkg, "utf8")) as { version: string }).version;
    if (satisfies(sdk, range)) report("ok", `Paseo SDK ${sdk}（本版本支持 ${range}）`);
    else report("warn", `Paseo SDK ${sdk} 不在本版本支持的范围 ${range} 内`, "确认 Paseo 与 req-kit 版本匹配，必要时升级 req-kit");
  }
  const settings = config ? daemonOf(config) : daemonSettings(configPath);
  let client;
  try {
    client = await connect(settings);
  } catch (error) {
    report(
      "fail",
      `无法连接 daemon ${settings.daemonUrl}：${(error as Error).message}`,
      `确认 Paseo 桌面端或 daemon 正在运行；设置了密码时，确认环境变量 ${settings.daemonPasswordEnv} 已设置`,
    );
    return;
  }
  try {
    report("ok", `已连接 ${settings.daemonUrl}`);
    const range = readPaseoRange();
    const version = await daemonVersion(settings.daemonUrl, process.env[settings.daemonPasswordEnv]).catch(() => null);
    if (version && range) {
      if (satisfies(version, range)) report("ok", `Paseo ${version}（本版本支持 ${range}）`);
      else report("warn", `Paseo ${version} 不在本版本 req-kit 支持的范围 ${range} 内`, "运行 req upgrade，它会选能支持这个 Paseo 版本的 req-kit");
    }
    const snapshot = await client.providers.waitForReady({ timeoutMs: 30_000 });
    const providers = snapshot.entries.map((e) => `${e.provider}（${e.status}）`).join("、");
    report("ok", `可用的 provider：${providers || "（无）"}`);
    const daemonConfig = await client.config.get().then((r) => r.config as Record<string, unknown>).catch(() => null);
    const paseoProfiles = daemonConfig ? profilesFromDaemonConfig(daemonConfig) : null;
    if (paseoProfiles && paseoProfiles.length > 0) {
      report("ok", `Paseo agent profiles：${paseoProfiles.map((p) => `「${p.name}」`).join("、")}（配置中可以用 "platformProfile": "<名称>" 引用）`);
    } else if (paseoProfiles) {
      info("Paseo 中还没有 agent profile。可选：在 设置 → Agents → Agent profiles 中建好\"实现\"\"评审\"等 profile，配置中用 platformProfile 引用，之后换模型只需改 Paseo");
    }
    if (daemonConfig) {
      const mcp = daemonConfig.mcp as { injectIntoAgents?: boolean } | undefined;
      const browser = daemonConfig.browserTools as { enabled?: boolean } | undefined;
      info(
        mcp?.injectIntoAgents
          ? "Paseo 工具已开启：步骤 agent 可以重启 Paseo 管理的服务"
          : "Paseo 工具未开启（设置 → Agents → Enable Paseo tools）。不影响运行；开启后步骤 agent 可以自己重启 Paseo 管理的服务",
      );
      info(browser?.enabled ? "浏览器工具已开启（桌面端）" : "浏览器工具未开启（不影响运行）");
    }
    if (config && usesPaseoProfiles(config)) {
      try {
        config = resolveConfigProfiles(config, paseoProfiles);
        report("ok", `Paseo profile 已解析：builder ${describeAgentProfile(config.agents.builder)}；reviewer ${describeAgentProfile(config.agents.reviewer)}`);
      } catch (error) {
        if (!(error instanceof ProfileResolutionError)) throw error;
        report("fail", error.message, "在 Paseo 中建好这个 profile，或修改配置中的 platformProfile");
        config = null;
      }
    }
    if (config) {
      const used = [...new Set([config.agents.builder, config.agents.reviewer].map((p) => (p.provider ?? "").split("/")[0]))];
      const usage = await client.providers.listUsage().catch(() => null);
      for (const p of usage?.providers ?? []) {
        if (!used.includes(p.providerId) || p.status !== "available" || p.windows.length === 0) continue;
        info(`${p.displayName} 额度：${p.windows.map((w) => `${w.label} 已用 ${typeof w.usedPct === "number" ? `${Math.round(w.usedPct)}%` : "?"}`).join("，")}`);
      }
    }
    if (config) {
      for (const role of ["builder", "reviewer"] as const) await checkProfile(client, role, config.agents[role], report);
      if (config.reviewPanel.enabled) {
        for (const [i, member] of config.reviewPanel.members.entries()) {
          await checkProfile(client, `评审小组·${member.name ?? `成员 ${i + 1}`}`, member, report);
        }
      }
      if (config.designProposals.enabled) {
        for (const [i, member] of config.designProposals.members.entries()) {
          await checkProfile(client, `方案提案·${member.name ?? `成员 ${i + 1}`}`, member, report);
        }
      }
    } else {
      report("warn", "配置不完整，跳过 agent 检查", "修好配置后再运行一次");
    }
  } catch (error) {
    report("fail", `检查 daemon 时出错：${(error as Error).message}`);
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** paseo.json: worktree setup and the services Paseo can run for the pipeline. */
export function doctorProject({ repo, isRepo, tools }: { repo: string; isRepo: boolean; tools: DoctorTools }): void {
  const { report, info } = tools;
  const file = path.join(repo, "paseo.json");
  if (!fs.existsSync(file)) {
    info("没有 paseo.json。可选：/laoshi-setup 可以生成它，让 Paseo 在新建 worktree 时自动安装依赖，并由 Paseo 管理服务和端口（几个需求同时验证也不会端口冲突）");
    return;
  }
  let raw: PaseoJson;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) as typeof raw;
  } catch (error) {
    report("fail", `paseo.json 不是合法的 JSON：${(error as Error).message}`, "修正 paseo.json");
    return;
  }
  const scripts = Object.entries(raw.scripts ?? {});
  const services = scripts.filter(([, s]) => s.type === "service");
  report(
    "ok",
    `paseo.json：${raw.worktree?.setup ? "新建 worktree 时自动准备环境；" : ""}脚本 ${scripts.length} 个${services.length ? `，其中服务 ${services.map(([n]) => n).join("、")}（由流水线通过 Paseo 启动）` : ""}`,
  );
  for (const [name, s] of services) {
    if (s.port === undefined && !/PASEO_PORT|\{PORT\}|with-port/.test(String(s.command ?? ""))) {
      report("warn", `paseo.json 中的服务 ${name} 没有使用 Paseo 分配的端口（PASEO_PORT），几个工作区同时运行时会端口冲突`, `让服务监听 Paseo 分配的端口，例如 "node scripts/paseo/with-port.mjs npm run dev -- --port {PORT}"（/laoshi-setup 会写入这个脚本）`);
    }
  }
  for (const issue of paseoJsonIssues(raw)) {
    if (issue.kind === "fails") report("warn", issue.text, issue.fix);
    else info(`${issue.text}。团队都用同一种系统时可以不改；否则：${issue.fix}`);
  }
  if (!isRepo) return;
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "paseo.json"], { cwd: repo, stdio: "ignore" });
  } catch {
    report("warn", "paseo.json 还没有提交：Paseo 新建 worktree 时读取的是已提交的版本", "提交 paseo.json");
  }
}
