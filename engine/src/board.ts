// `laoshi board [--port <端口>] [--repo <目录>] [--read-only] [--no-open]`:
// serves the shared Web requirement board (`ui/web/board.ts`) backed by `engine/src/api.ts`,
// usable standalone or embedded by a platform's web UI plugin.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { apiFile, apiList, apiRun, apiStatus, type ListItem } from "./api.js";
import { DEFAULT_CONFIG, loadConfig } from "./config.js";
import { defaultConfigPath } from "./locations.js";
import { wordsFor } from "./runtime-loader.js";
import type { RequirementView } from "../../ui/shared/view-model.js";
import { renderBoardHtml } from "../../ui/web/board.js";

const ALLOWED_ACTIONS = new Set(["approve", "stop", "resume", "verify", "sync", "start", "reply"]);

export function toRequirementView(item: ListItem): RequirementView {
  return {
    key: item.key,
    repo: item.repo,
    sourceRepo: item.sourceRepo,
    project: item.project,
    featureDir: item.featureDir,
    title: item.title,
    branch: item.branch,
    type: item.type,
    profile: item.profile,
    stage: item.stage,
    status: item.status,
    attention: item.attention,
    running: item.running,
    updatedAt: item.updatedAt,
    startedBy: item.startedBy,
    hasPrototype: item.hasPrototype,
    current: item.current,
    waiting: item.waiting,
  };
}

export interface BoardHandlers {
  list: () => RequirementView[];
  detail: (repo: string, feature: string) => unknown;
  file: (repo: string, feature: string, file: string) => unknown;
  run: (input: { action: string; repo: string; featureDir: string; text?: string; verifyEnv?: string }) => { ok: boolean; message: string };
}

export interface BoardServerOptions {
  handlers: BoardHandlers;
  platformName?: string;
  readOnly?: boolean;
  csrfToken?: string;
}

function readJsonBody(req: http.IncomingMessage, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      } catch {
        reject(new Error("无效的 JSON 请求体"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Creates an HTTP server for the shared requirement board and its local JSON API. */
export function createBoardServer(options: BoardServerOptions): { server: http.Server; csrfToken: string } {
  const csrfToken = options.csrfToken ?? crypto.randomBytes(16).toString("hex");
  const readOnly = Boolean(options.readOnly);
  const platformName = options.platformName ?? "laoshi";

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "GET" && url.pathname === "/") {
        const items = options.handlers.list();
        const html = renderBoardHtml(items, {
          title: "laoshi · 需求看板",
          platformName,
          readOnly,
          apiBase: "/api",
          csrfToken,
        });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        res.end(html);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/list") {
        sendJson(res, 200, { items: options.handlers.list() });
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/detail") {
        const repo = url.searchParams.get("repo") ?? "";
        const feature = url.searchParams.get("feature") ?? "";
        if (!repo || !feature) {
          sendJson(res, 400, { error: "缺少 repo 或 feature 参数" });
          return;
        }
        sendJson(res, 200, options.handlers.detail(repo, feature));
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/file") {
        const repo = url.searchParams.get("repo") ?? "";
        const feature = url.searchParams.get("feature") ?? "";
        const file = url.searchParams.get("file") ?? "";
        if (!repo || !feature || !file) {
          sendJson(res, 400, { error: "缺少 repo、feature 或 file 参数" });
          return;
        }
        sendJson(res, 200, options.handlers.file(repo, feature, file));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/action") {
        if (readOnly) {
          sendJson(res, 403, { ok: false, error: "看板当前为只读模式" });
          return;
        }
        if (req.headers["x-laoshi-token"] !== csrfToken) {
          sendJson(res, 403, { ok: false, error: "缺少或无效的令牌" });
          return;
        }
        const body = await readJsonBody(req);
        const action = typeof body.action === "string" ? body.action : "";
        const repo = typeof body.repo === "string" ? body.repo : "";
        const featureDir = typeof body.featureDir === "string" ? body.featureDir : "";
        if (!ALLOWED_ACTIONS.has(action) || !repo || !featureDir) {
          sendJson(res, 400, { ok: false, error: "无效的操作或缺少目标需求" });
          return;
        }
        const result = options.handlers.run({
          action,
          repo,
          featureDir,
          text: typeof body.text === "string" ? body.text : undefined,
          verifyEnv: typeof body.verifyEnv === "string" ? body.verifyEnv : undefined,
        });
        sendJson(res, 200, result);
        return;
      }
      sendJson(res, 404, { error: "未找到路径" });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: (error as Error).message });
    }
  });

  return { server, csrfToken };
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.unref();
  } catch {
    // Best effort only.
  }
}

function parseArgs(argv: string[]): { port: number; repo: string | null; readOnly: boolean; noOpen: boolean; help: boolean } {
  let port = 0;
  let repo: string | null = null;
  let readOnly = false;
  let noOpen = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") help = true;
    else if (a === "--read-only") readOnly = true;
    else if (a === "--no-open") noOpen = true;
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]) || 0;
    else if (a.startsWith("--port=")) port = Number(a.slice(7)) || 0;
    else if (a === "--repo" && argv[i + 1]) repo = path.resolve(argv[++i]);
    else if (a.startsWith("--repo=")) repo = path.resolve(a.slice(7));
  }
  return { port, repo, readOnly, noOpen, help };
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    console.log("用法：laoshi board [--port <端口>] [--repo <目录>] [--read-only] [--no-open]");
    console.log("在本机打开需求看板网页（展示所有待处理、进行中、待测试与已完成需求，支持查看产物与执行操作）。");
    return 0;
  }
  let platformName = "laoshi";
  try {
    const loaded = loadConfig(defaultConfigPath(), args.repo ?? process.cwd());
    platformName = wordsFor(loaded.config).name;
  } catch {
    platformName = wordsFor(DEFAULT_CONFIG).name;
  }

  const handlers: BoardHandlers = {
    list: () => apiList({ repo: args.repo ?? process.cwd(), all: !args.repo }).map(toRequirementView),
    detail: (repo, feature) => apiStatus(repo, feature),
    file: (repo, feature, file) => apiFile(repo, feature, file),
    run: ({ action, repo, featureDir, text, verifyEnv }) => {
      const extra: string[] = [];
      if (verifyEnv) extra.push("--verify-env", verifyEnv);
      if (text) extra.push(text);
      return apiRun(action, repo, featureDir, extra);
    },
  };

  const { server } = createBoardServer({ handlers, platformName, readOnly: args.readOnly });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(args.port, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : args.port;
  const url = `http://127.0.0.1:${actualPort}/`;
  console.log(`需求看板已启动：${url}${args.readOnly ? "（只读模式）" : ""}`);
  console.log("按 Ctrl+C 停止。");
  if (!args.noOpen) openBrowser(url);

  await new Promise<void>((resolve) => {
    const stop = () => {
      server.close(() => resolve());
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: Error) => {
      console.error(`启动需求看板失败：${error.message}`);
      process.exit(1);
    },
  );
}
