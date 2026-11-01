// run-e2e.mjs: open the chat the pipeline is launched from (a dsh session in the repository),
// through laoshi's dsh plugin, and print its session ID.
import { createRuntimeWithClient, pluginClient } from "../dsh-runtime.js";

const repo = process.argv[2];
const runtime = createRuntimeWithClient(pluginClient(), () => undefined);
const chat = await runtime.startSessionAgent!({ title: "laoshi 端到端检查", prompt: "这是 laoshi 端到端检查的对话。请只回复 收到", cwd: repo, profile: { provider: "dsh/chat-model" }, labels: {} });
const outcome = await runtime.attachAgent(chat).wait(60_000);
if (outcome.status !== "idle") throw new Error(`对话没有正常回应：${outcome.status} ${outcome.error ?? ""}`);
console.log(chat);
