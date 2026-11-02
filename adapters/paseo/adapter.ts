// The Paseo adapter (laoshi M2a): what the core needs to know about Paseo besides its runtime.
// Paseo provides every optional capability itself (ADR 0008: source "platform").

import type { Catalog } from "../../engine/src/configure.js";
import type { PlatformAdapter } from "../../engine/src/platform.js";
import { connect } from "./daemon-check.js";
import { daemonOf } from "./settings.js";
import { doctorProject } from "./doctor.js";
import { describeAgentProfile, profilesFromDaemonConfig, resolveConfigProfiles, usesPaseoProfiles } from "./paseo-profiles.js";

/** The configuration wizard's choices, read from the daemon. */
function daemonCatalog(client: Awaited<ReturnType<typeof connect>>): Catalog {
  return {
    async providers() {
      const snapshot = await client.providers.waitForReady({ timeoutMs: 60_000 });
      return snapshot.entries.map((e) => ({ id: e.provider, status: e.status }));
    },
    async models(provider) {
      return ((await client.providers.listModels(provider)).models ?? []).map((m) => ({ id: m.id, label: m.label }));
    },
    async modes(provider) {
      return ((await client.providers.listModes(provider)).modes ?? []).map((m) => ({ id: m.id, label: m.label }));
    },
    async profiles() {
      return profilesFromDaemonConfig((await client.config.get()).config) ?? [];
    },
  };
}

export const paseoAdapter: PlatformAdapter = {
  id: "paseo",
  displayName: "Paseo",
  createRuntime: async (input) => (await import("./paseo-runtime.js")).createRuntime(input),
  capabilities: {
    profiles: "platform",
    services: "platform",
    worktree: "platform",
    scheduling: "platform",
    scheduleAgent: "platform",
    sessionAgent: "platform",
    quota: "platform",
    activity: "platform",
    runningTool: "platform",
    toolCalls: "platform",
    toolInfo: "platform",
    providerStatus: "platform",
  },
  originEnv: { id: "PASEO_AGENT_ID", cwd: "PASEO_AGENT_CWD" },
  async resolveProfiles(config, runtime) {
    return usesPaseoProfiles(config) ? resolveConfigProfiles(config, await runtime.listProfiles()) : config;
  },
  describeProfile: describeAgentProfile,
  doctorTitle: "Paseo daemon",
  doctorPlatform: async (input) => (await import("./doctor.js")).doctorPlatform(input),
  doctorProject,
  async agentCatalog(settings, progress) {
    const daemon = daemonOf(settings);
    progress(`配置向导：连接 Paseo daemon ${daemon.daemonUrl} ……`);
    let client;
    try {
      // A daemon that is not running must not hold up the installer: give up after 20 seconds.
      let timer: NodeJS.Timeout | undefined;
      client = await Promise.race([
        connect(daemon),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("20 秒内没有连上")), 20_000);
        }),
      ]).finally(() => clearTimeout(timer));
    } catch (error) {
      throw new Error(`无法连接 daemon：${(error as Error).message}。请确认 Paseo 正在运行；设置了密码时，确认环境变量 ${daemon.daemonPasswordEnv} 已设置。`);
    }
    return { catalog: daemonCatalog(client), close: () => client.close().catch(() => undefined) };
  },
};
