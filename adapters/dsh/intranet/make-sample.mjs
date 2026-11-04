#!/usr/bin/env node
// A small sample repository for verifying laoshi on the intranet (docs/intranet/install-verify.md):
// a git repo on main with a function and its tests, an HTTP service, .laoshi/services.json (a
// setup command and the service) and .laoshi.json (the quality gate's check). Only needs Node.js and git.
//
//   node adapters/dsh/intranet/make-sample.mjs <directory> [--name <project name>]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({ allowPositionals: true, options: { name: { type: "string" } } });
if (positionals.length !== 1) {
  console.error("用法：node make-sample.mjs <目录> [--name <项目名>]");
  process.exit(2);
}
const dir = path.resolve(positionals[0]);
if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
  console.error(`${dir} 已存在且不为空：换一个目录`);
  process.exit(1);
}
const name = values.name ?? path.basename(dir);
const files = {
  "package.json": JSON.stringify({ name, version: "1.0.0", private: true, type: "module", scripts: { test: "node --test test/", start: "node server.mjs" } }, null, 2),
  "README.md": `# ${name}\n\nlaoshi 内网验证用的样例项目：一个文本工具函数（src/text.mjs）和一个小的 HTTP 服务（server.mjs）。\n\n- 测试：\`npm test\`\n- 启动服务：\`node server.mjs 3000\`（端口也可以用环境变量 PORT），健康检查 \`/healthz\`，接口 \`/api/title?text=...\`\n`,
  "src/text.mjs": `// Text helpers.\n\n/** Capitalizes the first letter of every word: "hello world" -> "Hello World". */\nexport function titleCase(text) {\n  return text\n    .split(" ")\n    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))\n    .join(" ");\n}\n`,
  "test/text.test.mjs": `import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { titleCase } from "../src/text.mjs";\n\ntest("titleCase capitalizes each word", () => {\n  assert.equal(titleCase("hello world"), "Hello World");\n});\n`,
  "server.mjs": `import http from "node:http";\nimport { titleCase } from "./src/text.mjs";\n\nconst port = Number(process.argv[2] ?? process.env.PORT ?? 3000);\nhttp\n  .createServer((req, res) => {\n    const url = new URL(req.url, "http://localhost");\n    if (url.pathname === "/healthz") return res.end("ok");\n    if (url.pathname === "/api/title") {\n      res.setHeader("content-type", "application/json; charset=utf-8");\n      return res.end(JSON.stringify({ result: titleCase(url.searchParams.get("text") ?? "") }));\n    }\n    res.statusCode = 404;\n    res.end("not found");\n  })\n  .listen(port, "127.0.0.1", () => console.log(\`listening on \${port}\`));\n`,
  ".laoshi/services.json": JSON.stringify(
    { setup: ['node -e "require(\'fs\').writeFileSync(\'setup-done.txt\', String(process.env.LAOSHI_SOURCE_CHECKOUT_PATH))"'], services: { web: { command: "node server.mjs {PORT}", health: "/healthz" } } },
    null,
    2,
  ),
  ".laoshi.json": JSON.stringify({ defaultProfile: "quick", checks: [{ name: "单元测试", command: "npm test" }] }, null, 2),
  ".gitignore": "node_modules/\nsetup-done.txt\ndocs/features/*/.pipeline/\n",
};
for (const [rel, text] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text.endsWith("\n") ? text : `${text}\n`);
}
const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "ignore", windowsHide: true });
git("init", "-q");
git("checkout", "-q", "-b", "main");
try {
  execFileSync("git", ["config", "user.name"], { cwd: dir, stdio: "ignore" });
} catch {
  git("config", "user.name", "laoshi 验证");
  git("config", "user.email", "laoshi-verify@localhost");
}
git("add", "-A");
git("commit", "-q", "-m", "样例项目");
console.log(`已建好样例项目 ${dir}（分支 main，已提交）`);
