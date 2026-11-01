// laoshi M2b: laoshi's own implementations of platform-independent capabilities (ADR 0008,
// decision 3). An adapter that declares a capability's source as "builtin" gets these in place
// of its runtime's methods; the runtime layer (runtime-loader.ts) applies them before degrading
// what is left (platform.ts, withCapabilities).

import type { CapabilityName, PlatformAdapter } from "../platform.js";
import type { AgentRuntime } from "../runtime.js";
import { builtinServices } from "./services.js";
import { builtinWorkspaces } from "./workspace.js";

/** Capabilities laoshi implements itself. The local scheduler is designed, not built yet (docs/design/builtin-capabilities.md). */
export const BUILTIN_CAPABILITIES: readonly CapabilityName[] = ["services", "worktree"];

export function withBuiltins(runtime: AgentRuntime, adapter: Pick<PlatformAdapter, "capabilities">, options: { log: (message: string) => void; env?: NodeJS.ProcessEnv }): AgentRuntime {
  const builtin = (name: CapabilityName) => adapter.capabilities[name] === "builtin" && BUILTIN_CAPABILITIES.includes(name);
  const r: AgentRuntime = { ...runtime };
  if (builtin("services")) {
    const s = builtinServices({ log: options.log, env: options.env, agentDirectory: runtime.agentDirectory?.bind(runtime) });
    r.listServices = s.listServices;
    r.startServices = s.startServices;
    r.stopServices = s.stopServices;
  }
  if (builtin("worktree")) {
    const w = builtinWorkspaces({ log: options.log, env: options.env });
    r.createWorktree = w.createWorktree;
    r.openWorkspace = w.openWorkspace;
    r.waitForWorkspaceSetup = w.waitForWorkspaceSetup;
  }
  return r;
}
