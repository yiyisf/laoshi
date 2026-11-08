// The command-line adapter (docs/design/cli-adapter.md, M3): no agent platform, step agents are
// runs of a coding-agent command line (`claude -p`, `codex exec`). Worktrees and services are
// laoshi's builtin ones; tool calls come from the command line's JSON events. There is no chat to
// message and no scheduling: progress goes to the log, messages.log and the external notifiers.
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PlatformAdapter } from "../../engine/src/platform.js";
import { cliSettings, versionOf } from "./cli-runtime.js";
import { DRIVERS } from "./drivers.js";

export const cliAdapter: PlatformAdapter = {
  id: "cli",
  displayName: "命令行 agent",
  createRuntime: async (input) => (await import("./cli-runtime.js")).createRuntime(input),
  capabilities: {
    services: "builtin",
    worktree: "builtin",
    activity: "platform",
    runningTool: "platform",
    toolCalls: "platform",
  },
  // Command lines give their sessions no identifier: a pipeline started here has no origin chat
  // unless one is passed with --origin-agent or this variable.
  originEnv: { id: "LAOSHI_CLI_ORIGIN" },
  skillSetup: path.join(path.dirname(fileURLToPath(import.meta.url)), "skill", "setup.md"),
  words: {
    name: "命令行 agent",
    chat: "运行 laoshi 的终端或 agent 对话",
    schedule: "定时任务（命令行上没有，到时请再运行继续命令）",
    approvePermission: "命令行的非交互模式不会等待批准；请调整 {agent} 所用角色的 modeId",
    signIn: "在终端里运行它，按提示登录",
    origin: "环境变量 `LAOSHI_CLI_ORIGIN`（命令行 agent 不提供会话标识）",
    connectFix: "确认 `claude --version` 或 `codex --version` 能在终端里运行（不在 PATH 中时在安装级配置的 platform.cli 写上完整路径）。",
  },
  doctorTitle: "命令行 agent（Claude Code、Codex）",
  async doctorPlatform({ config, tools }) {
    const settings = cliSettings(config);
    const agents = (config as { agents?: Record<string, { provider?: string }> }).agents ?? {};
    const used = new Set(Object.values(agents).map((p) => (p?.provider ?? "").split("/")[0]));
    for (const id of Object.keys(DRIVERS)) {
      const version = versionOf(settings.commands[id]);
      const needed = used.has(id);
      if (version) tools.report("ok", `${DRIVERS[id].label}：${settings.commands[id]} ${version}${needed ? "" : "（配置里的角色没有用它）"}`);
      else if (needed) tools.report("fail", `${DRIVERS[id].label}：运行 ${settings.commands[id]} --version 失败`, `安装并登录 ${DRIVERS[id].label}；不在 PATH 中时在安装级配置的 platform.cli.${id} 写上它的完整路径`);
      else tools.info(`${DRIVERS[id].label}：没有安装（配置里的角色也没有用它）`);
    }
    for (const p of Object.values(agents)) {
      const id = (p?.provider ?? "").split("/")[0];
      if (p?.provider && !DRIVERS[id]) tools.report("fail", `agent "${p.provider}" 不是命令行适配器支持的命令行`, "provider 写成 claude/<模型> 或 codex/<模型>（default 表示命令行自己的默认模型）");
    }
    tools.info(`单次运行上限 ${settings.runTimeoutMinutes} 分钟；进展写在 <安装根>/cli/messages.log，用 laoshi status 查看`);
  },
};
