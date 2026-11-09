// laoshi installer, Paseo part (bin/install.mjs): Paseo's agents read skills from the user-level
// skills directories, as req-kit installed them. The Paseo plugin (requirement views in Paseo,
// adapters/paseo/plugin) is installed with `laoshi plugin install` and refreshed here on upgrades.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const id = "paseo";
export const options = {};

export function platformConfig() {
  return { adapter: "paseo" };
}

/** Placeholders the configuration wizard (`laoshi configure`) replaces with Paseo's agents. */
export const defaultAgents = { builder: { provider: "CHANGE-ME/model" }, reviewer: { provider: "CHANGE-ME/model" } };

export function skillTargets() {
  const home = os.homedir();
  const roots = [{ dir: path.join(home, ".agents", "skills"), label: "通用目录 ~/.agents/skills（Codex、Pi、OpenCode 等）" }];
  if (fs.existsSync(path.join(home, ".claude"))) roots.push({ dir: path.join(home, ".claude", "skills"), label: "Claude Code ~/.claude/skills" });
  return roots;
}

export async function setup({ kit, dry, report, home }) {
  const { refreshPlugin, stagedDir } = await import(pathToFileURL(path.join(kit, "adapters", "paseo", "plugin-cmd.mjs")).href);
  const staged = fs.existsSync(path.join(stagedDir(home), "paseo-plugin.json"));
  if (staged && !dry) {
    // Installed before: refresh its files from this version and reload it in Paseo.
    refreshPlugin({ kitRoot: kit, env: { ...process.env, LAOSHI_HOME: home }, log: (m) => report("ok", m) });
  } else if (!staged) {
    report("info", "Paseo 的需求插件（在 Paseo 里看需求、确认方案、停止和继续）：laoshi plugin install");
  }
  return ["在终端运行 laoshi configure，选择 builder 和 reviewer 用的 agent"];
}

export async function uninstall({ home } = {}) {
  if (!home) return;
  const { removePlugin, stagedDir } = await import(new URL("./plugin-cmd.mjs", import.meta.url).href);
  if (fs.existsSync(stagedDir(home))) removePlugin({ env: { ...process.env, LAOSHI_HOME: home } });
}
