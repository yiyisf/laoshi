// The DeepSeek Harness adapter (laoshi M4b prototype, interface from M2a). Everything goes through
// laoshi's dsh plugin; worktrees and services are laoshi's builtin ones (M2b); what neither offers
// is degraded by the core (ADR 0008).

import fs from "node:fs";
import type { AgentProfile } from "../../engine/src/config.js";
import type { PlatformAdapter } from "../../engine/src/platform.js";
import type { DshModels } from "./dsh-runtime.js";
import { channelPaths, dshHome } from "./plugin/channel.mjs";

export const dshAdapter: PlatformAdapter = {
  id: "dsh",
  displayName: "DeepSeek Harness（dsh）",
  createRuntime: async (input) => (await import("./dsh-runtime.js")).createRuntime(input),
  capabilities: {
    services: "builtin",
    worktree: "builtin",
    scheduling: "plugin",
    sessionAgent: "plugin",
    activity: "plugin",
    runningTool: "plugin",
    toolCalls: "plugin",
    providerStatus: "plugin",
  },
  originEnv: { id: "DSH_SESSION_ID" },
  words: {
    name: "dsh",
    chat: "dsh 的对话",
    schedule: "dsh 定时任务",
    approvePermission: "在 dsh 的界面中打开这个对话的子 agent「{agent}」，查看并批准这个请求（或拒绝）",
    signIn: "检查 dsh 中这个模型的配置",
    connectFix: "确认 dsh 正在运行，并已用 `dsh plugin add` 安装、在 `cordis.patch.yml` 中挂载 laoshi 的 dsh 插件。",
  },
  doctorTitle: "DeepSeek Harness（dsh）与 laoshi 插件",
  async doctorPlatform({ config, configPath, tools }) {
    const { CHAT_MODEL, dshEnv, pluginClient, stepModel } = await import("./dsh-runtime.js");
    let raw: unknown = config;
    if (!raw) {
      try {
        raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
      } catch {
        // The config section reports it.
      }
    }
    const env = dshEnv(raw);
    const paths = channelPaths(dshHome(env));
    try {
      const call = pluginClient(env, 10_000);
      const hello = await call<{ plugin: string; approvals: string }>("hello");
      tools.report("ok", `已连接 laoshi 的 dsh 插件 ${hello.plugin}（${paths.socket}），审批策略：${hello.approvals}`);
      const listed = await call<DshModels>("models").catch(() => null);
      if (!listed) {
        tools.report("warn", "插件没有列出 dsh 的模型（插件版本较旧？）", "重新运行安装脚本，更新 laoshi 的 dsh 插件后重启 dsh");
        return;
      }
      const names = listed.providers.flatMap((p) => p.models.map((m) => `${p.provider}/${m.id}`));
      tools.info(`dsh 中可用的模型：${names.length ? names.join("、") : "（无）"}。agent 的 provider 写成"<提供方>/<模型>"即可让这个角色用它；写 ${CHAT_MODEL} 时用对话的模型`);
      const agents = (config as { agents?: Record<string, AgentProfile | null | undefined> } | null)?.agents ?? {};
      for (const role of ["builder", "reviewer", "fallback"]) {
        const profile = agents[role];
        if (!profile) continue;
        const model = stepModel(profile);
        if (!model) tools.report("ok", `${role}：用对话的模型`);
        else if (names.includes(`${model.provider}/${model.model}`)) tools.report("ok", `${role}：${model.provider}/${model.model}${model.reasoningEffort ? `（推理强度 ${model.reasoningEffort}）` : ""}`);
        else tools.report("fail", `${role} 用的模型 ${model.provider}/${model.model} 在 dsh 中不存在`, `改成上面列出的模型之一，或写 ${CHAT_MODEL} 用对话的模型`);
      }
    } catch (error) {
      tools.report(
        "fail",
        (error as Error).message,
        "启动 dsh；确认 laoshi-dsh-plugin 已用 dsh plugin add 安装，并在 cordis.patch.yml 中挂载（见 adapters/dsh/README.md）",
      );
    }
  },
};
