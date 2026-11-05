// laoshi installer, Paseo part (bin/install.mjs): Paseo's agents read skills from the user-level
// skills directories, as req-kit installed them. The Paseo plugin (requirement views in Paseo)
// still comes with paseo-req-kit.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

export function setup({ report }) {
  report("info", "Paseo 的需求插件仍由 paseo-req-kit 提供（req plugin install）");
  return ["在终端运行 laoshi configure，选择 builder 和 reviewer 用的 agent"];
}

export function uninstall() {}
