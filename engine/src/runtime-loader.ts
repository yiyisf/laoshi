import path from "node:path";
import { pathToFileURL } from "node:url";
import type { RuntimeFactory } from "./runtime.js";

// laoshi: each agent platform has an adapter under adapters/<id>/; the config's platform.adapter
// picks one when a runtime is created.
const ADAPTERS: Record<string, () => Promise<{ createRuntime: RuntimeFactory }>> = {
  paseo: () => import("../../adapters/paseo/paseo-runtime.js"),
  dsh: () => import("../../adapters/dsh/dsh-runtime.js"),
};

export const ADAPTER_IDS = Object.keys(ADAPTERS);

export async function loadRuntimeFactory(): Promise<RuntimeFactory> {
  // Test hook: run the real orchestration against a scripted fake daemon.
  const fake = process.env.REQ_PIPELINE_FAKE_RUNTIME;
  if (fake) {
    const module = (await import(pathToFileURL(path.resolve(fake)).href)) as { createRuntime: RuntimeFactory };
    return module.createRuntime;
  }
  return async (input) => {
    const id = input.config.platform.adapter;
    const load = ADAPTERS[id];
    if (!load) throw new Error(`没有名为「${id}」的平台适配器（platform.adapter），可用：${ADAPTER_IDS.join("、")}`);
    return (await load()).createRuntime(input);
  };
}
