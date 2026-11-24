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
  "no-board": { type: "boolean" },
  "board-port": { type: "string" },
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
      const reason = String(error.stderr || error.message || "").trim().split("\n").at(-1) || `退出码 ${error.status ?? "未知"}`;
      report("info", `dsh plugin add 没有成功（${reason}），改为直接复制到 profile`);
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
  const enableBoard = !args["no-board"];
  const boardPort = args["board-port"] ? Number(args["board-port"]) || 0 : 0;
  if (current.includes("laoshi-dsh-plugin")) {
    const upgraded = upgradeCordisPatch(current, { kitRoot: slash(kit), enableBoard, boardPort });
    if (upgraded === null) {
      report("ok", `${patchFile} 中已挂载插件，不改动（审批与看板配置以文件中的为准）`);
    } else {
      if (!dry) fs.writeFileSync(patchFile, upgraded.text);
      report("ok", `已为 ${patchFile} 中的插件配置补齐 kitRoot${upgraded.addedBoard ? ` 与 board: ${enableBoard}` : ""}（保留原有审批设置）`);
    }
  } else {
    if (!dry) {
      fs.mkdirSync(profileDir, { recursive: true });
      const extraLines = [
        `        kitRoot: '${slash(kit)}'`,
        `        board: ${enableBoard}`,
        ...(boardPort > 0 ? [`        boardPort: ${boardPort}`] : []),
      ];
      const block = `- insert:\n    - id: laoshi-dsh\n      name: 'laoshi-dsh-plugin'\n      config:\n        approvals: ${approvals}\n${extraLines.join("\n")}\n`;
      fs.writeFileSync(patchFile, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${block}`);
    }
    report("ok", `在 ${patchFile} 末尾挂载插件（审批策略 ${approvals}，需求看板${enableBoard ? "已启用" : "已关闭"}）`);
  }
  return [
    `重启 dsh（profile ${profile}），即可在 dsh 左侧导航栏看到「需求看板」`,
    "运行 laoshi doctor 可检查插件、托管看板与页面挂载状态；也可随时运行 laoshi board 单独打开",
  ];
}

function upgradeCordisPatch(current, { kitRoot, enableBoard, boardPort }) {
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const lines = current.replace(/\r\n/g, "\n").split("\n");
  const nameIdx = lines.findIndex((l) => /^\s*(?:-\s*)?name\s*:\s*['"]?laoshi-dsh-plugin['"]?\s*(?:#.*)?$/.test(l));
  if (nameIdx < 0) return null;
  const nameIndent = lines[nameIdx].match(/^\s*/)[0].length;
  const isDashName = /^\s*-\s*name\s*:/.test(lines[nameIdx]);
  let itemStart = nameIdx;
  if (!isDashName && nameIdx > 0 && /^\s*-\s/.test(lines[nameIdx - 1])) itemStart = nameIdx - 1;
  const entryIndent = lines[itemStart].match(/^\s*/)[0].length;
  const keyIndent = isDashName ? nameIndent + 2 : nameIndent;

  let itemEnd = lines.length;
  for (let i = nameIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (l.match(/^\s*/)[0].length <= entryIndent) {
      itemEnd = i;
      break;
    }
  }
  while (itemEnd > nameIdx + 1 && !lines[itemEnd - 1].trim()) itemEnd--;

  const block = lines.slice(itemStart, itemEnd);
  if (block.some((l) => /^\s*kitRoot\s*:/.test(l))) return null;
  const hasBoard = block.some((l) => /^\s*board\s*:/.test(l));
  const hasBoardPort = block.some((l) => /^\s*boardPort\s*:/.test(l));
  const relCfg = block.findIndex((l) => /^\s*config\s*:/.test(l));

  if (relCfg >= 0) {
    const cfgIdx = itemStart + relCfg;
    const cfgIndent = lines[cfgIdx].match(/^\s*/)[0].length;
    if (/^\s*config\s*:\s*\{\s*\}\s*(?:#.*)?$/.test(lines[cfgIdx])) lines[cfgIdx] = `${" ".repeat(cfgIndent)}config:`;
    let cfgEnd = itemEnd;
    let childIndent = cfgIndent + 2;
    let sawChild = false;
    for (let i = cfgIdx + 1; i < itemEnd; i++) {
      const l = lines[i];
      if (!l.trim()) continue;
      const ind = l.match(/^\s*/)[0].length;
      if (ind <= cfgIndent) {
        cfgEnd = i;
        break;
      }
      if (!sawChild) {
        childIndent = ind;
        sawChild = true;
      }
    }
    while (cfgEnd > cfgIdx + 1 && !lines[cfgEnd - 1].trim()) cfgEnd--;
    const pad = " ".repeat(childIndent);
    const add = [`${pad}kitRoot: '${kitRoot}'`];
    if (!hasBoard) add.push(`${pad}board: ${enableBoard}`);
    if (!hasBoardPort && boardPort > 0) add.push(`${pad}boardPort: ${boardPort}`);
    lines.splice(cfgEnd, 0, ...add);
  } else {
    const cfgPad = " ".repeat(keyIndent);
    const childPad = " ".repeat(keyIndent + 2);
    const add = [`${cfgPad}config:`, `${childPad}kitRoot: '${kitRoot}'`];
    if (!hasBoard) add.push(`${childPad}board: ${enableBoard}`);
    if (!hasBoardPort && boardPort > 0) add.push(`${childPad}boardPort: ${boardPort}`);
    lines.splice(itemEnd, 0, ...add);
  }
  const nextText = lines.join(eol);
  return { text: nextText, addedBoard: !hasBoard };
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
