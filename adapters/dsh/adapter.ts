// The DeepSeek Harness adapter (laoshi M4b prototype, interface from M2a). Everything goes through
// laoshi's dsh plugin; worktrees and services are laoshi's builtin ones (M2b); what neither offers
// is degraded by the core (ADR 0008).

import fs from "node:fs";
import type { PlatformAdapter } from "../../engine/src/platform.js";
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
    const { dshEnv, pluginClient } = await import("./dsh-runtime.js");
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
      const hello = await pluginClient(env, 10_000)<{ plugin: string; approvals: string }>("hello");
      tools.report("ok", `已连接 laoshi 的 dsh 插件 ${hello.plugin}（${paths.socket}），审批策略：${hello.approvals}`);
    } catch (error) {
      tools.report(
        "fail",
        (error as Error).message,
        "启动 dsh；确认 laoshi-dsh-plugin 已用 dsh plugin add 安装，并在 cordis.patch.yml 中挂载（见 adapters/dsh/README.md）",
      );
    }
  },
};
