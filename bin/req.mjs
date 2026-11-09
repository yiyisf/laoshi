#!/usr/bin/env node
// The `laoshi` command (alias `req`): short names for the things people do in a terminal.
// npm puts it on PATH; `laoshi install` also writes <install root>/bin/laoshi (and .cmd) pointing here.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findTsxCli } from "./locate.mjs";

const kitRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { name: packageName, version } = JSON.parse(fs.readFileSync(path.join(kitRoot, "package.json"), "utf8"));
const tsxCli = findTsxCli(kitRoot) ?? path.join(kitRoot, "node_modules", "tsx", "dist", "cli.mjs");
const launcher = path.join(kitRoot, "bin", "start-pipeline.mjs");

const HELP = `laoshi ${version}（${kitRoot}）

在项目目录（或它的工作区）中运行：
  laoshi list                  列出这个项目的所有需求和阶段
  laoshi status [需求]         查看进度；只有一个需求运行过时可以不写
  laoshi stop <需求>           停止流水线（之后可以继续）
  laoshi resume <需求>         从上次中断处继续；需求改过时只处理变化的部分
  laoshi approve <需求>        需求方确认了方案（方案确认点，见 preview.md），继续开发
  laoshi verify <需求> [--verify-env local|deployed] [--defects fix|handback|report]
                               研发完成后开始测试验证（分阶段执行时）
  laoshi start <需求> [--profile quick|standard] [--phases gated] [--at 22:00]
                               启动流水线（通常由 /laoshi 在对话中启动，这里用于终端中手工启动）
  laoshi digest [--notify]     项目的需求总览；--notify 同时发到外部通知（如企业 IM）
  laoshi digest --schedule "0 9 * * 1"
                               让平台按时间表发送需求总览（例子为每周一 9:00）；取消：laoshi digest --cancel <ID>
  laoshi sync <需求>           把需求同步到对接的外部系统（补发失败的调用、补建卡片、更新状态）
  laoshi review <需求>         在浏览器打开原型审查页：点选要改的地方、直接改文字，提交意见或确认方案
  laoshi code-review <需求>    代码审查页：看这次的改动和 AI 评审意见，在代码行上写意见，退回修改或评审通过
  laoshi review-fix <需求>     按代码审查页上退回的意见开始修改（插件里提交"退回修改"时自动执行）
  laoshi try <需求> [--stop]   把做好的需求跑起来试用：给出访问地址和测试数据（--stop 停止）
  laoshi checklist <需求>      验收清单：按验收标准逐条勾选，提交后写成验收记录
  laoshi ui-check <网址> [--prototype <原型文件>] [--width 1280,390]
                               不靠看图检查网页：显示不全、遮挡、超出屏幕、文字太淡、报错，和原型对文字
  laoshi permission <需求> approve|deny [理由]
                               批准或拒绝步骤等待批准的操作，并接着运行（平台在对话里问人时用）
  laoshi reply <需求> <回复>   把回答或方案意见转给需求的对话（需求插件的"等你处理"用它）
  laoshi integration test [需求]  只显示对接外部系统时会执行的命令，不真正调用
  laoshi start --from <系统>:<卡号>  从需求管理系统中的一张卡片开始需求（没有人开着对话也可以）
  laoshi card check [<卡号>|--all]  读取需求方在卡片中的回复，转给需求的会话
  laoshi card publish <卡号>   把需求会话写的 card-ai.md 写进卡片的 AI 区
  laoshi card list             本机从卡片开始的需求
  laoshi card route            本机接收卡片的仓库和子系统（--add <仓库> 登记）
  laoshi factory start|stop|status  接单器：定时为标题带 [AI] 的新卡片开始需求、转达回复（once 检查一次）

使用情况（可以在任何目录运行）：
  laoshi stats [--since 30d] [--month 2026-10]
                               本机的使用统计：需求数、交付周期、返工、等待、各步骤用时、用量
  laoshi stats --report [--out 目录]
                               生成汇报用的汇总（.md）和每个需求一行的表格（.csv）
  laoshi stats --export [文件]    导出本机的运行记录；汇总多台机器：laoshi stats --merge <文件…> --report
  laoshi outcome               查找已合并进主干的需求和合并后发现的问题，记入使用记录（laoshi stats 也会自动查）
  laoshi outcome <需求> --merged | --issue "<问题>"
                               手动记一笔：已合并，或合并后发现的问题
  laoshi index [--rebuild [目录…]] [--prune]
                               本机记录的需求（需求插件据此找到所有需求）；索引里缺的需求用 --rebuild 补登
  laoshi api <命令> …          给程序用的 JSON 输出（见 contracts/cli-json.md）
  laoshi migrate [--apply | --rollback] [--from <目录>] [--to <目录>]
                               从 req-kit 1.x 迁移本机的配置、使用记录和需求状态（默认只预览）

本机维护：
  npx -y [--registry=<npm 源>] @yiyi_zhang/laoshi@latest install --platform <平台>
                               一步安装：从 npm 装好 laoshi，再完成下面的 laoshi install
  laoshi install --platform <平台> [--home <安装根>] [--target <skill 目录>] [--force]
                               安装或更新：安装级配置、按平台渲染的 skill、平台需要的插件；平台：paseo、dsh
  laoshi install --check    只检查会做什么，不改动
  laoshi install --uninstall   移除 laoshi 安装的 skill 和插件（保留安装根）
  laoshi upgrade [版本] [--registry <npm 源>]
                               升级到最新版本（或指定版本），并重新运行 laoshi install；回到旧版本：laoshi upgrade <旧版本>
  laoshi docs [--port <端口>] [--no-open]
                               在本机打开这个版本的文档站点（不需要外网）
  laoshi doctor [--no-project] 体检：安装、配置、平台、当前项目
  laoshi configure          配置向导：选择 builder 和 reviewer 用的 agent
  laoshi configure --auto   不提问，按推荐选好 builder、reviewer 和备用模型
  laoshi notify-test [--type blocked|failed|completed|milestone|permission]
                               给配置的外部通知（如企业 IM）发一条测试消息
  laoshi version            显示版本和安装位置

<需求> 可以写功能目录（docs/features/20261012-sms-login）、目录名，或名称中能唯一确定的一部分（sms-login）。
req 是 laoshi 的别名。在对话中的用法见 /laoshi；完整说明：laoshi docs（或 ${path.join(kitRoot, "docs", "guide")}）。`;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function node(args) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", windowsHide: true });
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

function needTsx() {
  if (fs.existsSync(tsxCli)) return true;
  console.error(`依赖未安装：在 ${kitRoot} 中执行 npm ci --omit=dev，然后运行 laoshi install`);
  return false;
}

/** Takes the first argument as the requirement, unless it is an option. */
function feature(rest, required) {
  if (rest[0] && !rest[0].startsWith("-")) return ["--feature", rest[0], ...rest.slice(1)];
  if (required) {
    console.error(`请写出是哪个需求，例如：laoshi ${command} sms-login（用 laoshi list 查看全部需求）`);
    process.exit(2);
  }
  return rest;
}

const [command = "help", ...rest] = process.argv.slice(2);
// `laoshi install` sets up this machine for this copy (bin/install.mjs). Run from npx's temporary
// copy (`npx -y @yiyi_zhang/laoshi@latest install`), it first installs laoshi from npm (bin/bootstrap.mjs).
const fromNpx = kitRoot.split(/[\\/]/).includes("_npx");
if (command === "install") process.exit(node([path.join(kitRoot, "bin", fromNpx ? "bootstrap.mjs" : "install.mjs"), ...rest]));

let code;
switch (command) {
  case "list":
  case "ls":
    code = node([launcher, "--list", ...rest]);
    break;
  case "status":
  case "st":
    code = node([launcher, "--status", ...feature(rest, false)]);
    break;
  case "stop":
    code = node([launcher, "--stop", ...feature(rest, true)]);
    break;
  case "resume":
    code = node([launcher, "--resume", ...feature(rest, true)]);
    break;
  case "verify":
    code = node([launcher, "--phase", "verify", ...feature(rest, true)]);
    break;
  case "approve":
    code = node([launcher, "--approve", ...feature(rest, true)]);
    break;
  case "review-fix":
    code = node([launcher, "--review-fix", ...feature(rest, true)]);
    break;
  case "code-review":
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "review.ts"), "--page", "code", ...rest]) : 1;
    break;
  case "start":
    // From a card in the requirement management system (1.10): no chat needed to begin.
    if (rest.some((a) => a === "--from" || a.startsWith("--from="))) code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "card-cmd.ts"), "start", ...rest]) : 1;
    else code = node([launcher, ...feature(rest, true)]);
    break;
  case "card":
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "card-cmd.ts"), ...rest]) : 1;
    break;
  case "factory":
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "factory.ts"), ...rest]) : 1;
    break;
  case "doctor":
    code = node([path.join(kitRoot, "bin", "req-doctor.mjs"), ...rest]);
    break;
  case "configure":
  case "config":
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "configure.ts"), ...rest]) : 1;
    break;
  case "upgrade":
    // The newest (or the given) version from npm, then its `laoshi install`: bin/bootstrap.mjs.
    code = node([path.join(kitRoot, "bin", "bootstrap.mjs"), "--spec", `${packageName}@${rest[0] && !rest[0].startsWith("-") ? rest.shift() : "latest"}`, ...rest]);
    break;
  case "check":
    code = node([path.join(kitRoot, "bin", "install.mjs"), "--check", ...rest]);
    break;
  case "digest":
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "digest.ts"), ...rest]) : 1;
    break;
  case "stats":
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "stats.ts"), ...rest]) : 1;
    break;
  case "index":
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "index-cmd.ts"), ...rest]) : 1;
    break;
  case "api":
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "api.ts"), ...rest]) : 1;
    break;
  case "reply":
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "reply.ts"), ...rest]) : 1;
    break;
  case "permission":
    // Answers a step's pending approval, then continues the run (the step picks up the answer).
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "permission-cmd.ts"), ...rest]) : 1;
    if (code === 0) code = node([launcher, "--resume", ...feature(rest.slice(0, 1), true)]);
    else if (code === 3) code = 0;
    break;
  case "sync":
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "integration-cmd.ts"), "sync", ...rest]) : 1;
    break;
  case "integration":
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "integration-cmd.ts"), ...rest]) : 1;
    break;
  case "review":
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "review.ts"), ...rest]) : 1;
    break;
  case "try":
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "try.ts"), ...rest]) : 1;
    break;
  case "checklist":
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "checklist-cmd.ts"), ...rest]) : 1;
    break;
  case "outcome":
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "outcomes.ts"), ...rest]) : 1;
    break;
  case "ui-check":
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "ui-check.ts"), ...rest]) : 1;
    break;
  case "docs":
    code = node([path.join(kitRoot, "bin", "req-docs.mjs"), ...rest]);
    break;
  case "migrate":
    // From req-kit 1.x (~/.req-kit) to laoshi: preview by default, --apply, --rollback.
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "adapters", "paseo", "migrate.ts"), ...rest]) : 1;
    break;
  case "plugin":
    console.error("Paseo 的需求插件由 paseo-req-kit 提供：req plugin install（paseo-req-kit 的命令）。");
    code = 2;
    break;
  case "notify-test":
    code = needTsx() ? node([tsxCli, path.join(kitRoot, "engine", "src", "notify-test.ts"), ...rest]) : 1;
    break;
  case "version":
  case "--version":
  case "-v":
    console.log(`laoshi ${version}（${kitRoot}）`);
    code = 0;
    break;
  case "help":
  case "--help":
  case "-h":
    console.log(HELP);
    code = 0;
    break;
  default:
    console.error(`没有 "${command}" 这个命令。\n`);
    console.error(HELP);
    code = 2;
}
process.exit(code);
