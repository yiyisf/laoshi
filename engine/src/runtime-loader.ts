import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { dshAdapter } from "../../adapters/dsh/adapter.js";
import { paseoAdapter } from "../../adapters/paseo/adapter.js";
import { withBuiltins } from "./builtin/index.js";
import type { AgentProfile, PipelineConfig } from "./config.js";
import { describeProfileDefault, type PlatformAdapter, withCapabilities } from "./platform.js";
import type { AgentRuntime, RuntimeFactory } from "./runtime.js";
import { BUILTIN_SERVICE_WORDS, NEUTRAL_WORDS, type PlatformWords } from "./words.js";
import { defaultConfigPath } from "./locations.js";

// laoshi: each agent platform has an adapter under adapters/<id>/ (engine/src/platform.ts); the
// config's platform.adapter picks one. This is the one core file that names the adapters.
const ADAPTERS: Record<string, PlatformAdapter> = {
  paseo: paseoAdapter,
  dsh: dshAdapter,
};

export const ADAPTER_IDS = Object.keys(ADAPTERS);
export const DEFAULT_ADAPTER = "paseo";

/** The adapter id a config (or a raw config file's contents) names; the default when it names none. */
export function adapterIdOf(config: unknown): string {
  const platform = (config as { platform?: unknown } | null | undefined)?.platform;
  const id = platform && typeof platform === "object" ? (platform as { adapter?: unknown }).adapter : undefined;
  return typeof id === "string" && id ? id : DEFAULT_ADAPTER;
}

/** The adapter a config names; throws for an unknown one. */
export function adapterFor(config: unknown): PlatformAdapter {
  const id = adapterIdOf(config);
  const adapter = ADAPTERS[id];
  if (!adapter) throw new Error(`没有名为「${id}」的平台适配器（platform.adapter），可用：${ADAPTER_IDS.join("、")}`);
  return adapter;
}

/** The adapter a config file names, read leniently: the default when the file is missing or broken. */
export function adapterForFile(configPath: string): PlatformAdapter {
  let raw: unknown = null;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    // Missing or not JSON: the config checks report it.
  }
  return ADAPTERS[adapterIdOf(raw)] ?? ADAPTERS[DEFAULT_ADAPTER];
}

/** Every adapter's chat environment names, so processes started outside a chat can drop them all. */
export function originEnvNames(): string[] {
  return [...new Set(Object.values(ADAPTERS).flatMap((a) => [a.originEnv.id, ...(a.originEnv.cwd ? [a.originEnv.cwd] : [])]))];
}

/** The chat this process runs in, from whichever platform's environment is set. */
export function originFromEnv(env: NodeJS.ProcessEnv = process.env, prefer?: PlatformAdapter): { adapter: string; id: string; cwd: string | null } | null {
  const order = prefer ? [prefer, ...Object.values(ADAPTERS).filter((a) => a !== prefer)] : Object.values(ADAPTERS);
  for (const a of order) {
    const id = env[a.originEnv.id];
    if (id) return { adapter: a.id, id, cwd: (a.originEnv.cwd && env[a.originEnv.cwd]) || null };
  }
  return null;
}

/** A copy of the environment without any platform's chat variables. */
export function scrubOriginEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const name of originEnvNames()) delete out[name];
  return out;
}

/** Resolve the platform's agent profiles the config refers to (a no-op for platforms without them). */
export async function resolveProfiles(config: PipelineConfig, runtime: AgentRuntime): Promise<PipelineConfig> {
  const adapter = adapterFor(config);
  return adapter.resolveProfiles ? adapter.resolveProfiles(config, runtime) : config;
}

/**
 * The words for messages and prompts (engine/src/words.ts) of a configuration's platform: neutral
 * ones, laoshi's for the capabilities it provides itself, then the adapter's. Without a
 * configuration, the platform the install-level configuration names.
 */
export function wordsFor(config?: unknown): PlatformWords {
  const adapter = config === undefined ? adapterForFile(defaultConfigPath()) : (ADAPTERS[adapterIdOf(config)] ?? ADAPTERS[DEFAULT_ADAPTER]);
  return {
    ...NEUTRAL_WORDS,
    ...(adapter.capabilities.services === "builtin" ? BUILTIN_SERVICE_WORDS : {}),
    ...adapter.words,
  };
}

/** One line for an agent's settings, in the terms of the config's platform. */
export function describeProfile(config: unknown, profile: AgentProfile): string {
  const adapter = ADAPTERS[adapterIdOf(config)];
  return (adapter?.describeProfile ?? describeProfileDefault)(profile);
}

export async function loadRuntimeFactory(): Promise<RuntimeFactory> {
  // Test hook: run the real orchestration against a scripted fake daemon.
  const fake = process.env.REQ_PIPELINE_FAKE_RUNTIME;
  if (fake) {
    const module = (await import(pathToFileURL(path.resolve(fake)).href)) as { createRuntime: RuntimeFactory };
    return module.createRuntime;
  }
  return async (input) => {
    const adapter = adapterFor(input.config);
    return withCapabilities(withBuiltins(await adapter.createRuntime(input), adapter, { log: input.log }), adapter);
  };
}
