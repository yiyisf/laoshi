// The runtime contract (engine/test/conformance.ts) on the Paseo adapter, against a fake SDK client
// whose agents play the conformance prompts (engine/test/scripted-session.ts) and keep a timeline
// in the daemon's format.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG, type PipelineConfig } from "../../../engine/src/config.js";
import { runConformance } from "../../../engine/test/conformance.js";
import { ScriptedSession } from "../../../engine/test/scripted-session.js";
import { paseoAdapter } from "../adapter.js";
import { createRuntimeWithClient, type SdkClient } from "../paseo-runtime.js";

function fakeDaemon() {
  const agents = new Map<string, ScriptedSession>();
  const handle = (id: string) => {
    const session = agents.get(id) ?? null;
    return {
      id,
      refresh: async () => (session ? { agent: { id, cwd: session.cwd }, project: null } : null),
      archive: async () => ({ archivedAt: new Date().toISOString() }),
      async send(text: string, options?: { activeTurnBehavior?: "steer" | "interrupt" }) {
        if (!session) throw new Error(`no agent ${id}`);
        if (options?.activeTurnBehavior === "steer" && session.running) return;
        session.stop();
        void session.play(text);
      },
      async waitForFinish(timeoutMs: number) {
        if (!session) throw new Error(`no agent ${id}`);
        const ended = await session.settled(timeoutMs);
        const status = !ended ? "timeout" : session.error ? "error" : "idle";
        return { status, error: session.error, lastMessage: session.lastMessage(), final: { pendingPermissions: [], lastUsage: null } };
      },
      timeline: {
        async refetch() {
          return {
            entries: (session?.events ?? []).map((e) => ({
              timestamp: new Date(e.time).toISOString(),
              item:
                e.type === "message"
                  ? { type: "assistant_message", text: e.text }
                  : { type: "tool_call", callId: e.callId, status: e.type === "tool_start" ? "running" : "completed", detail: { type: "shell", command: session!.events.find((s) => s.callId === e.callId)?.command } },
            })),
          };
        },
      },
    };
  };
  const client = {
    agents: {
      ref: (id: string) => handle(id),
      async create(options: { cwd: string; prompt: string }) {
        const id = `agent-${agents.size + 1}`;
        const session = new ScriptedSession(options.cwd);
        agents.set(id, session);
        void session.play(options.prompt);
        return handle(id);
      },
    },
    close: async () => undefined,
  };
  return client as unknown as SdkClient;
}

const config: PipelineConfig = { ...DEFAULT_CONFIG, agents: { builder: { provider: "claude/test" }, reviewer: { provider: "codex/test" } } };

runConformance({
  name: "Paseo",
  capabilities: paseoAdapter.capabilities,
  async setup() {
    const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-paseo-conf-")));
    const client = fakeDaemon();
    return { runtime: createRuntimeWithClient(client, config, () => undefined), cwd, reopen: () => createRuntimeWithClient(client, config, () => undefined) };
  },
});
