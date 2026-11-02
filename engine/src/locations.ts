import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Where things live.
//
//   <kit root>/                 one installed version of req-kit, e.g. ~/tools/req-kit/versions/1.0.0
//     bin/start-pipeline.mjs    launcher the /req skill runs
//     engine/prompts/           step prompts shipped with this version
//     principles/INDEX.md       principles shared by the chat skills and the step prompts
//   <kit home>/                 machine settings that survive upgrades, default ~/.req-kit
//     config.json               machine configuration
//     prompts.local/            machine-wide prompt overrides (same file names as engine/prompts)

export const ENGINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const KIT_ROOT = path.resolve(ENGINE_DIR, "..");
export const LAUNCHER = path.join(KIT_ROOT, "bin", "start-pipeline.mjs");
export const PROMPTS_DIR = path.join(ENGINE_DIR, "prompts");
export const PRINCIPLES_INDEX = path.join(KIT_ROOT, "principles", "INDEX.md");

/**
 * The install root (ADR 0007): install-level configuration, usage records, the requirement index,
 * builtin worktrees and services. laoshi M2c: LAOSHI_HOME names it; REQ_KIT_HOME (req-kit's name)
 * still works. Without either, ~/.laoshi; a machine that only has req-kit's ~/.req-kit keeps using
 * it, so an existing setup carries on until it is migrated.
 */
export function kitHome(env: NodeJS.ProcessEnv = process.env): string {
  return homeOf(env).dir;
}

export type HomeSource = "LAOSHI_HOME" | "REQ_KIT_HOME" | "default" | "legacy";

/** The install root and how it was chosen (for doctor). */
export function homeOf(env: NodeJS.ProcessEnv = process.env, home: string = os.homedir()): { dir: string; source: HomeSource } {
  const laoshi = env.LAOSHI_HOME?.trim();
  if (laoshi) return { dir: path.resolve(laoshi), source: "LAOSHI_HOME" };
  const legacyEnv = env.REQ_KIT_HOME?.trim();
  if (legacyEnv) return { dir: path.resolve(legacyEnv), source: "REQ_KIT_HOME" };
  const preferred = path.join(home, ".laoshi");
  const legacy = path.join(home, ".req-kit");
  if (!fs.existsSync(preferred) && fs.existsSync(path.join(legacy, "config.json"))) return { dir: legacy, source: "legacy" };
  return { dir: preferred, source: "default" };
}

export function defaultConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(kitHome(env), "config.json");
}

export function localPromptsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(kitHome(env), "prompts.local");
}

export function kitVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** An installed dependency, looked up like Node does (see bin/locate.mjs). */
export function findDependency(name: string, fromDir: string = KIT_ROOT): string | null {
  let dir = path.resolve(fromDir);
  for (;;) {
    const candidate = path.join(dir, "node_modules", ...name.split("/"));
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
