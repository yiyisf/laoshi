// laoshi M2c (ADR 0007, decisions 5 and 6): every run says which codebase and which person it is
// for, so one install root can serve several codebases and, in a team, several people.
//
// - Codebase: the repository a requirement belongs to. A worktree created for a requirement
//   belongs to the repository it was cut from, so the root is the main checkout (git's common
//   directory), and the remote is origin's address without credentials.
// - User: LAOSHI_USER, else the install-level config's "user", else the system user name.
//   Credentials never come from here: they stay in each person's own environment.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultConfigPath } from "./locations.js";

export interface Codebase {
  /** The main checkout's directory (a worktree's own repository, not the worktree). */
  root: string;
  /** origin's address, credentials removed; null without one. */
  remote: string | null;
}

function git(cwd: string, ...args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true }).trim() || null;
  } catch {
    return null;
  }
}

const real = (p: string) => (fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p));

/** "https://user:token@host/x.git" → "https://host/x.git"; scp-style addresses are kept. */
export function withoutCredentials(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]+@/i, "$1");
}

const cache = new Map<string, Codebase>();

/** The codebase `dir` belongs to; for a directory outside git, the directory itself. */
export function codebaseOf(dir: string): Codebase {
  const key = real(dir);
  const known = cache.get(key);
  if (known) return known;
  let root = key;
  const common = git(key, "rev-parse", "--path-format=absolute", "--git-common-dir");
  if (common) {
    // The common directory of a normal repository is <root>/.git; a bare one has no checkout.
    root = path.basename(common) === ".git" ? real(path.dirname(common)) : (git(key, "rev-parse", "--show-toplevel") ?? key);
  }
  const url = common ? git(key, "remote", "get-url", "origin") : null;
  const result = { root, remote: url ? withoutCredentials(url) : null };
  cache.set(key, result);
  return result;
}

/** Who this run is for. */
export function userOf(env: NodeJS.ProcessEnv = process.env): string {
  const named = env.LAOSHI_USER?.trim();
  if (named) return named;
  try {
    const raw = JSON.parse(fs.readFileSync(defaultConfigPath(env), "utf8")) as { user?: unknown };
    if (typeof raw.user === "string" && raw.user.trim()) return raw.user.trim();
  } catch {
    // No install-level config, or not readable: fall through.
  }
  try {
    return os.userInfo().username;
  } catch {
    return env.USERNAME ?? env.USER ?? "unknown";
  }
}
