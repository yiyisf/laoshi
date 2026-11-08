// laoshi installer, 摸高 part (bin/install.mjs). The platform loads skills from the expert that is
// submitted to it, so the skills rendered for 摸高 go into the install root's skills directory: that
// directory is the expert's skill package. Nothing else to install: step agents use `aimax`.
import path from "node:path";

export const id = "mogao";

/** Installer options this platform reads (bin/install.mjs passes them through). */
export const options = {};

/** The install-level config's platform section for a new installation. */
export function platformConfig() {
  return { adapter: "mogao", mogao: { dataDir: "/data" } };
}

/** Every step on the platform's model (`aimax run` takes the chat's). */
export const defaultAgents = { builder: { provider: "mogao/chat-model" }, reviewer: { provider: "mogao/chat-model" } };

/** The expert's skill package: <install root>/skills. */
export function skillTargets(args, config, env = process.env, home) {
  const root = home ?? path.resolve(env.LAOSHI_HOME ?? path.join(env.HOME ?? "", ".laoshi"));
  const dir = path.join(root, "skills");
  return [{ dir, label: `专家的 skill 目录 ${dir}（提交到摸高的专家用这个目录）` }];
}

export function setup({ report }) {
  report("info", "步骤 agent 用摸高的 aimax 命令运行；在摸高上安装根放在工作区 /data/workspace/.laoshi，程序装在它的 npm 目录里，命令据此找到安装根（专家第一次使用时就这样安装）");
  return ["把上面专家的 skill 目录提交为摸高的专家（或在对话里加载它）", "体检：laoshi doctor --no-project"];
}

export function uninstall() {}
