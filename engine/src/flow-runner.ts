// Interprets a custom flow (flows.ts). Every step goes through the same machinery as the builtin
// flow (FlowOps, provided by pipeline.ts): prompts, result validation, the quality gate, review
// panels, checkpoints, and — in mode B — handing the step to the chat instead of an agent. The
// interpreter itself keeps no state: everything it decides follows from the flow, the
// configuration and the step results in the state file, so a run can stop after any step and
// be continued (by the engine or by the chat) without changing what happens next.

import type { ProfileName, RequirementType } from "./config.js";
import { type FlowCondition, type FlowDef, roundsOf } from "./flows.js";
import type { StepId } from "./steps.js";

type Result = Record<string, unknown>;

export interface FlowOps {
  profile: ProfileName;
  type: RequirementType | null;
  rounds: { designReview: number; codeReview: number; defectFix: number };
  /** Results of completed steps, by key. */
  result(key: string): Result | undefined;
  log(message: string): void;
  /** Before the first step: records the code base and the quality gate's baseline. */
  begin(): Promise<void>;
  /** The design step, with parallel proposals when configured; stops when a defect cannot be reproduced. */
  design(): Promise<Result>;
  /** The implementation, slice by slice when the plan has slices; always gated. */
  implement(): Promise<Result>;
  /** Any other step. */
  run(id: StepId, round: number | null, maxRounds: number | null, options: { gate: boolean; contextLines?: string[] }): Promise<Result>;
  /** A review step: with the review panel / review axes when they apply. */
  review(id: StepId, round: number, maxRounds: number, contextLines: string[]): Promise<Result>;
  /** What a check step is told (quality gate, scope check…) before it runs. */
  checkLines(id: StepId): string[];
  /** The design review asked the requester: the builder answers what it can first. */
  answerFirst(review: Result, round: number, maxRounds: number): Promise<void>;
  /** Design confirmation point; throws (stops the run) when the requester has to confirm. */
  approval(mode: "always" | "config"): void;
  /** develop → verify. "report": develop-only, go straight to the report; throws at a gate. */
  phase(): Promise<"continue" | "report">;
  /** The report, told everything the run measured. */
  report(extraLines: string[]): Promise<Result>;
  /** Whether a step changes code (the quality gate runs after it). */
  gated(id: string): boolean;
}

function matches(value: unknown, condition: FlowCondition): boolean {
  if (condition.in) return condition.in.some((v) => v === value);
  return value === condition.equals;
}

/** Whether a node's condition holds now. */
export function conditionHolds(condition: FlowCondition | undefined, ops: Pick<FlowOps, "profile" | "type" | "result">): boolean {
  if (!condition) return true;
  if (condition.profile && !condition.profile.includes(ops.profile)) return false;
  if (condition.type && !condition.type.includes(ops.type ?? "feature")) return false;
  if (condition.result) {
    const [key, field] = condition.result.split(".");
    const result = ops.result(key);
    // A step that was skipped has no result: the condition does not hold.
    if (!result || !matches(result[field], condition)) return false;
  }
  return true;
}

function passes(result: Result, until: Record<string, Array<string | boolean | number>>): boolean {
  return Object.entries(until).every(([field, values]) => values.some((v) => v === result[field]));
}

/** Builtin steps whose own logic is more than "run it": design (proposals, reproduction) and implement (slices). */
async function runPlainStep(id: string, gate: boolean | undefined, ops: FlowOps): Promise<Result> {
  if (id === "design") return ops.design();
  if (id === "implement") return ops.implement();
  if (id === "report") return ops.report([]);
  return ops.run(id as StepId, null, null, { gate: gate ?? ops.gated(id), contextLines: ops.checkLines(id as StepId) });
}

/** Runs the flow to its report; returns the report's result. */
export async function runCustomFlow(def: FlowDef, ops: FlowOps): Promise<Result> {
  ops.log(`按自定义流程「${def.title}」（${def.name}，${def.source}）进行`);
  await ops.begin();
  let reportExtra: string[] = [];
  for (let i = 0; i < def.nodes.length; i++) {
    const node = def.nodes[i];
    if (!conditionHolds(node.when, ops)) {
      ops.log(`自定义流程第 ${i + 1} 项条件不满足，跳过`);
      continue;
    }
    if ("checkpoint" in node) {
      if (node.checkpoint === "approval") {
        ops.approval(node.mode ?? "config");
        continue;
      }
      if ((await ops.phase()) === "report") {
        // Develop-only: what follows the gate is testing; the report is written as a development report.
        reportExtra = ["只做研发：本次不做测试验证，完成报告按本步骤说明中“只做研发时”一节写成研发报告"];
        break;
      }
      continue;
    }
    if ("step" in node) {
      if (node.step === "report") break;
      await runPlainStep(node.step, node.gate, ops);
      continue;
    }
    const { check, fix, until, order } = node.loop;
    const max = roundsOf(node.loop.rounds, ops.rounds);
    for (let r = 1; r <= max; r++) {
      if (order === "fix-first") {
        await ops.run(fix as StepId, r, max, { gate: ops.gated(fix), contextLines: ops.checkLines(fix as StepId) });
        const recheck = await ops.run(check as StepId, r, max, { gate: ops.gated(check), contextLines: ops.checkLines(check as StepId) });
        if (passes(recheck, until)) break;
        continue;
      }
      const review = await ops.review(check as StepId, r, max, ops.checkLines(check as StepId));
      if (passes(review, until)) break;
      if (check === "design_review" && review.verdict === "blocked") {
        await ops.answerFirst(review, r, max);
        continue;
      }
      await ops.run(fix as StepId, r, max, { gate: ops.gated(fix), contextLines: ops.checkLines(fix as StepId) });
    }
  }
  return ops.report(reportExtra);
}
