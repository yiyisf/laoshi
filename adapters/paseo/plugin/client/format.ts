// Plain-language labels, shared by every screen (re-exporting ui/shared/view-model).
import type { Requirement } from "../shared/contracts";
export {
  ago,
  ATTENTION_LABELS,
  type Group,
  GROUP_EYEBROWS,
  GROUP_LABELS,
  groupOf,
  iconOf,
  minutes,
  PROFILE_LABELS,
  tokens,
  TRACK,
  trackOf,
  TYPE_LABELS,
} from "../shared/view-model";

export const FILE_LABELS: Record<string, string> = {
  "spec.md": "需求说明",
  "alignment.md": "访谈记录",
  "spec-review.md": "需求说明审阅",
  "changes.md": "需求变更",
  "decisions.tsv": "决策记录",
  "design.md": "方案",
  "design-review.md": "方案审核",
  "preview.md": "确认预览",
  "contract.md": "接口约定",
  "diagnosis.md": "复现与定位",
  "assessment.md": "评估",
  "implementation.md": "实现记录",
  "progress.md": "进展",
  "code-review.md": "代码评审",
  "handoff.md": "提测说明",
  "service-start.md": "服务启动",
  "verification.md": "功能验证",
  "report.md": "完成报告",
  "acceptance.md": "验收记录",
  "lessons.tsv": "可以变成规则的问题",
};

/** One line under a requirement's title: project, type, stage. */
export function facts(r: Requirement): string {
  return [r.project, r.type ? ({ defect: "缺陷", refactor: "重构", assessment: "评估" }[r.type] ?? r.type) : null, r.profile ? ({ quick: "快速档", standard: "标准档" }[r.profile] ?? r.profile) : null]
    .filter(Boolean)
    .join(" · ");
}

/** What a person can do from here, by the requirement's state. */
export function actionsFor(
  r: Pick<Requirement, "attention" | "running" | "status"> & { external?: Array<{ pending: number; id: string | null }> },
): Array<"approve" | "stop" | "resume" | "verify" | "sync" | "start"> {
  const base: Array<"approve" | "stop" | "resume" | "verify" | "sync" | "start"> = r.running
    ? ["stop"]
    : r.attention === "approval"
      ? ["approve"]
      : r.attention === "interrupted" || r.attention === "business"
        ? ["resume"]
        : r.attention === "not_started"
          ? ["start"]
          : r.status === "phase_done"
            ? ["verify"]
            : [];
  // A running pipeline sends what failed by itself at its next step change.
  if (!r.running && r.status && (r.external ?? []).some((e) => e.pending > 0 || !e.id)) base.push("sync");
  return base;
}

export const ACTION_TEXT = {
  approve: { label: "确认方案", confirm: "确认 preview.md 中的方案，开始写代码？请先看过确认预览和原型。" },
  stop: { label: "停止", confirm: "停止这个需求的流水线？正在运行的步骤会被中断，之后可以继续。" },
  start: { label: "开始开发", confirm: "按已确认的需求说明开始开发？在项目主目录中的需求会新建自己的工作区；进展发回谈需求的那个对话。" },
  resume: { label: "继续", confirm: "从中断处继续？需求说明改过的话，只处理变化的部分。" },
  verify: { label: "开始测试验证", confirm: "开始测试验证？选择在哪里验证。" },
  sync: { label: "同步到外部系统", confirm: "把这个需求同步到对接的外部系统：补发没有成功的调用、补建卡片、更新状态。" },
  reply: { label: "发送回复", confirm: "把回复转给这个需求的对话，由它更新需求说明并继续开发。" },
  try: { label: "一键试用", confirm: "启动这个需求的服务，生成访问地址和测试数据供试用？" },
  "try-stop": { label: "停止试用", confirm: "停止试用时启动的服务？" },
} as const;
