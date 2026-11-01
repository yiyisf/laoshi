// laoshi M2b: a repository's services and worktree setup for laoshi's builtin capabilities
// (ADR 0008, decision 3), in `.laoshi/services.json`:
//
//   {
//     "setup": ["npm ci", "node scripts/copy-env.mjs"],      // run in a new worktree, in order
//     "services": {
//       "web": { "command": "npm run dev -- --port {PORT}", "health": "/healthz" },
//       "api": { "command": "node server.js", "port": 4100 }
//     }
//   }
//
// A service gets a free port unless it names one; `{PORT}` in its command, and the environment
// variables PORT and LAOSHI_PORT, give it. Ready means: `health` (a path) answers over HTTP below
// 500, or else the port accepts connections. Commands run in the system's default shell
// (cmd.exe on Windows, /bin/sh elsewhere), never PowerShell, so plain program invocations work
// everywhere.

import fs from "node:fs";
import path from "node:path";

export const SERVICES_FILE = path.join(".laoshi", "services.json");

export interface ServiceDefinition {
  command: string;
  /** Fixed port; omitted: laoshi picks a free one (kept for the workspace while it is free). */
  port?: number;
  /** HTTP path that answers when the service is ready, e.g. "/healthz". */
  health?: string;
}

export interface ProjectServices {
  setup: string[];
  services: Record<string, ServiceDefinition>;
}

export class ServicesFileError extends Error {}

/** The repository's services file; null when it has none. Throws ServicesFileError when it is malformed. */
export function readProjectServices(repo: string): ProjectServices | null {
  const file = path.join(repo, SERVICES_FILE);
  if (!fs.existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new ServicesFileError(`${SERVICES_FILE} 不是合法的 JSON：${(error as Error).message}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ServicesFileError(`${SERVICES_FILE} 应当是一个对象`);
  const r = raw as { setup?: unknown; services?: unknown };
  const setup = r.setup === undefined ? [] : typeof r.setup === "string" ? [r.setup] : r.setup;
  if (!Array.isArray(setup) || setup.some((c) => typeof c !== "string" || !c.trim())) {
    throw new ServicesFileError(`${SERVICES_FILE} 的 setup 应当是命令的列表`);
  }
  const services: Record<string, ServiceDefinition> = {};
  const given = r.services ?? {};
  if (typeof given !== "object" || Array.isArray(given)) throw new ServicesFileError(`${SERVICES_FILE} 的 services 应当是一个对象`);
  for (const [name, value] of Object.entries(given as Record<string, unknown>)) {
    const s = value as Partial<ServiceDefinition> | null;
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new ServicesFileError(`${SERVICES_FILE} 中的服务名「${name}」只能用字母、数字、点、下划线和连字符`);
    if (!s || typeof s.command !== "string" || !s.command.trim()) throw new ServicesFileError(`${SERVICES_FILE} 中的服务 ${name} 没有 command`);
    if (s.port !== undefined && !(Number.isInteger(s.port) && s.port > 0 && s.port < 65536)) throw new ServicesFileError(`${SERVICES_FILE} 中的服务 ${name} 的 port 应当是 1–65535 的整数`);
    if (s.health !== undefined && (typeof s.health !== "string" || !s.health.startsWith("/"))) throw new ServicesFileError(`${SERVICES_FILE} 中的服务 ${name} 的 health 应当是以 / 开头的路径`);
    services[name] = { command: s.command, ...(s.port !== undefined ? { port: s.port } : {}), ...(s.health !== undefined ? { health: s.health } : {}) };
  }
  return { setup: (setup as string[]).map((c) => c.trim()), services };
}
