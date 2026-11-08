#!/usr/bin/env node
// Builds the 摸高 expert: laoshi's skills rendered for 摸高, as they will run there (the program in
// the workspace, /data/workspace/.laoshi/npm/node_modules/<package>, installed on first use by the
// skills themselves), and a short description of the expert. The result is what is submitted to the
// platform as the expert (a directory and a zip of it).
//
//   node adapters/mogao/make-expert.mjs [--out <dir>]
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(kit, "package.json"), "utf8"));
const { values } = parseArgs({ options: { out: { type: "string", default: path.join(kit, "dist-expert") } } });
const WORKSPACE_HOME = "/data/workspace/.laoshi";
const programRoot = `${WORKSPACE_HOME}/npm/node_modules/${pkg.name}`;
const name = `laoshi-expert-${pkg.version}`;
const out = path.resolve(values.out, name);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const config = path.join(out, ".render-config.json");
fs.writeFileSync(config, JSON.stringify({ platform: { adapter: "mogao" } }));
const tsx = path.join(kit, "node_modules", "tsx", "dist", "cli.mjs");
const r = spawnSync(process.execPath, [tsx, path.join(kit, "engine", "src", "skills-render.ts"), "--out", path.join(out, "skills"), "--config", config, "--root", programRoot], { encoding: "utf8" });
fs.rmSync(config);
if (r.status !== 0) {
  console.error(r.stderr || r.stdout);
  process.exit(1);
}

const skills = fs.readdirSync(path.join(out, "skills")).filter((d) => fs.existsSync(path.join(out, "skills", d, "SKILL.md")));
const describe = (d) => /^description:\s*(.+)$/m.exec(fs.readFileSync(path.join(out, "skills", d, "SKILL.md"), "utf8"))?.[1] ?? "";
fs.writeFileSync(
  path.join(out, "EXPERT.md"),
  [
    `# laoshi 需求开发专家（${pkg.version}）`,
    "",
    "给测试、产品、项目经理用：在对话里把需求谈清楚、写成需求说明并确认，之后由一组 agent 完成方案、实现、评审、验证和报告，每个要拍板的地方都停下来等人。",
    "",
    "- 入口：`/laoshi`（需求开发）、`/laoshi-setup`（项目接入，每个项目一次）、`/laoshi-doctor`（体检）、`/laoshi-retro`（复盘）",
    `- 第一次使用时，入口 skill 会从内网 npm 镜像把 \`${pkg.name}@${pkg.version}\` 装到 \`${WORKSPACE_HOME}\`（约一分钟），之后每个对话直接使用`,
    "- 每一步是摸高的一个独立 agent（`aimax run`）；需要批准的操作走摸高的人工审批；进度和用量来自摸高的回调",
    "- 使用说明（第一次使用、项目接入、运行期间不要结束对话、等待批准怎么回答、常见问题）：https://yiyisf.github.io/laoshi/guide/mogao",
    "",
    "## 包含的 skill",
    "",
    "| skill | 作用 |",
    "| --- | --- |",
    ...skills.sort().map((d) => `| \`${d}\` | ${describe(d).replace(/\|/g, "\\|")} |`),
    "",
  ].join("\n"),
);

const zip = path.resolve(values.out, `${name}.zip`);
fs.rmSync(zip, { force: true });
try {
  execFileSync("zip", ["-qr", zip, name], { cwd: path.resolve(values.out) });
  console.log(`已生成专家：${out}\n压缩包：${zip}`);
} catch {
  console.log(`已生成专家：${out}（没有 zip 命令，未打包）`);
}
