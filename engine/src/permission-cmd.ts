// `laoshi permission <需求> approve|deny [理由]`: answers a step agent's pending approval on platforms
// whose approvals are answered through laoshi (AgentRuntime.answerPermission), e.g. where the chat
// asks the person and the engine runs in the chat's command. `laoshi` then continues the run.
import { locate } from "./api.js";
import { DEFAULT_CONFIG, loadConfig, type PipelineConfig } from "./config.js";
import { defaultConfigPath } from "./locations.js";
import { loadRuntimeFactory, wordsFor } from "./runtime-loader.js";
import { engineAlive, readState, statePath } from "./state.js";

async function main(argv: string[]): Promise<number> {
  const [feature, answer, ...reasonWords] = argv;
  if (!feature || !["approve", "deny"].includes(answer ?? "")) {
    console.error("用法：laoshi permission <需求> approve|deny [理由]");
    return 2;
  }
  const { repo, featureDir } = locate(process.cwd(), feature);
  const state = readState(statePath(repo, featureDir));
  const waiting = state?.waitingPermission;
  if (!waiting) {
    console.error(`${featureDir} 现在没有步骤在等待批准。`);
    return 1;
  }
  let config: PipelineConfig;
  try {
    config = loadConfig(defaultConfigPath(), repo).config;
  } catch {
    config = DEFAULT_CONFIG;
  }
  const runtime = await (await loadRuntimeFactory())({ config, log: () => undefined });
  try {
    if (!runtime.answerPermission) {
      console.error(`在${wordsFor(config).name}上请按流水线的提示在它自己的界面里批准或拒绝。`);
      return 1;
    }
    const approve = answer === "approve";
    const reason = reasonWords.join(" ").trim() || (approve ? "需求方批准" : "需求方拒绝");
    await runtime.answerPermission(waiting.agentId, null, approve, reason);
    console.log(`已${approve ? "批准" : "拒绝"}「${waiting.stepTitle}」步骤等待的操作：${waiting.requests.join("；")}`);
    // A run still going picks the answer up by itself; exit code 3 tells `laoshi` not to start another.
    if (state.status === "running" && engineAlive(state)) {
      console.log("流水线还在运行，会自动接着做。");
      return 3;
    }
  } finally {
    await runtime.close().catch(() => undefined);
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: Error) => {
    console.error(`没有处理：${error.message}`);
    process.exit(1);
  },
);
