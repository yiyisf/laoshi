// laoshi installer, dsh part (bin/install.mjs): where dsh reads skills, and laoshi's dsh plugin
// installed and mounted in a dsh profile. Plain Node.js; reaches an npm-installed `dsh` through
// cmd.exe on Windows, never PowerShell.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const id = "dsh";

/** Installer options this platform reads (bin/install.mjs passes them through). */
export const options = {
  "dsh-home": { type: "string" },
  profile: { type: "string" },
  "dsh-bin": { type: "string" },
  approvals: { type: "string" },
};

const slash = (p) => p.split(path.sep).join("/");

function dshHomeOf(args, config, env) {
  return path.resolve(args["dsh-home"] ?? config?.platform?.dsh?.home ?? env.DSH_HOME ?? path.join(os.homedir(), ".dsh"));
}

/** The install-level config's platform section for a new installation. */
export function platformConfig(args, env = process.env) {
  return { adapter: "dsh", dsh: { home: slash(dshHomeOf(args, null, env)), profile: args.profile ?? "web" } };
}

/** The agents of a new installation: every step on the chat's model (doctor lists the others). */
export const defaultAgents = { builder: { provider: "dsh/chat-model" }, reviewer: { provider: "dsh/chat-model" } };

/** Where dsh reads skills: its home's skills directory. */
export function skillTargets(args, config, env = process.env) {
  const dir = path.join(dshHomeOf(args, config, env), "skills");
  return [{ dir, label: `dsh 的 skill 目录 ${dir}` }];
}

/** Installs and mounts laoshi's dsh plugin. */
export function setup({ kit, args, config, env = process.env, dry, report }) {
  const dshHome = dshHomeOf(args, config, env);
  const profile = args.profile ?? config?.platform?.dsh?.profile ?? "web";
  const approvals = args.approvals ?? "ask";
  if (!["ask", "allow"].includes(approvals)) throw new Error("--approvals 只能是 ask 或 allow");
  if (!fs.existsSync(dshHome)) report("warn", `dsh 的目录 ${dshHome} 还不存在`, "先启动一次 dsh，或用 --dsh-home 指定");
  const profileDir = path.join(dshHome, "profiles", profile);
  const plugin = path.join(kit, "adapters", "dsh", "plugin");
  const installed = path.join(profileDir, "node_modules", "laoshi-dsh-plugin");
  let added = false;
  if (!dry) {
    const cli = ["plugin", "--profile", profile, "add", `file:${slash(plugin)}`];
    const childEnv = { ...env, DSH_HOME: dshHome };
    try {
      if (args["dsh-bin"]) execFileSync(process.execPath, [path.resolve(args["dsh-bin"]), ...cli], { env: childEnv, stdio: "pipe", windowsHide: true });
      else if (process.platform === "win32") execFileSync(env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", ["dsh", ...cli].join(" ")], { env: childEnv, stdio: "pipe", windowsHide: true });
      else execFileSync("dsh", cli, { env: childEnv, stdio: "pipe" });
      added = true;
    } catch (error) {
      report("info", `dsh plugin add 没有成功（${String(error.stderr ?? error.message).trim().split("\n").at(-1)}），改为直接复制到 profile`);
    }
    if (!added) {
      fs.rmSync(installed, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(installed), { recursive: true });
      fs.cpSync(plugin, installed, { recursive: true });
    }
  }
  report("ok", added ? `已用 dsh plugin add 把 laoshi 的插件装进 profile ${profile}` : `laoshi 的插件放到 ${installed}`);

  const patchFile = path.join(profileDir, "cordis.patch.yml");
  // dsh writes the file with an empty flow list ("[]"); entries go into a block list instead.
  const current = (fs.existsSync(patchFile) ? fs.readFileSync(patchFile, "utf8") : "").replace(/^\s*\[\]\s*$/m, "");
  if (current.includes("laoshi-dsh-plugin")) report("ok", `${patchFile} 中已挂载插件，不改动（审批策略以文件中的为准）`);
  else {
    if (!dry) {
      fs.mkdirSync(profileDir, { recursive: true });
      const block = `- insert:\n    - id: laoshi-dsh\n      name: 'laoshi-dsh-plugin'\n      config:\n        approvals: ${approvals}\n`;
      fs.writeFileSync(patchFile, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${block}`);
    }
    report("ok", `在 ${patchFile} 末尾挂载插件（审批策略 ${approvals}）`);
  }
  return [`重启 dsh（profile ${profile}），让插件生效`];
}

/** Removes laoshi's dsh plugin and its mount. */
export function uninstall({ args, config, env = process.env, report }) {
  const dshHome = dshHomeOf(args, config, env);
  const profile = args.profile ?? config?.platform?.dsh?.profile ?? "web";
  const profileDir = path.join(dshHome, "profiles", profile);
  fs.rmSync(path.join(profileDir, "node_modules", "laoshi-dsh-plugin"), { recursive: true, force: true });
  const patchFile = path.join(profileDir, "cordis.patch.yml");
  if (fs.existsSync(patchFile)) {
    const text = fs.readFileSync(patchFile, "utf8").replace(/- insert:\n\s+- id: laoshi-dsh\n(?:\s{6,}.*\n?)*/m, "");
    fs.writeFileSync(patchFile, text);
  }
  report("ok", `已从 dsh 的 profile ${profile} 移除 laoshi 的插件`);
}
