// Controlled flow extensions (M3): preserves the core pipeline skeleton and stages,
// while letting install-level or project-level config attach custom extra steps after
// fixed lifecycle hooks. Supports two task kinds:
//   - "ai": runs a step agent with a skill file and/or prompt text
//   - "script": runs a shell command (never PowerShell on Windows) and logs its output

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ProfileName, RequirementType } from "./config.js";

export const EXTENSION_HOOKS = [
  "design",
  "design_review",
  "implement",
  "code_review",
  "handoff",
  "verify",
  "report",
] as const;

export type ExtensionHook = (typeof EXTENSION_HOOKS)[number];

export type ExtensionRequirementType = RequirementType | "feature";

export interface ExtensionBase {
  /** Unique identifier (lowercase ASCII, digits, - or _), e.g. "test-cases" or "archive-build". */
  id: string;
  /** Human-readable title shown in logs and status. */
  title: string;
  /** Fixed core stage after which this extension runs. */
  after: ExtensionHook;
  /** Optional profile filter; runs on all profiles when omitted. */
  profiles?: ProfileName[];
  /** Optional requirement type filter ("feature" matches standard requirements); runs on all types when omitted. */
  types?: ExtensionRequirementType[];
  /** "fail" (default) stops the pipeline on failure; "warn" logs a warning and continues. */
  onFailure?: "warn" | "fail";
}

export interface AiExtensionStep extends ExtensionBase {
  kind: "ai";
  role?: "builder" | "reviewer";
  /** Path to a skill directory (containing SKILL.md) or markdown file, relative to repo or absolute. */
  skill?: string;
  /** Prompt instructions appended after the skill (at least one of skill or prompt is required). */
  prompt?: string;
  timeoutMinutes?: number;
}

export interface ScriptExtensionStep extends ExtensionBase {
  kind: "script";
  /** Shell command to execute. */
  command: string;
  /** Working directory relative to repo root (defaults to repo root). */
  cwd?: string;
  timeoutSeconds?: number;
}

export type ExtensionStep = AiExtensionStep | ScriptExtensionStep;

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,48}$/;
const PROFILES: readonly string[] = ["quick", "standard"];
const TYPES: readonly string[] = ["feature", "defect", "refactor", "assessment"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Resolves a skill path (file or directory containing SKILL.md). */
export function resolveSkillFile(skillPath: string, repoDir?: string): string {
  const base = path.isAbsolute(skillPath) ? skillPath : path.resolve(repoDir ?? process.cwd(), skillPath);
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    return path.join(base, "SKILL.md");
  }
  return base;
}

/** Validates raw `extensions` config array, returning normalized entries and any validation errors. */
export function validateExtensions(raw: unknown, repoDir?: string): { extensions: ExtensionStep[]; errors: string[] } {
  if (raw === undefined || raw === null) return { extensions: [], errors: [] };
  if (!Array.isArray(raw)) return { extensions: [], errors: ["extensions 必须是数组"] };

  const extensions: ExtensionStep[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  raw.forEach((item, i) => {
    const prefix = `extensions[${i}]`;
    if (!isRecord(item)) {
      errors.push(`${prefix} 必须是对象`);
      return;
    }
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!ID_RE.test(id)) errors.push(`${prefix}.id 必须是小写字母/数字开头，仅含 a-z、0-9、-、_`);
    else if (seen.has(id)) errors.push(`${prefix}.id 重复：${id}`);
    else seen.add(id);

    const title = typeof item.title === "string" ? item.title.trim() : "";
    if (!title) errors.push(`${prefix}.title 不能为空`);

    const after = typeof item.after === "string" ? item.after.trim() : "";
    if (!(EXTENSION_HOOKS as readonly string[]).includes(after)) {
      errors.push(`${prefix}.after 必须是 ${EXTENSION_HOOKS.join("、")} 之一`);
    }

    const kind = item.kind;
    if (kind !== "ai" && kind !== "script") {
      errors.push(`${prefix}.kind 必须是 "ai" 或 "script"`);
      return;
    }

    const onFailure = item.onFailure ?? "fail";
    if (onFailure !== "fail" && onFailure !== "warn") {
      errors.push(`${prefix}.onFailure 必须是 "fail" 或 "warn"`);
    }

    let profiles: ProfileName[] | undefined;
    if (item.profiles !== undefined) {
      if (!Array.isArray(item.profiles) || !item.profiles.every((p) => typeof p === "string" && PROFILES.includes(p))) {
        errors.push(`${prefix}.profiles 只能包含 ${PROFILES.join("、")}`);
      } else {
        profiles = item.profiles as ProfileName[];
      }
    }

    let types: ExtensionRequirementType[] | undefined;
    if (item.types !== undefined) {
      if (!Array.isArray(item.types) || !item.types.every((t) => typeof t === "string" && TYPES.includes(t))) {
        errors.push(`${prefix}.types 只能包含 ${TYPES.join("、")}`);
      } else {
        types = item.types as ExtensionRequirementType[];
      }
    }

    if (kind === "ai") {
      const role = item.role ?? "builder";
      if (role !== "builder" && role !== "reviewer") errors.push(`${prefix}.role 必须是 "builder" 或 "reviewer"`);
      const skill = typeof item.skill === "string" && item.skill.trim() ? item.skill.trim() : undefined;
      const prompt = typeof item.prompt === "string" && item.prompt.trim() ? item.prompt.trim() : undefined;
      if (!skill && !prompt) errors.push(`${prefix}（ai 类型）至少需要配置 skill 或 prompt`);
      if (skill && repoDir) {
        const resolved = resolveSkillFile(skill, repoDir);
        if (!fs.existsSync(resolved)) errors.push(`${prefix}.skill 指向的文件不存在：${resolved}`);
      }
      const timeoutMinutes = item.timeoutMinutes !== undefined ? Number(item.timeoutMinutes) : undefined;
      if (timeoutMinutes !== undefined && (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0)) {
        errors.push(`${prefix}.timeoutMinutes 必须是正数`);
      }
      extensions.push({
        id,
        title,
        after: after as ExtensionHook,
        kind: "ai",
        role: role === "reviewer" ? "reviewer" : "builder",
        ...(skill ? { skill } : {}),
        ...(prompt ? { prompt } : {}),
        ...(profiles ? { profiles } : {}),
        ...(types ? { types } : {}),
        ...(timeoutMinutes ? { timeoutMinutes } : {}),
        onFailure: onFailure === "warn" ? "warn" : "fail",
      });
    } else {
      const command = typeof item.command === "string" ? item.command.trim() : "";
      if (!command) errors.push(`${prefix}.command 不能为空`);
      const cwd = typeof item.cwd === "string" && item.cwd.trim() ? item.cwd.trim() : undefined;
      const timeoutSeconds = item.timeoutSeconds !== undefined ? Number(item.timeoutSeconds) : 180;
      if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
        errors.push(`${prefix}.timeoutSeconds 必须是正数`);
      }
      extensions.push({
        id,
        title,
        after: after as ExtensionHook,
        kind: "script",
        command,
        ...(cwd ? { cwd } : {}),
        ...(profiles ? { profiles } : {}),
        ...(types ? { types } : {}),
        timeoutSeconds,
        onFailure: onFailure === "warn" ? "warn" : "fail",
      });
    }
  });

  return { extensions, errors };
}

/** Merges install-level and project-level extensions by id (project overrides same id, appends new). */
export function mergeExtensions(base: ExtensionStep[], override: ExtensionStep[]): ExtensionStep[] {
  const byId = new Map<string, ExtensionStep>();
  for (const step of base) byId.set(step.id, step);
  for (const step of override) byId.set(step.id, step);
  return [...byId.values()];
}

/** Selects extensions applicable to a specific hook, profile, and requirement type. */
export function selectExtensions(
  extensions: ExtensionStep[],
  ctx: { after: ExtensionHook; profile: ProfileName; type?: ExtensionRequirementType | null },
): ExtensionStep[] {
  const effectiveType: ExtensionRequirementType = ctx.type ?? "feature";
  return extensions.filter((step) => {
    if (step.after !== ctx.after) return false;
    if (step.profiles && step.profiles.length > 0 && !step.profiles.includes(ctx.profile)) return false;
    if (step.types && step.types.length > 0 && !step.types.includes(effectiveType)) return false;
    return true;
  });
}

export interface ScriptExtensionResult {
  ok: boolean;
  exitCode: number | null;
  output: string;
  logFile: string;
}

/** Executes a script extension step and saves its output to `.pipeline/extensions/<id>.log`. */
export function runScriptExtension(
  step: ScriptExtensionStep,
  input: { repo: string; featureDir: string; env?: NodeJS.ProcessEnv },
): ScriptExtensionResult {
  const cwd = step.cwd ? path.resolve(input.repo, step.cwd) : input.repo;
  const env: NodeJS.ProcessEnv = {
    ...(input.env ?? process.env),
    LAOSHI_REPO: input.repo,
    LAOSHI_FEATURE_DIR: input.featureDir,
    LAOSHI_EXTENSION_ID: step.id,
    LAOSHI_HOOK: step.after,
  };
  const timeout = (step.timeoutSeconds ?? 180) * 1000;
  const r =
    process.platform === "win32"
      ? spawnSync(env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", step.command], { cwd, env, encoding: "utf8", timeout, windowsHide: true })
      : spawnSync("/bin/sh", ["-c", step.command], { cwd, env, encoding: "utf8", timeout });

  const output = [r.stdout ?? "", r.stderr ?? "", r.error ? `ERROR: ${r.error.message}` : ""].filter(Boolean).join("\n").trim();
  const logFile = path.join(input.repo, input.featureDir, ".pipeline", "extensions", `${step.id}.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(
    logFile,
    [`# ${step.title} (${step.id})`, `hook: ${step.after}`, `command: ${step.command}`, `cwd: ${cwd}`, `exitCode: ${r.status ?? "null"}`, "", output, ""].join("\n"),
    "utf8",
  );
  return { ok: r.status === 0 && !r.error, exitCode: r.status, output, logFile };
}

/** Builds the complete prompt for an AI/skill extension step. */
export function buildAiExtensionPrompt(step: AiExtensionStep, input: { repo: string; featureDir: string }): string {
  const parts: string[] = [
    `# 扩展步骤：${step.title}（${step.id}）`,
    "",
    "<pipeline-context>",
    `- 仓库目录：${input.repo}`,
    `- 功能目录：${input.featureDir}`,
    `- 触发阶段：${step.after} 之后`,
    "</pipeline-context>",
    "",
  ];
  if (step.skill) {
    const file = resolveSkillFile(step.skill, input.repo);
    if (fs.existsSync(file)) {
      parts.push("## 关联 Skill 说明", "", fs.readFileSync(file, "utf8").trim(), "");
    } else {
      parts.push(`（提示：未能读取 skill 文件 ${file}，请按下方任务说明执行。）`, "");
    }
  }
  if (step.prompt) {
    parts.push("## 任务说明", "", step.prompt.trim(), "");
  }
  parts.push("完成后请直接总结产出与结论；不要修改无关文件。");
  return parts.join("\n");
}
