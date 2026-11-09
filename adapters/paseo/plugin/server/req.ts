// Runs `laoshi api …` with the laoshi this machine has installed, and parses its one line of JSON
// (contracts/cli-json.md). The plugin never reads or writes laoshi's files itself.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export class ReqError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * laoshi's install root: the plugin setting, else LAOSHI_HOME, else the root the plugin is
 * installed in (`laoshi plugin install` copies it to <install root>/paseo-plugin), else ~/.laoshi.
 */
export function kitHomeOf(configured: string, here: string = path.dirname(fileURLToPath(import.meta.url))): string {
  if (configured.trim()) return path.resolve(configured.trim().replace(/^~(?=$|[\\/])/, os.homedir()));
  const env = process.env.LAOSHI_HOME?.trim();
  if (env) return path.resolve(env);
  const root = path.resolve(here, "..", "..");
  if (path.basename(path.resolve(here, "..")) === "paseo-plugin" && fs.existsSync(path.join(root, "install.json"))) return root;
  return path.join(os.homedir(), ".laoshi");
}

/** The installed laoshi's req.mjs, from <install root>/install.json (written by laoshi install). */
export function activeReq(kitHome: string): string {
  const file = path.join(kitHome, "install.json");
  let installed: { root?: string } | null = null;
  try {
    installed = JSON.parse(fs.readFileSync(file, "utf8")) as { root?: string };
  } catch {
    throw new ReqError("no_kit", `这台机器上没有找到 laoshi（${file}）。请先安装 laoshi：laoshi install --platform paseo。`);
  }
  const req = installed?.root ? path.join(installed.root, "bin", "req.mjs") : "";
  if (!req || !fs.existsSync(req)) throw new ReqError("no_kit", `laoshi 的程序不在了（${installed?.root ?? "未知"}）。请重新安装：laoshi install --platform paseo。`);
  return req;
}

/** A node to run laoshi with: this process's when it is node, else the one on PATH. */
function nodeBinary(): string {
  const base = path.basename(process.execPath).toLowerCase();
  return base === "node" || base === "node.exe" ? process.execPath : "node";
}

export interface ReqRunner {
  (args: string[], options?: { timeoutMs?: number }): Promise<unknown>;
}

/** Runs `laoshi api <args>` and returns its data, or throws ReqError with laoshi's message. */
export function reqApi(kitHome: () => string): ReqRunner {
  return (args, options = {}) =>
    new Promise((resolve, reject) => {
      let req: string;
      const home = kitHome();
      try {
        req = activeReq(home);
      } catch (error) {
        reject(error);
        return;
      }
      const env: NodeJS.ProcessEnv = { ...process.env, LAOSHI_HOME: home };
      // Not a chat: the run keeps reporting to the chat that started it.
      delete env.PASEO_AGENT_ID;
      delete env.PASEO_AGENT_CWD;
      execFile(
        nodeBinary(),
        [req, "api", ...args],
        { env, timeout: options.timeoutMs ?? 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
        (error, stdout, stderr) => {
          const line = stdout.trim().split("\n").pop() ?? "";
          let parsed: { schema?: number; data?: unknown; error?: { code: string; message: string } } | null = null;
          try {
            parsed = JSON.parse(line);
          } catch {
            parsed = null;
          }
          if (parsed?.error) return reject(new ReqError(parsed.error.code, parsed.error.message));
          if (parsed && "data" in parsed) return resolve(parsed.data);
          const why = (stderr || error?.message || "没有输出").trim().split("\n").slice(-3).join(" ");
          reject(new ReqError("failed", `laoshi api ${args[0] ?? ""} 失败：${why}`));
        },
      );
    });
}

/** The same call made twice within `ms` shares one run (several open screens, one daemon). */
export function coalesce<T>(ms: number, run: () => Promise<T>): () => Promise<T> {
  let last: { at: number; value: Promise<T> } | null = null;
  return () => {
    const now = Date.now();
    if (last && now - last.at < ms) return last.value;
    const value = run();
    last = { at: now, value };
    value.catch(() => {
      if (last?.value === value) last = null;
    });
    return value;
  };
}
