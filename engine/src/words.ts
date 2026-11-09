// laoshi M2e: the platform's words in what people and step agents read (docs/design/platform-vocabulary.md).
// The core never names a platform: messages and prompts use these words, and each adapter gives
// its own (PlatformAdapter.words). runtime-loader.ts's wordsFor() picks them for a configuration.
//
// A word may be null when the platform has nothing of the kind: a prompt line that uses it is
// left out, and code leaves out the sentence (so such sentences stand on their own).

export interface PlatformWords {
  /** The platform for people, e.g. the product name people know it by. */
  name: string;
  /** A chat on the platform, where requirements are discussed and pipelines started, e.g. "<平台> 的对话". */
  chat: string;
  /** A scheduled wake-up, e.g. "<平台> 定时任务". */
  schedule: string;
  /** Where people see scheduled wake-ups, as a clause; null when there is no such place. */
  scheduleWhere: string | null;
  /** Services the pipeline starts for the steps, e.g. "<平台> 管理的服务". */
  managedServices: string;
  /** Who starts them, for "通过 X 启动", e.g. the product name people know it by. */
  servicesBy: string;
  /** The file in the repository that defines them, e.g. the platform's own file. */
  servicesFile: string;
  /** What a step agent does when its code change needs a managed service restarted (a prompt sentence). */
  servicesRestart: string;
  /** How people approve a step agent's waiting request; "{agent}" is the step agent's title. */
  approvePermission: string;
  /** Where people sign an agent in, e.g. "在 <平台> 中登录它". */
  signIn: string;
  /** Where people see a worktree workspace made for a requirement, as a clause; null when nowhere. */
  workspaceWhere: string | null;
  /** How people make an isolated worktree workspace themselves; null when not applicable. */
  newWorkspace: string | null;
  /** Where people open a requirement's pages (prototype review, checklist); null when there is no such place. */
  requirementPage: string | null;
  /** Browser tools step agents get, e.g. "<平台> 内置的浏览器（`browser_*` 工具）"; null when none. */
  browser: string | null;
  /** Who can watch the step's browser, a sentence; null when nobody can. */
  browserWatch: string | null;
  /** How the platform tells laoshi which chat it runs in, a clause, e.g. "<平台> 提供的 `X_ID`". Set by wordsFor from the adapter. */
  origin: string;
  /** What to check when the platform cannot be reached, a sentence. */
  connectFix: string;
  /** The view where people follow requirements, e.g. "<平台> 的 laoshi 插件"; null when none. */
  requirementView: string | null;
}

/** Words for a platform that says nothing about itself: plain, and true anywhere. */
export const NEUTRAL_WORDS: PlatformWords = {
  name: "平台",
  chat: "对话",
  schedule: "定时任务",
  scheduleWhere: null,
  managedServices: "流水线管理的服务",
  servicesBy: "流水线",
  servicesFile: "服务定义",
  servicesRestart: "按项目的验证方法另起一份带着新代码的服务来确认，用完关掉。流水线在下一个需要服务的步骤开始前，会重新启动这些服务。",
  approvePermission: "打开名为「{agent}」的 agent，查看并批准这个请求（或拒绝）",
  signIn: "检查它的登录状态",
  workspaceWhere: null,
  newWorkspace: null,
  requirementPage: null,
  browser: null,
  browserWatch: null,
  origin: "平台提供的环境变量",
  connectFix: "确认平台正在运行。",
  requirementView: null,
};

/** laoshi's own services (engine/src/builtin), for platforms whose services capability is "builtin". */
export const BUILTIN_SERVICE_WORDS: Pick<PlatformWords, "managedServices" | "servicesBy" | "servicesFile"> = {
  managedServices: "laoshi 管理的服务",
  servicesBy: "laoshi",
  servicesFile: ".laoshi/services.json",
};

/** "{agent}" and the like in a word. */
export function fill(word: string, values: Record<string, string>): string {
  return word.replace(/\{(\w+)\}/g, (m, key: string) => values[key] ?? m);
}

/**
 * Prompt text with {{platform.<word>}} replaced. A line whose word is null is left out, so a
 * platform without the thing does not get told about it.
 */
export function renderWords(text: string, words: PlatformWords): string {
  const pattern = /\{\{platform\.(\w+)\}\}/g;
  return text
    .split("\n")
    .filter((line) => ![...line.matchAll(pattern)].some((m) => (words as unknown as Record<string, unknown>)[m[1]] === null))
    .join("\n")
    .replace(pattern, (m, key: string) => {
      const value = (words as unknown as Record<string, unknown>)[key];
      return typeof value === "string" ? value : m;
    });
}
