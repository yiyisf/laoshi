// `laoshi flow`: inspect, validate and scaffold custom orchestration flows (ADR 0009,
// docs/design/custom-flows.md).

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  BUILTIN_FLOWS_DIR,
  DEFAULT_FLOW,
  describeFlow,
  FLOW_STEPS,
  listFlows,
  loadFlow,
  PROJECT_FLOWS_DIR,
  readFlowFile,
} from "./flows.js";
import { STEPS } from "./steps.js";

const USAGE = `用法：
  laoshi flow list [--repo <仓库目录>] [--json]
                  列出可用的编排流程（内置 default + 项目 .laoshi/flows/ + 安装根 flows/ + 随工具发布的模板）
  laoshi flow show <流程名> [--repo <仓库目录>] [--json]
                  查看一个流程的节点顺序、循环条件、关口和自定义步骤
  laoshi flow validate [<流程名或文件路径>] [--repo <仓库目录>]
                  校验流程定义是否合法（不写参数时校验项目 .laoshi/flows/ 下的全部流程）
  laoshi flow init <流程名> [--from standard|quick|hotfix|doc-only] [--repo <仓库目录>] [--force]
                  在项目的 .laoshi/flows/<流程名>.json 创建一份可修改的自定义流程`;

const DEFAULT_FLOW_SUMMARY = [
  "1. 方案设计（design）：视配置先跑并行方案提案，缺陷类需求先复现",
  "2. 循环：方案审核（design_review）⇄ 方案修订（design_revise），按档位轮数，直到 verdict=approved",
  "3. 方案确认点（按 designApproval 配置）",
  "4. 代码实现（implement）：支持按切片逐片实现与联合多仓库并行实现，跑质量门与密钥扫描",
  "5. 循环：代码评审（code_review）⇄ 评审问题修复（review_fix），按档位轮数，直到 verdict=pass",
  "6. 提测说明（handoff）",
  "7. 阶段关口：研发 → 测试验证（按 continuous / gated / develop-only 决定继续、停在关口或直接写研发报告）",
  "8. 服务启动验证（service_start，当有常驻服务且开启时）",
  "9. 功能验证（verify）",
  "10. 循环：缺陷修复（defect_fix）→ 复验（reverify），当验证发现缺陷时按档位轮数或退回研发（handback）",
  "11. 完成报告（report）",
];

export function executeFlowCommand(raw = process.argv.slice(2)): number {
  const sub = raw[0] ?? "list";
  if (sub === "help" || sub === "--help" || sub === "-h") {
    console.log(USAGE);
    return 0;
  }
  const rest = raw.slice(1);
  const target = rest[0] && !rest[0].startsWith("-") ? rest[0] : null;
  const optionArgs = target ? rest.slice(1) : rest;
  const { values } = parseArgs({
    args: optionArgs,
    options: {
      repo: { type: "string" },
      from: { type: "string" },
      force: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const repo = path.resolve(values.repo ?? process.cwd());

  if (sub === "list" || sub === "ls") {
    const entries = listFlows(repo);
    const items = [
      {
        name: DEFAULT_FLOW,
        title: "内置标准流程（引擎默认）",
        description: "完整支持需求类型剧本（缺陷、重构、评估）、联合开发、分阶段与退回研发",
        source: "builtin",
        label: "内置",
      },
      ...entries.map((e) => {
        try {
          const def = readFlowFile(e.file, e.name);
          return { name: e.name, title: def.title, description: def.description, source: e.file, label: e.label };
        } catch (error) {
          return { name: e.name, title: "（格式有误）", description: (error as Error).message, source: e.file, label: e.label };
        }
      }),
    ];
    if (values.json) {
      console.log(JSON.stringify({ schema: 1, flows: items }, null, 2));
      return 0;
    }
    console.log("可用的编排流程：");
    for (const item of items) {
      console.log(`- ${item.name}（${item.label}）：${item.title}`);
      if (item.description) console.log(`  ${item.description}`);
      if (item.source !== "builtin") console.log(`  文件：${item.source}`);
    }
    console.log(`\n可用的内置步骤 ID：${FLOW_STEPS.map((id) => `${id}（${STEPS[id].title}）`).join("、")}`);
    return 0;
  }

  if (sub === "show") {
    const name = target ?? DEFAULT_FLOW;
    if (name === DEFAULT_FLOW) {
      if (values.json) {
        console.log(JSON.stringify({ schema: 1, name: DEFAULT_FLOW, title: "内置标准流程", steps: DEFAULT_FLOW_SUMMARY }, null, 2));
        return 0;
      }
      console.log("流程：default（内置标准流程）\n");
      for (const line of DEFAULT_FLOW_SUMMARY) console.log(`  ${line}`);
      return 0;
    }
    const def = loadFlow(name, repo)!;
    const lines = describeFlow(def);
    if (values.json) {
      console.log(JSON.stringify({ schema: 1, ...def, summary: lines }, null, 2));
      return 0;
    }
    console.log(`流程：${def.name} —— ${def.title}`);
    console.log(`文件：${def.source}（sha256 前缀 ${def.hash}）`);
    if (def.description) console.log(`说明：${def.description}`);
    if (Object.keys(def.customSteps).length > 0) {
      console.log("\n自定义步骤：");
      for (const s of Object.values(def.customSteps)) {
        console.log(`  - ${s.id}：${s.title}（角色 ${s.role}，提示词 ${s.promptPath}${s.gate ? "，跑质量门" : ""}）`);
      }
    }
    console.log("\n步骤与节点顺序：");
    for (const line of lines) console.log(`  ${line}`);
    return 0;
  }

  if (sub === "validate" || sub === "check") {
    if (target) {
      const asFile = path.resolve(repo, target);
      const def = fs.existsSync(asFile) && asFile.endsWith(".json") ? readFlowFile(asFile) : loadFlow(target, repo);
      if (!def) {
        console.log("default 是内置流程，无需校验。");
        return 0;
      }
      console.log(`通过：流程「${def.title}」（${def.name}，共 ${def.nodes.length} 项，${Object.keys(def.customSteps).length} 个自定义步骤）`);
      return 0;
    }
    const dir = path.join(repo, PROJECT_FLOWS_DIR);
    if (!fs.existsSync(dir)) {
      console.log(`项目还没有自定义流程目录（${dir}）。可以用 laoshi flow init <名称> 创建。`);
      return 0;
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    if (files.length === 0) {
      console.log(`${dir} 下没有 .json 流程文件。`);
      return 0;
    }
    let failed = 0;
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        const def = readFlowFile(full);
        console.log(`通过：${def.name}（${def.title}，${def.nodes.length} 项）`);
      } catch (error) {
        failed += 1;
        console.error(`失败：${ (error as Error).message}`);
      }
    }
    return failed > 0 ? 1 : 0;
  }

  if (sub === "init") {
    if (!target) {
      console.error("请写出要创建的流程名，例如：laoshi flow init my-flow --from standard");
      return 2;
    }
    if (target === DEFAULT_FLOW) {
      console.error('"default" 是内置流程的保留名称，请换一个名称。');
      return 2;
    }
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(target)) {
      console.error(`流程名 "${target}" 只能用小写字母、数字、- 和 _，以字母开头。`);
      return 2;
    }
    const templateName = (values.from ?? "standard").trim().toLowerCase();
    const templateFile = path.join(BUILTIN_FLOWS_DIR, `${templateName}.json`);
    if (!fs.existsSync(templateFile)) {
      console.error(`找不到模板 "${templateName}"（可选：standard、quick、hotfix、doc-only）。`);
      return 2;
    }
    const destDir = path.join(repo, PROJECT_FLOWS_DIR);
    const destFile = path.join(destDir, `${target}.json`);
    if (fs.existsSync(destFile) && !values.force) {
      console.error(`文件已存在：${destFile}（如需覆盖请加 --force）`);
      return 2;
    }
    fs.mkdirSync(destDir, { recursive: true });
    const rawTemplate = JSON.parse(fs.readFileSync(templateFile, "utf8"));
    rawTemplate.title = `${target}（基于 ${templateName} 模板）`;
    fs.writeFileSync(destFile, `${JSON.stringify(rawTemplate, null, 2)}\n`);
    console.log(
      [
        `已创建自定义流程：${destFile}（基于 ${templateName} 模板）`,
        "用法：",
        `  1. 编辑 ${path.relative(repo, destFile)} 调整步骤顺序、循环或添加自定义步骤`,
        `  2. 校验：laoshi flow validate ${target}`,
        `  3. 设为项目默认：在 .laoshi.json 中写 { "orchestration": { "flow": "${target}" } }`,
        `     或在单个需求的 spec.md 顶部写 "- 流程：${target}"，或启动时传 --flow ${target}`,
      ].join("\n"),
    );
    return 0;
  }

  console.error(`未知的子命令 "${sub}"。\n\n${USAGE}`);
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}` || path.resolve(process.argv[1] ?? "") === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    process.exit(executeFlowCommand());
  } catch (error) {
    console.error(`错误：${(error as Error).message}`);
    process.exit(2);
  }
}
