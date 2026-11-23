// Generated from ui/shared/view-model.ts by scripts/sync-ui-shared.mjs — do not edit directly.
// Platform-agnostic UI view-model shared by Paseo (React Native), dsh (Web plugin),
// and local web views. Zero DOM, zero React Native, zero Node imports.

export type Attention = "approval" | "business" | "permission" | "interrupted" | "not_completed" | "not_started" | null;

export type Group = "attention" | "running" | "verify" | "done" | "other";

export type ActionKind = "approve" | "stop" | "resume" | "verify" | "sync" | "start" | "reply";

export type Tone = "needs" | "running" | "success" | "warning" | "danger" | "muted";

export type Urgency = "normal" | "elevated" | "urgent";

export interface RequirementWaiting {
  since: string;
  reason?: string | null;
  questions: string[];
  canReply?: boolean;
  card?: { system: string; id: string; requester?: string | null } | null;
}

export interface RequirementView {
  key: string;
  repo: string;
  sourceRepo?: string | null;
  project: string;
  featureDir: string;
  title: string;
  branch?: string | null;
  type: string | null;
  profile: string | null;
  stage: string;
  status: string | null;
  attention: Attention;
  running: boolean;
  updatedAt: string;
  startedBy?: string | null;
  owner?: string | null;
  hasPrototype?: boolean;
  current: Array<{ key: string; title?: string }>;
  waiting?: RequirementWaiting | null;
  external?: Array<{ pending: number; id: string | null }>;
  jointCount?: number;
}

export const ATTENTION_LABELS: Record<Exclude<Attention, null>, string> = {
  approval: "等待确认方案",
  business: "等待需求方决定",
  permission: "等待批准权限",
  interrupted: "已中断，可以继续",
  not_completed: "结束但未完成",
  not_started: "已确认，未开始开发",
};

export const TYPE_LABELS: Record<string, string> = {
  defect: "缺陷",
  refactor: "重构",
  assessment: "评估",
};

export const PROFILE_LABELS: Record<string, string> = {
  quick: "快速档",
  standard: "标准档",
};

export const GROUP_ORDER: Group[] = ["attention", "running", "verify", "done", "other"];

export const GROUP_LABELS: Record<Group, string> = {
  attention: "需要你处理",
  running: "进行中",
  verify: "研发完成，待测试验证",
  done: "最近完成",
  other: "其他",
};

export const GROUP_EYEBROWS: Record<Group, string> = {
  attention: "需要你处理",
  running: "进行中",
  verify: "待测试验证",
  done: "最近完成",
  other: "其他",
};

export const ACTION_TEXT: Record<ActionKind, { label: string; confirm: string }> = {
  approve: { label: "确认方案", confirm: "确认 preview.md 中的方案，开始写代码？请先看过确认预览和原型。" },
  stop: { label: "停止", confirm: "停止这个需求的流水线？正在运行的步骤会被中断，之后可以继续。" },
  start: { label: "开始开发", confirm: "按已确认的需求说明开始开发？在项目主目录中的需求会新建自己的工作区。" },
  resume: { label: "继续", confirm: "从中断处继续？需求说明改过的话，只处理变化的部分。" },
  verify: { label: "开始测试验证", confirm: "开始测试验证？选择在哪里验证。" },
  sync: { label: "同步到外部系统", confirm: "把这个需求同步到对接的外部系统：补发没有成功的调用、补建卡片、更新状态。" },
  reply: { label: "发送回复", confirm: "把回复转给这个需求的对话，由它更新需求说明并继续开发。" },
};

const RECENT_MS = 14 * 24 * 3600_000;
const ELEVATED_WAIT_MS = 4 * 3600_000;
const URGENT_WAIT_MS = 24 * 3600_000;

export function groupOf(r: Pick<RequirementView, "attention" | "running" | "status" | "updatedAt">, now = Date.now()): Group {
  if (r.attention) return "attention";
  if (r.running) return "running";
  if (r.status === "phase_done") return "verify";
  if (r.status === "completed" && now - Date.parse(r.updatedAt) < RECENT_MS) return "done";
  return "other";
}

export function minutes(m: number): string {
  if (m < 1) return "不到 1 分钟";
  if (m < 60) return `${Math.round(m)} 分钟`;
  const h = Math.floor(m / 60);
  const rest = Math.round(m % 60);
  return rest === 0 ? `${h} 小时` : `${h} 小时 ${rest} 分`;
}

export function ago(iso: string, now = Date.now()): string {
  const m = (now - Date.parse(iso)) / 60_000;
  if (!Number.isFinite(m)) return "";
  if (m < 1) return "刚刚";
  if (m < 60) return `${Math.round(m)} 分钟前`;
  if (m < 24 * 60) return `${Math.round(m / 60)} 小时前`;
  return `${Math.round(m / 60 / 24)} 天前`;
}

export function waited(since: string, now = Date.now()): string {
  const m = (now - Date.parse(since)) / 60_000;
  if (!Number.isFinite(m) || m < 1) return "刚刚";
  if (m < 60) return `等了 ${Math.round(m)} 分钟`;
  if (m < 48 * 60) return `等了 ${Math.round(m / 60)} 小时`;
  return `等了 ${Math.round(m / 60 / 24)} 天`;
}

export function urgencyOf(since: string, now = Date.now()): Urgency {
  const ms = now - Date.parse(since);
  if (!Number.isFinite(ms) || ms < ELEVATED_WAIT_MS) return "normal";
  if (ms >= URGENT_WAIT_MS) return "urgent";
  return "elevated";
}

export function tokens(n: number | null): string {
  if (n === null) return "未报告";
  return n >= 10_000 ? `${Math.round(n / 1_000) / 10} 万` : String(n);
}

export function facts(r: Pick<RequirementView, "project" | "type" | "profile" | "jointCount">): string {
  return [
    r.project,
    r.type ? (TYPE_LABELS[r.type] ?? r.type) : null,
    r.profile ? (PROFILE_LABELS[r.profile] ?? r.profile) : null,
    r.jointCount && r.jointCount > 0 ? `多仓 +${r.jointCount}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function actionsFor(
  r: Pick<RequirementView, "attention" | "running" | "status" | "external">,
): Array<Exclude<ActionKind, "reply">> {
  const base: Array<Exclude<ActionKind, "reply">> = r.running
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
  if (!r.running && r.status && (r.external ?? []).some((e) => e.pending > 0 || !e.id)) base.push("sync");
  return base;
}

export const TRACK = [
  { label: "对齐", who: "你" },
  { label: "方案", who: "AI · 你确认" },
  { label: "实现", who: "AI" },
  { label: "评审", who: "AI · 开发同事" },
  { label: "验证", who: "AI" },
  { label: "验收", who: "需求方" },
] as const;

const STEP_STOP: Array<[RegExp, number]> = [
  [/^(design|design_review|design_revise|design_proposal|assessment|diagnosis|reproduce)/, 1],
  [/^(implement|acceptance_tests)/, 2],
  [/^(code_review|review_fix)/, 3],
  [/^(verify|defect_fix|reverify|service|handoff|report)/, 4],
];

export interface TrackStop {
  label: string;
  who: string;
  state: "done" | "now" | "needs" | "todo";
}

export function trackOf(
  r: Pick<RequirementView, "stage" | "status" | "attention" | "running" | "current">,
  humanReview?: { status: string; stale: boolean } | null,
): TrackStop[] {
  let at = 0;
  let needs = false;
  const running = r.current[0]?.key;
  if (r.stage.startsWith("对齐")) at = 0;
  else if (r.attention === "approval" || r.attention === "business" || r.attention === "not_started") [at, needs] = [1, true];
  else if (running) at = STEP_STOP.find(([re]) => re.test(running))?.[1] ?? 2;
  else if (r.status === "phase_done") [at, needs] = [4, true];
  else if (r.status === "completed" || /待验收|已验收|验收/.test(r.stage)) {
    const reviewed = humanReview && humanReview.status === "approved" && !humanReview.stale;
    if (/已验收|验收通过/.test(r.stage)) at = TRACK.length;
    else if (humanReview !== undefined && !reviewed) [at, needs] = [3, true];
    else [at, needs] = [5, true];
  } else if (r.status) at = 2;
  return TRACK.map((t, i) => ({ ...t, state: i < at ? "done" : i === at ? (needs ? "needs" : "now") : "todo" }));
}

export function iconOf(r: Pick<RequirementView, "attention" | "running" | "status" | "stage">): { name: string; tone: Tone } {
  if (r.attention === "interrupted") return { name: "OctagonAlert", tone: "danger" };
  if (r.attention === "permission") return { name: "ShieldCheck", tone: "needs" };
  if (r.attention === "approval") return { name: "PenTool", tone: "needs" };
  if (r.attention === "business") return { name: "MessagesSquare", tone: "needs" };
  if (r.attention === "not_started") return { name: "Play", tone: "needs" };
  if (r.attention === "not_completed") return { name: "CircleDashed", tone: "warning" };
  if (r.running) return { name: "LoaderCircle", tone: "running" };
  if (r.stage.startsWith("对齐")) return { name: "MessagesSquare", tone: "muted" };
  if (r.status === "phase_done" || /待验收/.test(r.stage)) return { name: "ClipboardCheck", tone: "warning" };
  if (r.status === "completed") return { name: "CircleCheck", tone: "success" };
  return { name: "Circle", tone: "muted" };
}

export const INBOX_KIND: Record<
  Exclude<Attention, null>,
  { label: string; tone: "needs" | "danger" | "muted"; icon: string; todo: string; impact: string }
> = {
  approval: {
    icon: "PenTool",
    label: "确认方案",
    tone: "needs",
    todo: "方案已通过审核。看一下“做完后会看到什么”，没问题就确认开始写代码；要改就写下来。",
    impact: "确认前不会开始写代码，此时调整成本最低。",
  },
  business: {
    icon: "MessagesSquare",
    label: "回答问题",
    tone: "needs",
    todo: "方案审核有业务问题需要你拍板，回答后开发会接着进行。",
    impact: "流水线暂停在方案阶段，回答前不会继续。",
  },
  permission: {
    icon: "ShieldCheck",
    label: "批准权限",
    tone: "needs",
    todo: "当前步骤在等你允许它执行一项操作，批准或拒绝后会立即继续。",
    impact: "批准前步骤会一直停留在这里。",
  },
  interrupted: {
    icon: "OctagonAlert",
    label: "已中断",
    tone: "danger",
    todo: "开发中断了，自动处理没能解决。查看原因后可直接继续，已完成步骤不会重做。",
    impact: "流水线已停止，需要人工确认后恢复。",
  },
  not_completed: {
    icon: "CircleDashed",
    label: "没有完成",
    tone: "muted",
    todo: "流水线已结束但存在未完成项，完成报告里记录了原因和建议。",
    impact: "请查看完成报告决定补充开发或收尾。",
  },
  not_started: {
    icon: "Play",
    label: "还没开始开发",
    tone: "needs",
    todo: "需求说明已经确认，但开发尚未启动。确认无误即可点“开始开发”。",
    impact: "尚未进入方案与编码阶段。",
  },
};

export interface InboxCardModel {
  item: RequirementView;
  kind: (typeof INBOX_KIND)[Exclude<Attention, null>];
  since: string;
  waitedText: string;
  urgency: Urgency;
  primaryAction: Exclude<ActionKind, "reply"> | null;
}

/** Longest-waiting decisions first, enriched with urgency level and clear impact/CTA metadata. */
export function buildInboxCards(items: RequirementView[], now = Date.now()): InboxCardModel[] {
  return items
    .filter((r) => r.attention !== null)
    .sort((a, b) => (a.waiting?.since ?? a.updatedAt).localeCompare(b.waiting?.since ?? b.updatedAt))
    .map((item) => {
      const since = item.waiting?.since ?? item.updatedAt;
      const actions = actionsFor(item);
      return {
        item,
        kind: INBOX_KIND[item.attention!],
        since,
        waitedText: waited(since, now),
        urgency: urgencyOf(since, now),
        primaryAction: actions[0] ?? null,
      };
    });
}

export interface BoardFilter {
  project?: string | null;
  group?: Group | "all";
  query?: string;
}

export function filterRequirements(items: RequirementView[], filter: BoardFilter, now = Date.now()): RequirementView[] {
  const q = filter.query?.trim().toLowerCase() ?? "";
  return items.filter((item) => {
    if (filter.project && item.project !== filter.project) return false;
    if (filter.group && filter.group !== "all" && groupOf(item, now) !== filter.group) return false;
    if (!q) return true;
    const haystack = [
      item.title,
      item.project,
      item.featureDir,
      item.branch ?? "",
      item.stage,
      item.startedBy ?? "",
      item.owner ?? "",
      item.waiting?.card?.id ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export interface BoardSummary {
  total: number;
  attention: number;
  running: number;
  verify: number;
  done: number;
  urgentCount: number;
  longestWaitText: string | null;
}

/** Top-bar KPI summary across requirements (Linear / Vercel Dashboard style). */
export function summarizeBoard(items: RequirementView[], now = Date.now()): BoardSummary {
  let attention = 0;
  let running = 0;
  let verify = 0;
  let done = 0;
  let urgentCount = 0;
  let oldestWaitSince: string | null = null;

  for (const item of items) {
    const g = groupOf(item, now);
    if (g === "attention") {
      attention++;
      const since = item.waiting?.since ?? item.updatedAt;
      if (!oldestWaitSince || since < oldestWaitSince) oldestWaitSince = since;
      if (urgencyOf(since, now) === "urgent") urgentCount++;
    } else if (g === "running") running++;
    else if (g === "verify") verify++;
    else if (g === "done") done++;
  }

  return {
    total: items.length,
    attention,
    running,
    verify,
    done,
    urgentCount,
    longestWaitText: oldestWaitSince ? waited(oldestWaitSince, now) : null,
  };
}

export interface ChecklistItemView {
  id: string;
  kind: "criterion" | "decision";
  title: string;
  required: boolean;
  pipeline: "pass" | "fail" | "unverified" | "unknown";
  evidence: string | null;
}

export interface ChecklistSummary {
  total: number;
  requiredTotal: number;
  pipelinePass: number;
  pipelineNeedsEyes: number;
  checkedPass: number;
  checkedFail: number;
  remainingRequired: number;
}

/** Summarizes pipeline verification progress and human acceptance ticks for the workbench. */
export function summarizeChecklist(
  items: ChecklistItemView[],
  marks: Record<string, "pass" | "fail" | "skip"> = {},
): ChecklistSummary {
  let requiredTotal = 0;
  let pipelinePass = 0;
  let pipelineNeedsEyes = 0;
  let checkedPass = 0;
  let checkedFail = 0;
  let remainingRequired = 0;

  for (const item of items) {
    if (item.required) requiredTotal++;
    if (item.pipeline === "pass") pipelinePass++;
    else pipelineNeedsEyes++;
    const m = marks[item.id];
    if (m === "pass") checkedPass++;
    else if (m === "fail") checkedFail++;
    else if (item.required) remainingRequired++;
  }

  return {
    total: items.length,
    requiredTotal,
    pipelinePass,
    pipelineNeedsEyes,
    checkedPass,
    checkedFail,
    remainingRequired,
  };
}
