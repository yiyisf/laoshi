// laoshi M2b: builtin workspaces (ADR 0008, decision 3). A requirement's own worktree is a plain
// `git worktree`; its workspace ID is "dir:" plus the directory, so any process can find it again.
// Setup commands (.laoshi/services.json "setup") run in the background (setup-runner.mjs), and
// their status is kept under the kit home for waitForWorkspaceSetup.

import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { kitHome } from "../locations.js";
import type { ServiceTarget, WorktreeRequest } from "../runtime.js";
import { readProjectServices } from "./project-services.js";

const PREFIX = "dir:";
const RUNNER = path.join(path.dirname(fileURLToPath(import.meta.url)), "setup-runner.mjs");

export const workspaceIdOf = (directory: string): string => `${PREFIX}${fs.existsSync(directory) ? fs.realpathSync(directory) : path.resolve(directory)}`;

/** The directory of a builtin workspace ID; null for any other platform's ID. */
export function directoryOfWorkspace(workspaceId: string): string | null {
  return workspaceId.startsWith(PREFIX) ? workspaceId.slice(PREFIX.length) : null;
}

const short = (text: string) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 12);

/** Where laoshi keeps what it knows about a workspace directory (setup status, services). */
export function workspaceStateDir(directory: string, env: NodeJS.ProcessEnv = process.env): string {
  const real = fs.existsSync(directory) ? fs.realpathSync(directory) : path.resolve(directory);
  return path.join(kitHome(env), "workspaces", `${path.basename(real).replace(/[^A-Za-z0-9._-]/g, "_")}-${short(real)}`);
}

/** Where a new worktree goes: under the kit home, one folder per source repository. */
export function worktreeDirectory(sourceRepo: string, branchName: string, env: NodeJS.ProcessEnv = process.env): string {
  const real = fs.realpathSync(sourceRepo);
  return path.join(kitHome(env), "worktrees", `${path.basename(real)}-${short(real)}`, branchName.replace(/[^A-Za-z0-9._-]+/g, "-"));
}

function git(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.toString().trim();
    throw new Error(`git ${args.join(" ")} 失败：${stderr || (error as Error).message}`);
  }
}

export interface BuiltinWorkspaces {
  createWorktree(request: WorktreeRequest): Promise<{ workspaceId: string; directory: string }>;
  openWorkspace(directory: string): Promise<{ workspaceId: string }>;
  waitForWorkspaceSetup(workspaceId: string, timeoutMs: number): Promise<{ status: "completed" | "failed" | "none" | "timeout"; error: string | null }>;
}

export function builtinWorkspaces(options: { env?: NodeJS.ProcessEnv; log: (message: string) => void; pollMs?: number }): BuiltinWorkspaces {
  const env = options.env ?? process.env;
  const pollMs = options.pollMs ?? 2000;
  return {
    async createWorktree(request) {
      const directory = worktreeDirectory(request.sourceRepo, request.branchName, env);
      if (fs.existsSync(directory)) throw new Error(`工作区目录 ${directory} 已经存在：请确认是否有同名需求的旧工作区（git worktree list）`);
      fs.mkdirSync(path.dirname(directory), { recursive: true });
      git(request.sourceRepo, "worktree", "add", "-b", request.branchName, directory, request.baseRef);
      const real = fs.realpathSync(directory);
      startSetup(real, fs.realpathSync(request.sourceRepo), env, options.log);
      return { workspaceId: workspaceIdOf(real), directory: real };
    },

    async openWorkspace(directory) {
      if (!fs.existsSync(directory)) throw new Error(`工作区目录 ${directory} 不存在`);
      return { workspaceId: workspaceIdOf(directory) };
    },

    async waitForWorkspaceSetup(workspaceId, timeoutMs) {
      const directory = directoryOfWorkspace(workspaceId);
      if (!directory) return { status: "none", error: null };
      const file = path.join(workspaceStateDir(directory, env), "setup.json");
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        let s: { status?: string; error?: string | null; pid?: number } | null = null;
        try {
          s = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch {
          // Not started (no setup commands), or being written.
        }
        if (!s) {
          if (!fs.existsSync(path.join(workspaceStateDir(directory, env), "setup.job.json"))) return { status: "none", error: null };
        } else if (s.status === "completed") return { status: "completed", error: null };
        else if (s.status === "failed") return { status: "failed", error: s.error ?? null };
        else if (s.pid && !alive(s.pid)) return { status: "failed", error: "准备命令的进程意外退出" };
        if (Date.now() >= deadline) return { status: "timeout", error: null };
        await new Promise((r) => setTimeout(r, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
      }
    },
  };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Starts the worktree's setup commands in the background; nothing when it has none. */
function startSetup(directory: string, sourceRepo: string, env: NodeJS.ProcessEnv, log: (message: string) => void): void {
  let commands: string[] = [];
  try {
    commands = readProjectServices(directory)?.setup ?? [];
  } catch (error) {
    log(`没有运行新工作区的准备命令：${(error as Error).message}`);
    return;
  }
  if (commands.length === 0) return;
  const stateDir = workspaceStateDir(directory, env);
  fs.mkdirSync(stateDir, { recursive: true });
  const jobFile = path.join(stateDir, "setup.job.json");
  fs.rmSync(path.join(stateDir, "setup.json"), { force: true });
  fs.writeFileSync(
    jobFile,
    JSON.stringify({
      cwd: directory,
      commands,
      env: { LAOSHI_SOURCE_CHECKOUT_PATH: sourceRepo, LAOSHI_WORKTREE_PATH: directory },
      statusFile: path.join(stateDir, "setup.json"),
      logFile: path.join(stateDir, "setup.log"),
    }),
  );
  const child = spawn(process.execPath, [RUNNER, jobFile], { cwd: directory, detached: true, stdio: "ignore", windowsHide: true, env });
  child.unref();
  log(`新工作区的准备命令已在后台运行（${commands.length} 条），输出见 ${path.join(stateDir, "setup.log")}`);
}

/** The directory a service target means, for builtin services: a builtin workspace, or the chat's directory. */
export async function directoryOfTarget(target: ServiceTarget, agentDirectory: ((agentId: string) => Promise<string | null>) | undefined): Promise<string | null> {
  if ("workspaceId" in target) return directoryOfWorkspace(target.workspaceId);
  return agentDirectory ? agentDirectory(target.agentId).catch(() => null) : null;
}
