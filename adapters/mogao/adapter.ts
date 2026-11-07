// The 摸高 adapter (docs/design/mogao-expert.md, form B1): step agents are runs of the platform's
// command line (`aimax run`), approvals are the platform's HITL answered through laoshi, tool calls
// and usage come from the platform's progress callback. Worktrees and services are laoshi's builtin
// ones. The platform keeps a chat's machine for one turn, so the engine runs in the chat's command.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PlatformAdapter } from "../../engine/src/platform.js";
import { mogaoSettings } from "./mogao-runtime.js";

export const mogaoAdapter: PlatformAdapter = {
  id: "mogao",
  displayName: "摸高",
  createRuntime: async (input) => (await import("./mogao-runtime.js")).createRuntime(input),
  capabilities: {
    services: "builtin",
    worktree: "builtin",
    activity: "platform",
    runningTool: "platform",
    toolCalls: "platform",
  },
  originEnv: { id: "AIMAX_SESSION_ID" },
  runsInChat: true,
  skillSetup: path.join(path.dirname(fileURLToPath(import.meta.url)), "skill", "setup.md"),
  words: {
    name: "摸高",
    chat: "摸高的对话",
    schedule: "定时任务（摸高上没有，到时请在对话里说\"继续\"）",
    approvePermission: "在对话里回答\"批准\"或\"拒绝\"，对话会运行 `laoshi permission <需求> approve`（或 `deny`）并接着做",
    signIn: "检查摸高的模型配置",
    origin: "摸高提供的 `AIMAX_SESSION_ID`",
    connectFix: "确认在摸高的对话里运行，并且 `aimax` 命令可用（`aimax --version`）。",
  },
  doctorTitle: "摸高（aimax 命令行）",
  async doctorPlatform({ config, tools }) {
    const settings = mogaoSettings(config);
    const r = spawnSync(settings.command, ["--version"], { encoding: "utf8", timeout: 20_000 });
    if (r.error || r.status !== 0) {
      tools.report("fail", `运行 ${settings.command} --version 失败：${r.error?.message ?? (r.stderr || r.stdout).trim()}`, "在摸高的对话或沙箱里运行；不在 PATH 中时在安装级配置的 platform.mogao.command 写上它的完整路径");
      return;
    }
    tools.report("ok", `aimax ${(r.stdout || "").trim()}（数据目录 ${settings.dataDir}，单次运行上限 ${settings.runTimeoutMinutes} 分钟）`);
    if (!process.env.AIMAX_SESSION_ID) tools.info("没有 AIMAX_SESSION_ID：不在摸高的对话里运行，进展只写入日志");
  },
};
