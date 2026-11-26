// laoshi installer, Paseo part (bin/install.mjs): Paseo's agents read skills from the user-level
// skills directories, as req-kit installed them. By default this also stages and installs the
// Paseo requirement plugin (adapters/paseo/plugin; pass --no-plugin to skip) and refreshes it on
// upgrades.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const id = "paseo";
export const options = {
  "with-plugin": { type: "boolean" },
  "no-plugin": { type: "boolean" },
};

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

export async function setup({ kit, args = {}, dry, report, home }) {
  const { installPlugin, refreshPlugin, stagedDir } = await import(pathToFileURL(path.join(kit, "adapters", "paseo", "plugin-cmd.mjs")).href);
  if (args["no-plugin"]) {
    report("info", "已按 --no-plugin 跳过 Paseo 需求插件（之后可运行 laoshi plugin install 安装）");
  } else {
    const staged = fs.existsSync(path.join(stagedDir(home), "paseo-plugin.json"));
    if (dry) {
      if (staged) {
        report("ok", args.check ? "Paseo 需求插件文件已就绪（升级或重新安装时自动同步刷新）" : "将刷新 Paseo 需求插件文件并重新加载");
      } else if (args.check) {
        report("info", "尚未部署 Paseo 需求插件：运行 laoshi install --platform paseo 或 laoshi plugin install");
      } else {
        report("ok", "将部署并安装 Paseo 需求插件（跳过可加 --no-plugin）");
      }
    } else if (staged) {
      // Installed before: refresh its files from this version and reload it in Paseo.
      refreshPlugin({ kitRoot: kit, env: { ...process.env, LAOSHI_HOME: home }, log: (m) => report("ok", m) });
    } else {
      const code = await installPlugin({ yes: true, kitRoot: kit, env: { ...process.env, LAOSHI_HOME: home } });
      if (code === 0) report("ok", "已安装 Paseo 需求插件");
      else {
        report(
          "warn",
          "Paseo 插件文件已就绪，但尚未注册到 Paseo daemon",
          "启动 Paseo daemon 后再运行 laoshi plugin install（桌面版 Paseo 可按上面的路径在 设置 → Plugins 手动添加）",
        );
      }
    }
  }
  return ["在终端运行 laoshi configure，选择 builder 和 reviewer 用的 agent"];
}

export async function uninstall({ home } = {}) {
  if (!home) return;
  const { removePlugin, stagedDir } = await import(new URL("./plugin-cmd.mjs", import.meta.url).href);
  if (fs.existsSync(stagedDir(home))) removePlugin({ env: { ...process.env, LAOSHI_HOME: home } });
}
