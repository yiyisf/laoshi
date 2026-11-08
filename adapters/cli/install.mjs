// laoshi installer, command-line part (bin/install.mjs): no platform; the skills go where the
// interactive command lines read them (as for Paseo), and the roles use `claude` and `codex`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const id = "cli";
export const options = {};

export function platformConfig() {
  return { adapter: "cli" };
}

export const defaultAgents = { builder: { provider: "claude/default", modeId: "bypassPermissions" }, reviewer: { provider: "codex/default", modeId: "full-access" } };

export function skillTargets() {
  const home = os.homedir();
  const roots = [{ dir: path.join(home, ".agents", "skills"), label: "通用目录 ~/.agents/skills（Codex 等）" }];
  if (fs.existsSync(path.join(home, ".claude"))) roots.push({ dir: path.join(home, ".claude", "skills"), label: "Claude Code ~/.claude/skills" });
  return roots;
}

export function setup({ report }) {
  report("info", "步骤 agent 是 claude -p / codex exec 的一次运行；角色默认 builder 用 Claude Code、reviewer 用 Codex（只装了一种时，在安装级配置里把两个角色都改成它）");
  return ["在终端运行 laoshi doctor --no-project，确认 claude、codex 能运行并已登录"];
}

export function uninstall() {}
