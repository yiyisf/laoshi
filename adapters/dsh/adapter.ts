// The DeepSeek Harness adapter (laoshi M4b prototype, interface from M2a). Everything goes through
// laoshi's dsh plugin; what the plugin does not offer is degraded by the core (ADR 0008).

import type { PlatformAdapter } from "../../engine/src/platform.js";
import { channelPaths, dshHome } from "./plugin/channel.mjs";

export const dshAdapter: PlatformAdapter = {
  id: "dsh",
  displayName: "DeepSeek Harness（dsh）",
  createRuntime: async (input) => (await import("./dsh-runtime.js")).createRuntime(input),
  capabilities: {
    scheduling: "plugin",
    sessionAgent: "plugin",
    activity: "plugin",
    runningTool: "plugin",
    toolCalls: "plugin",
  },
  originEnv: { id: "DSH_SESSION_ID" },
  doctorTitle: "DeepSeek Harness（dsh）与 laoshi 插件",
  async doctorPlatform({ tools }) {
    const { pluginClient } = await import("./dsh-runtime.js");
    const paths = channelPaths(dshHome());
    try {
      const hello = await pluginClient(process.env, 10_000)<{ plugin: string; approvals: string }>("hello");
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
