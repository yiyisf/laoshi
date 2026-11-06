// Custom flows (ADR 0009, docs/design/custom-flows.md): a project (or the install root) describes
// the order of the steps in a JSON file; the engine interprets it (flow-runner.ts) with the same
// step machinery as the builtin flow. Who runs each step — the engine (mode A) or the chat
// (mode B) — is independent of the flow: both modes run any flow.
//
// Where a flow named <name> is looked for, first match wins:
//   <repo>/.laoshi/flows/<name>.json        the project's, committed with the code
//   <install root>/flows/<name>.json        this machine's (or the team's install root)
//   engine/flows/<name>.json                shipped with laoshi (templates)
// "default" is the builtin flow in pipeline.ts and cannot be replaced.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PROFILE_NAMES, type ProfileName, REQUIREMENT_TYPES, type RequirementType } from "./config.js";
import { ENGINE_DIR, kitHome } from "./locations.js";
import type { AgentRole } from "./runtime.js";
import { type ResultSpec, STEPS, type StepDef, type StepId } from "./steps.js";

/** The builtin flow (pipeline.ts `flow`), used when nothing else is chosen. */
export const DEFAULT_FLOW = "default";
export const FLOW_SCHEMA = 1;
export const BUILTIN_FLOWS_DIR = path.join(ENGINE_DIR, "flows");
/** Relative to the repository. */
export const PROJECT_FLOWS_DIR = path.join(".laoshi", "flows");

/** Builtin steps a flow may use (panel members, proposals and the spec review are run by other steps). */
export const FLOW_STEPS: readonly StepId[] = [
  "design",
  "design_review",
  "design_revise",
  "implement",
  "code_review",
  "review_fix",
  "handoff",
  "service_start",
  "verify",
  "defect_fix",
  "reverify",
  "report",
];

/** Builtin steps that change code: the quality gate and the secret scan run after them. */
export const GATED_STEPS: readonly StepId[] = ["implement", "review_fix", "defect_fix"];

/** Rounds of a loop: a number, or the round limit of the run's profile. */
export type RoundsRef = number | "designReview" | "codeReview" | "defectFix";
const ROUND_NAMES = ["designReview", "codeReview", "defectFix"] as const;

type Scalar = string | boolean | number;

export interface FlowCondition {
  /** The run's profile is one of these. */
  profile?: ProfileName[];
  /** The requirement type is one of these; "feature" is an ordinary requirement (no type). */
  type?: Array<RequirementType | "feature">;
  /** "<step key>.<field>" of an earlier step's result, compared with `equals` or `in`. */
  result?: string;
  equals?: Scalar;
  in?: Scalar[];
}

export interface StepNode {
  step: string;
  when?: FlowCondition;
  /** Overrides whether the quality gate runs after the step (default: builtin code steps and custom steps with gate). */
  gate?: boolean;
}

export interface LoopNode {
  loop: {
    check: string;
    fix: string;
    rounds: RoundsRef;
    /** The loop ends when the check's result has one of these values for each field. */
    until: Record<string, Scalar[]>;
    /** check-first: check, fix, check… (reviews); fix-first: fix, check, fix… (defects after a verification). */
    order: "check-first" | "fix-first";
  };
  when?: FlowCondition;
}

export interface CheckpointNode {
  /** approval: the requester confirms the design (preview.md); phase: develop → verify (gated / develop-only). */
  checkpoint: "approval" | "phase";
  /** approval only: ask always, or as configured in designApproval (default). */
  mode?: "always" | "config";
  when?: FlowCondition;
}

export type FlowNode = StepNode | LoopNode | CheckpointNode;

/** A step the flow file defines itself: its own prompt and result fields. */
export interface CustomStepDef extends StepDef {
  /** Absolute path of the step's prompt. */
  promptPath: string;
  gate: boolean;
  timeoutMinutes: number;
}

export interface FlowDef {
  name: string;
  title: string;
  description: string | null;
  /** The file it was read from. */
  source: string;
  /** Hash of the file, so a resumed run can tell the flow changed. */
  hash: string;
  nodes: FlowNode[];
  customSteps: Record<string, CustomStepDef>;
}

export class FlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowError";
  }
}

/** What a check step's result must say for a loop to end, when the flow does not say. */
const DEFAULT_UNTIL: Partial<Record<StepId, Record<string, Scalar[]>>> = {
  design_review: { verdict: ["approved"] },
  code_review: { verdict: ["pass"] },
  verify: { result: ["pass"] },
  reverify: { result: ["pass"] },
};

const NAME = /^[a-z][a-z0-9_-]{0,39}$/;
const STEP_NAME = /^[a-z][a-z0-9_]{0,39}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The directories searched for flows, most specific first. */
export function flowDirs(repo: string | null, env: NodeJS.ProcessEnv = process.env): Array<{ dir: string; label: string }> {
  return [
    ...(repo ? [{ dir: path.join(repo, PROJECT_FLOWS_DIR), label: "项目" }] : []),
    { dir: path.join(kitHome(env), "flows"), label: "安装根" },
    { dir: BUILTIN_FLOWS_DIR, label: "随 laoshi 发布" },
  ];
}

/** Every flow that can be chosen, by name (the first directory that has it wins). */
export function listFlows(repo: string | null, env: NodeJS.ProcessEnv = process.env): Array<{ name: string; file: string; label: string }> {
  const found = new Map<string, { name: string; file: string; label: string }>();
  for (const { dir, label } of flowDirs(repo, env)) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir).sort()) {
      if (!entry.endsWith(".json")) continue;
      const name = entry.slice(0, -5);
      if (name === DEFAULT_FLOW || found.has(name)) continue;
      found.set(name, { name, file: path.join(dir, entry), label });
    }
  }
  return [...found.values()];
}

/** The flow file for a name, or null when there is none. */
export function findFlow(name: string, repo: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const { dir } of flowDirs(repo, env)) {
    const file = path.join(dir, `${name}.json`);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/**
 * The flow to run: null for the builtin flow. Throws FlowError with a readable reason when the
 * name is unknown or the file is not a valid flow.
 */
export function loadFlow(name: string | null | undefined, repo: string | null, env: NodeJS.ProcessEnv = process.env): FlowDef | null {
  if (!name || name === DEFAULT_FLOW) return null;
  if (!NAME.test(name)) throw new FlowError(`流程名\"${name}\"只能用小写字母、数字、- 和 _，以字母开头`);
  const file = findFlow(name, repo, env);
  if (!file) {
    const known = listFlows(repo, env).map((f) => f.name);
    throw new FlowError(`找不到流程\"${name}\"（查找了 ${flowDirs(repo, env).map((d) => d.dir).join("、")}）。可用的流程：${[DEFAULT_FLOW, ...known].join("、")}`);
  }
  return readFlowFile(file, name);
}

export function readFlowFile(file: string, name = path.basename(file, ".json")): FlowDef {
  const text = fs.readFileSync(file, "utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new FlowError(`${file} 不是合法的 JSON：${(error as Error).message}`);
  }
  try {
    return parseFlow(raw, { name, source: file, hash: crypto.createHash("sha256").update(text).digest("hex").slice(0, 16) });
  } catch (error) {
    if (error instanceof FlowError) throw new FlowError(`流程 ${name}（${file}）：${error.message}`);
    throw error;
  }
}

type FieldJson = "boolean" | "string" | "string[]" | Scalar[];

function fieldSpec(where: string, value: unknown): ResultSpec["required"][string] {
  if (value === "boolean" || value === "string" || value === "string[]") return { kind: value };
  if (Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && v.trim() !== "")) {
    return { kind: "enum", values: value as string[] };
  }
  throw new FlowError(`${where} 只能是 "boolean"、"string"、"string[]" 或可选值的数组（如 ["pass", "changes_required"]）`);
}

function resultSpec(where: string, required: unknown, optional: unknown): ResultSpec {
  if (!isRecord(required) || Object.keys(required).length === 0) throw new FlowError(`${where}.result 必须是至少有一个字段的对象`);
  const spec: ResultSpec = { required: {} };
  for (const [field, value] of Object.entries(required)) spec.required[field] = fieldSpec(`${where}.result.${field}`, value as FieldJson);
  if (optional !== undefined) {
    if (!isRecord(optional)) throw new FlowError(`${where}.optional 必须是对象`);
    spec.optional = {};
    for (const [field, value] of Object.entries(optional)) spec.optional[field] = fieldSpec(`${where}.optional.${field}`, value as FieldJson);
  }
  return spec;
}

function parseCustomStep(id: string, raw: unknown, dir: string): CustomStepDef {
  const where = `steps.${id}`;
  if (!STEP_NAME.test(id)) throw new FlowError(`${where}：步骤 ID 只能用小写字母、数字和 _，以字母开头`);
  if ((STEPS as Record<string, unknown>)[id]) throw new FlowError(`${where}：与内置步骤同名，请换一个 ID`);
  if (!isRecord(raw)) throw new FlowError(`${where} 必须是对象`);
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) throw new FlowError(`${where}.title 必须是非空字符串`);
  if (raw.role !== "builder" && raw.role !== "reviewer") throw new FlowError(`${where}.role 只能是 "builder" 或 "reviewer"`);
  if (typeof raw.prompt !== "string" || !raw.prompt.trim()) throw new FlowError(`${where}.prompt 必须是提示词文件的路径（相对于流程文件）`);
  const candidates = [path.resolve(dir, raw.prompt), path.resolve(path.dirname(dir), raw.prompt)];
  const promptPath = candidates.find((p) => fs.existsSync(p)) ?? candidates[0];
  if (!fs.existsSync(promptPath)) throw new FlowError(`${where}.prompt：找不到 ${promptPath}`);
  const timeout = raw.timeoutMinutes ?? 30;
  if (typeof timeout !== "number" || timeout <= 0) throw new FlowError(`${where}.timeoutMinutes 必须是正数`);
  if (raw.gate !== undefined && typeof raw.gate !== "boolean") throw new FlowError(`${where}.gate 必须是 true 或 false`);
  return {
    id: id as StepId,
    number: typeof raw.number === "number" ? raw.number : 0,
    title,
    role: raw.role as AgentRole,
    promptFile: path.basename(promptPath),
    promptPath,
    result: resultSpec(where, raw.result, raw.optional),
    gate: raw.gate === true,
    timeoutMinutes: timeout,
  };
}

/** The result spec of a step the flow can use; null when there is no such step. */
function specOf(id: string, custom: Record<string, CustomStepDef>): ResultSpec | null {
  if (custom[id]) return custom[id].result;
  if (FLOW_STEPS.includes(id as StepId)) return STEPS[id as StepId].result;
  return null;
}

function allFields(spec: ResultSpec): Record<string, ResultSpec["required"][string]> {
  return { ...spec.required, ...(spec.optional ?? {}) };
}

function parseCondition(where: string, raw: unknown, seen: Set<string>, custom: Record<string, CustomStepDef>): FlowCondition {
  if (!isRecord(raw)) throw new FlowError(`${where}.when 必须是对象`);
  const known = ["profile", "type", "result", "equals", "in"];
  const extra = Object.keys(raw).filter((k) => !known.includes(k));
  if (extra.length > 0) throw new FlowError(`${where}.when 不认识的条件：${extra.join("、")}（可用 ${known.join("、")}）`);
  const out: FlowCondition = {};
  if (raw.profile !== undefined) {
    if (!Array.isArray(raw.profile) || !raw.profile.every((p) => PROFILE_NAMES.includes(p))) throw new FlowError(`${where}.when.profile 只能包含 ${PROFILE_NAMES.join("、")}`);
    out.profile = raw.profile as ProfileName[];
  }
  if (raw.type !== undefined) {
    const types = [...REQUIREMENT_TYPES, "feature"];
    if (!Array.isArray(raw.type) || !raw.type.every((t) => types.includes(t))) throw new FlowError(`${where}.when.type 只能包含 ${types.join("、")}`);
    out.type = raw.type as FlowCondition["type"];
  }
  if (raw.result !== undefined) {
    let resultRef: string;
    let eqVal = raw.equals;
    let inVal = raw.in;
    if (isRecord(raw.result) && typeof raw.result.step === "string" && typeof raw.result.field === "string") {
      resultRef = `${raw.result.step}.${raw.result.field}`;
      if (raw.result.equals !== undefined) eqVal = raw.result.equals;
      if (raw.result.in !== undefined) inVal = raw.result.in;
    } else if (typeof raw.result === "string" && /^[a-z][a-z0-9_-]*\.[a-z_][a-z0-9_]*$/.test(raw.result)) {
      resultRef = raw.result;
    } else {
      throw new FlowError(`${where}.when.result 写成 "<步骤>.<字段>"，例如 "design.has_runnable_service"`);
    }
    const [key, field] = resultRef.split(".");
    const id = key.replace(/-r\d+$/, "");
    if (!seen.has(id)) throw new FlowError(`${where}.when.result：步骤 ${id} 必须出现在这一项之前`);
    const spec = specOf(id, custom);
    if (spec && !(field in allFields(spec))) throw new FlowError(`${where}.when.result：步骤 ${id} 的结果没有字段 ${field}`);
    if ((eqVal === undefined) === (inVal === undefined)) throw new FlowError(`${where}.when.result 需要 equals 或 in 二者之一`);
    if (inVal !== undefined && (!Array.isArray(inVal) || inVal.length === 0)) throw new FlowError(`${where}.when.in 必须是非空数组`);
    out.result = resultRef;
    if (eqVal !== undefined) out.equals = eqVal as Scalar;
    if (inVal !== undefined) out.in = inVal as Scalar[];
  } else if (raw.equals !== undefined || raw.in !== undefined) {
    throw new FlowError(`${where}.when：equals、in 要和 result 一起用`);
  }
  return out;
}

function parseRounds(where: string, raw: unknown): RoundsRef {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 10) return raw;
  if (typeof raw === "string" && (ROUND_NAMES as readonly string[]).includes(raw)) return raw as RoundsRef;
  throw new FlowError(`${where}.rounds 只能是 1~10 的整数，或 ${ROUND_NAMES.join("、")}（按档位的轮数）`);
}

/** Validates a parsed flow file; FlowError says what is wrong and where. */
export function parseFlow(raw: unknown, meta: { name: string; source: string; hash: string }): FlowDef {
  if (!isRecord(raw)) throw new FlowError("内容必须是一个 JSON 对象");
  if (raw.schema !== FLOW_SCHEMA) throw new FlowError(`schema 必须是 ${FLOW_SCHEMA}`);
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : meta.name;
  const dir = path.dirname(meta.source);
  const customSteps: Record<string, CustomStepDef> = {};
  if (raw.steps !== undefined) {
    if (!isRecord(raw.steps)) throw new FlowError("steps 必须是对象：自定义步骤 ID → 定义");
    for (const [id, def] of Object.entries(raw.steps)) customSteps[id] = parseCustomStep(id, def, dir);
  }
  if (!Array.isArray(raw.flow) || raw.flow.length === 0) throw new FlowError("flow 必须是非空数组");

  const nodes: FlowNode[] = [];
  /** Step IDs met so far (for `when.result`) and the plain steps (their keys must be unique). */
  const seen = new Set<string>();
  const plain = new Set<string>();
  const checkpoints = new Set<string>();
  const known = (id: unknown): id is string => typeof id === "string" && specOf(id, customSteps) !== null;
  const unknownStep = (where: string, id: unknown) =>
    new FlowError(`${where}：没有步骤\"${String(id)}\"。可用的内置步骤：${FLOW_STEPS.join("、")}${Object.keys(customSteps).length ? `；自定义步骤：${Object.keys(customSteps).join("、")}` : ""}`);

  raw.flow.forEach((item, i) => {
    const where = `flow[${i}]`;
    if (!isRecord(item)) throw new FlowError(`${where} 必须是对象`);
    const kinds = ["step", "loop", "checkpoint"].filter((k) => k in item);
    if (kinds.length !== 1) throw new FlowError(`${where} 必须恰好有 step、loop、checkpoint 之一`);
    const when = item.when === undefined ? undefined : parseCondition(where, item.when, seen, customSteps);

    if ("step" in item) {
      if (!known(item.step)) throw unknownStep(where, item.step);
      if (plain.has(item.step) || seen.has(item.step)) throw new FlowError(`${where}：步骤 ${item.step} 已经出现过；同一步骤在流程中只能出现一次（多轮请用 loop）`);
      if (item.gate !== undefined && typeof item.gate !== "boolean") throw new FlowError(`${where}.gate 必须是 true 或 false`);
      plain.add(item.step);
      seen.add(item.step);
      nodes.push({ step: item.step, ...(when ? { when } : {}), ...(typeof item.gate === "boolean" ? { gate: item.gate } : {}) });
      return;
    }

    if ("loop" in item) {
      const loop = item.loop;
      if (!isRecord(loop)) throw new FlowError(`${where}.loop 必须是对象`);
      if (!known(loop.check)) throw unknownStep(`${where}.loop.check`, loop.check);
      if (!known(loop.fix)) throw unknownStep(`${where}.loop.fix`, loop.fix);
      if (loop.check === loop.fix) throw new FlowError(`${where}.loop：check 和 fix 不能是同一个步骤`);
      for (const id of [loop.check, loop.fix]) {
        if (plain.has(id)) throw new FlowError(`${where}.loop：步骤 ${id} 已经作为单独一步出现过，不能再用于循环`);
        if (seen.has(id)) throw new FlowError(`${where}.loop：步骤 ${id} 已经在另一个循环中用过`);
      }
      const order = loop.order ?? "check-first";
      if (order !== "check-first" && order !== "fix-first") throw new FlowError(`${where}.loop.order 只能是 "check-first" 或 "fix-first"`);
      const checkSpec = specOf(loop.check, customSteps)!;
      let until: Record<string, Scalar[]>;
      if (loop.until === undefined) {
        const inferred = DEFAULT_UNTIL[loop.check as StepId] ?? (allFields(checkSpec).verdict?.kind === "enum" && (allFields(checkSpec).verdict as { values: readonly string[] }).values.includes("pass") ? { verdict: ["pass"] } : null);
        if (!inferred) throw new FlowError(`${where}.loop.until：步骤 ${loop.check} 没有默认的通过条件，请写出，例如 {"verdict": ["pass"]}`);
        until = inferred;
      } else {
        if (!isRecord(loop.until) || Object.keys(loop.until).length === 0) throw new FlowError(`${where}.loop.until 必须是非空对象：字段 → 可接受的值数组`);
        until = {};
        for (const [field, values] of Object.entries(loop.until)) {
          const spec = allFields(checkSpec)[field];
          if (!spec) throw new FlowError(`${where}.loop.until：步骤 ${loop.check} 的结果没有字段 ${field}`);
          const list = Array.isArray(values) ? values : [values];
          if (list.length === 0) throw new FlowError(`${where}.loop.until.${field} 不能为空`);
          if (spec.kind === "enum") {
            const bad = list.filter((v) => !spec.values.includes(v as string));
            if (bad.length > 0) throw new FlowError(`${where}.loop.until.${field}：${bad.join("、")} 不是可选值（${spec.values.join("、")}）`);
          }
          until[field] = list as Scalar[];
        }
      }
      seen.add(loop.check);
      seen.add(loop.fix);
      nodes.push({ loop: { check: loop.check, fix: loop.fix, rounds: parseRounds(`${where}.loop`, loop.rounds ?? "codeReview"), until, order }, ...(when ? { when } : {}) });
      return;
    }

    const checkpoint = item.checkpoint;
    if (checkpoint !== "approval" && checkpoint !== "phase") throw new FlowError(`${where}.checkpoint 只能是 "approval"（方案确认点）或 "phase"（研发 → 测试验证）`);
    if (checkpoints.has(checkpoint)) throw new FlowError(`${where}：checkpoint ${checkpoint} 只能出现一次`);
    if (item.mode !== undefined && (checkpoint !== "approval" || (item.mode !== "always" && item.mode !== "config"))) {
      throw new FlowError(`${where}.mode 只用于 approval，取值 "always" 或 "config"`);
    }
    checkpoints.add(checkpoint);
    nodes.push({ checkpoint, ...(item.mode ? { mode: item.mode as "always" | "config" } : {}), ...(when ? { when } : {}) });
  });

  const last = nodes.at(-1);
  if (!last || !("step" in last) || last.step !== "report" || last.when) {
    throw new FlowError('最后一项必须是无条件的 {"step": "report"}：完成报告给出结论，流水线据此通知和收尾');
  }
  return { name: meta.name, title, description: typeof raw.description === "string" ? raw.description : null, source: meta.source, hash: meta.hash, nodes, customSteps };
}

/** Rounds of a loop for the run's profile. */
export function roundsOf(ref: RoundsRef, profileRounds: Record<(typeof ROUND_NAMES)[number], number>): number {
  return typeof ref === "number" ? ref : profileRounds[ref];
}

/** One line per node, for `laoshi flow show` and the log. */
export function describeFlow(def: FlowDef): string[] {
  const title = (id: string) => def.customSteps[id]?.title ?? STEPS[id as StepId]?.title ?? id;
  const cond = (w?: FlowCondition) => {
    if (!w) return "";
    const parts: string[] = [];
    if (w.profile) parts.push(`档位 ${w.profile.join("/")}`);
    if (w.type) parts.push(`类型 ${w.type.join("/")}`);
    if (w.result) parts.push(`${w.result} ${w.in ? `∈ ${w.in.join("/")}` : `= ${String(w.equals)}`}`);
    return parts.length > 0 ? `（当 ${parts.join("，")}）` : "";
  };
  return def.nodes.map((n, i) => {
    const no = `${i + 1}.`;
    if ("step" in n) return `${no} ${title(n.step)}（${n.step}${def.customSteps[n.step] ? "，自定义" : ""}）${cond(n.when)}`;
    if ("loop" in n) {
      const l = n.loop;
      const until = Object.entries(l.until).map(([f, v]) => `${f}=${v.join("/")}`).join("，");
      const pair = l.order === "fix-first" ? `${title(l.fix)} → ${title(l.check)}` : `${title(l.check)} ⇄ ${title(l.fix)}`;
      return `${no} 循环：${pair}，最多 ${l.rounds} 轮，直到 ${until}${cond(n.when)}`;
    }
    return `${no} ${n.checkpoint === "approval" ? `方案确认点${n.mode === "always" ? "（总是）" : "（按 designApproval 配置）"}` : "阶段关口：研发 → 测试验证（按执行方式停下或继续）"}${cond(n.when)}`;
  });
}
