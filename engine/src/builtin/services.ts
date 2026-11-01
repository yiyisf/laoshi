// laoshi M2b: builtin service management (ADR 0008, decision 3) for platforms that do not run a
// repository's services themselves. Services come from .laoshi/services.json; each runs detached
// from the engine (so `req try` can start one and a later `req try --stop` stop it), with its
// output in a log file and its process, port and exit code under the kit home.
//
// Windows: commands run through cmd.exe and process trees are stopped with taskkill; nothing
// here starts PowerShell (it may be blocked outright on the intranet's machines).

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import type { ManagedService, ServiceTarget } from "../runtime.js";
import { readProjectServices, SERVICES_FILE, type ServiceDefinition } from "./project-services.js";
import { directoryOfTarget, workspaceStateDir } from "./workspace.js";

interface ServiceRecord {
  name: string;
  pid: number | null;
  port: number;
  command: string;
  startedAt: string;
  exitCode: number | null;
}

export interface BuiltinServices {
  listServices(target: ServiceTarget): Promise<string[] | null>;
  startServices(target: ServiceTarget, names: string[], readyTimeoutMs: number): Promise<ManagedService[]>;
  stopServices(target: ServiceTarget, names: string[]): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function alive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Stops a process and everything it started. */
export async function killTree(pid: number): Promise<void> {
  if (!alive(pid)) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      // Already gone.
    }
    return;
  }
  // Started detached: the service leads its own process group.
  const signal = (s: NodeJS.Signals) => {
    try {
      process.kill(-pid, s);
    } catch {
      try {
        process.kill(pid, s);
      } catch {
        // Already gone.
      }
    }
  };
  signal("SIGTERM");
  for (let i = 0; i < 50 && alive(pid); i++) await sleep(100);
  if (alive(pid)) signal("SIGKILL");
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

function answers(port: number, health: string | undefined): Promise<boolean> {
  return new Promise((resolve) => {
    if (health) {
      const req = http.get({ host: "127.0.0.1", port, path: health, timeout: 2000 }, (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) < 500);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => req.destroy());
      return;
    }
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(2000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function tail(file: string, lines = 40): string | null {
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, "r");
    const length = Math.min(size, 16_384);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    fs.closeSync(fd);
    const text = buffer.toString("utf8").split(/\r?\n/).slice(-lines).join("\n").trim();
    return text || null;
  } catch {
    return null;
  }
}

export function builtinServices(options: {
  env?: NodeJS.ProcessEnv;
  log: (message: string) => void;
  /** The chat's working directory, for services of the chat's own checkout. */
  agentDirectory?: (agentId: string) => Promise<string | null>;
  pollMs?: number;
}): BuiltinServices {
  const env = options.env ?? process.env;
  const pollMs = options.pollMs ?? 500;
  const dirs = (directory: string) => {
    const dir = path.join(workspaceStateDir(directory, env), "services");
    return { dir, record: (name: string) => path.join(dir, `${name}.json`), log: (name: string) => path.join(dir, `${name}.log`) };
  };
  const readRecord = (file: string): ServiceRecord | null => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as ServiceRecord;
    } catch {
      return null;
    }
  };

  async function resolve(target: ServiceTarget): Promise<string> {
    const directory = await directoryOfTarget(target, options.agentDirectory);
    if (!directory) throw new Error("找不到服务所在的目录（不是 laoshi 新建的工作区，也读不到对话的工作目录）");
    return directory;
  }

  async function stopOne(directory: string, name: string): Promise<void> {
    const paths = dirs(directory);
    const rec = readRecord(paths.record(name));
    if (!rec?.pid) return;
    await killTree(rec.pid);
    fs.writeFileSync(paths.record(name), JSON.stringify({ ...rec, pid: null }));
  }

  async function startOne(directory: string, name: string, def: ServiceDefinition): Promise<{ rec: ServiceRecord; exited: () => boolean }> {
    const paths = dirs(directory);
    fs.mkdirSync(paths.dir, { recursive: true });
    const previous = readRecord(paths.record(name));
    let port: number;
    if (def.port) {
      port = def.port;
      if (!(await portFree(port))) throw new Error(`服务 ${name} 的端口 ${port} 已被占用（${SERVICES_FILE} 中写死了这个端口）`);
    } else {
      // Keep the workspace's port while it is free, so the address stays the same between runs.
      port = previous?.port && (await portFree(previous.port)) ? previous.port : await freePort();
    }
    const command = def.command.replaceAll("{PORT}", String(port));
    const out = fs.openSync(paths.log(name), "a");
    fs.writeSync(out, `\n[laoshi] ${new Date().toISOString()} 启动：${command}（端口 ${port}）\n`);
    // The system's default shell: cmd.exe on Windows (never PowerShell), /bin/sh elsewhere.
    const child = spawn(command, {
      cwd: directory,
      env: { ...env, PORT: String(port), LAOSHI_PORT: String(port) },
      shell: true,
      detached: true,
      stdio: ["ignore", out, out],
      windowsHide: true,
    });
    fs.closeSync(out);
    let exited = false;
    const rec: ServiceRecord = { name, pid: child.pid ?? null, port, command, startedAt: new Date().toISOString(), exitCode: null };
    fs.writeFileSync(paths.record(name), JSON.stringify(rec));
    child.on("exit", (code) => {
      exited = true;
      rec.exitCode = code;
      rec.pid = null;
      fs.writeFileSync(paths.record(name), JSON.stringify(rec));
    });
    child.on("error", (error) => options.log(`服务 ${name} 启动失败：${error.message}`));
    child.unref();
    return { rec, exited: () => exited };
  }

  return {
    async listServices(target) {
      const directory = await directoryOfTarget(target, options.agentDirectory);
      if (!directory) return null;
      try {
        const names = Object.keys(readProjectServices(directory)?.services ?? {});
        return names.length ? names : null;
      } catch (error) {
        options.log(`无法读取服务定义：${(error as Error).message}`);
        return null;
      }
    },

    async startServices(target, names, readyTimeoutMs) {
      const directory = await resolve(target);
      const defs = readProjectServices(directory)?.services ?? {};
      const missing = names.filter((n) => !defs[n]);
      if (missing.length) throw new Error(`${SERVICES_FILE} 中没有服务 ${missing.join("、")}`);
      const started: Array<{ name: string; def: ServiceDefinition; rec: ServiceRecord; exited: () => boolean }> = [];
      for (const name of names) {
        // Stop first so the service runs the code as it is now.
        await stopOne(directory, name);
        started.push({ name, def: defs[name], ...(await startOne(directory, name, defs[name])) });
      }
      const deadline = Date.now() + readyTimeoutMs;
      const ready = new Map<string, boolean>();
      for (;;) {
        for (const s of started) {
          if (ready.get(s.name) || s.exited()) continue;
          if (await answers(s.rec.port, s.def.health)) ready.set(s.name, true);
        }
        if (started.every((s) => ready.get(s.name) || s.exited()) || Date.now() >= deadline) break;
        await sleep(pollMs);
      }
      return started.map((s): ManagedService => {
        const running = !s.exited() && alive(s.rec.pid);
        return {
          name: s.name,
          url: `http://127.0.0.1:${s.rec.port}`,
          port: s.rec.port,
          running,
          health: ready.get(s.name) ? "healthy" : running ? "unhealthy" : null,
          exitCode: s.rec.exitCode,
          output: tail(dirs(directory).log(s.name)),
        };
      });
    },

    async stopServices(target, names) {
      const directory = await directoryOfTarget(target, options.agentDirectory);
      if (!directory) return;
      for (const name of names) await stopOne(directory, name).catch((error: Error) => options.log(`停止服务 ${name} 失败：${error.message}`));
    },
  };
}
