// The runtime contract (engine/test/conformance.ts) on the dsh adapter: the real laoshi dsh plugin
// against a fake dsh host whose sessions play the conformance prompts
// (engine/test/scripted-session.ts), and the engine's runtime talking to the plugin over its socket.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runConformance } from "../../../engine/test/conformance.js";
import { ScriptedSession } from "../../../engine/test/scripted-session.js";
import { dshAdapter } from "../adapter.js";
import { createRuntimeWithClient, pluginClient } from "../dsh-runtime.js";
import { channelPaths } from "../plugin/channel.mjs";
import { apply } from "../plugin/index.mjs";

type Listener = (...args: any[]) => any;
const text = (content: Array<{ text?: string }>) => content.map((p) => p.text ?? "").join("");

/** The dsh host services the plugin uses, with scripted sessions. */
function fakeHost(cwd: string) {
  const listeners = new Map<string, Listener[]>();
  const sessions = new Map<string, ScriptedSession>([["chat-1", new ScriptedSession(cwd)]]);
  let children = 0;
  const ctx = {
    on(event: string, fn: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
    },
    llm: { listProviders: () => [], listModels: async () => [] },
    agents: { get: (id: string) => (sessions.has(id) ? { id } : undefined), resume: async () => ({ agent: { id: "resumed" } }) },
    subagents: {
      async startActivation(spec: { request: { prompt: Array<{ text?: string }>; cwd: string } }) {
        const childId = `child-${++children}`;
        const session = new ScriptedSession(spec.request.cwd);
        sessions.set(childId, session);
        const result = session.play(text(spec.request.prompt)).then((end) => {
          if (end === "failed") throw new Error(session.error ?? "failed");
          return { stopReason: end === "ok" ? "completed" : "cancelled" };
        });
        result.catch(() => undefined);
        return { childId, result };
      },
      async prompt(req: { childSessionId: string; content: Array<{ text?: string }> }) {
        const session = sessions.get(req.childSessionId)!;
        await session.settled(60_000);
        void session.play(text(req.content));
      },
      interruptByParent(child: string) {
        sessions.get(child)?.stop();
      },
    },
    schedule: { create: async () => ({ id: "schedule-1" }), delete: async () => undefined },
    sessionController: {
      async list() {
        return {
          items: [...sessions.entries()].map(([sessionId, s]) => ({ sessionId, cwd: s.cwd, running: s.running, projections: { values: { tokenUsage: null, inbox: {} } } })),
        };
      },
      async page(req: { address: { childSessionId?: string; sessionId?: string } }) {
        const session = sessions.get(req.address.childSessionId ?? req.address.sessionId ?? "");
        const events = session?.events ?? [];
        return {
          records: events.map((e) => ({
            type: "event",
            event:
              e.type === "tool_start"
                ? { type: "tool/call", time: e.time, data: { callId: e.callId, name: "bash", arguments: JSON.stringify({ command: e.command }) } }
                : e.type === "tool_end"
                  ? { type: "tool/result", time: e.time, data: { message: { toolCallId: e.callId } } }
                  : { type: "assistant/message", time: e.time, data: { message: { content: [{ type: "text", text: e.text }] } } },
          })),
        };
      },
      prompt: async () => undefined,
      cancel: () => undefined,
      create: async () => ({ sessionId: "session-new" }),
    },
  };
  return { ctx, dispose: () => (listeners.get("dispose") ?? []).forEach((fn) => fn()) };
}

runConformance({
  name: "dsh",
  capabilities: dshAdapter.capabilities,
  async setup() {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-dsh-conf-")));
    const cwd = path.join(base, "repo");
    const home = path.join(base, "dsh");
    fs.mkdirSync(cwd);
    const host = fakeHost(cwd);
    apply(host.ctx, { home });
    for (let i = 0; i < 100 && !fs.existsSync(channelPaths(home).token); i++) await new Promise((r) => setTimeout(r, 20));
    const call = pluginClient({ ...process.env, DSH_HOME: home }, 10_000);
    const runtime = createRuntimeWithClient(call, () => undefined, 50);
    const close = runtime.close.bind(runtime);
    runtime.close = async () => {
      await close();
      host.dispose();
    };
    return { runtime, cwd, reopen: () => createRuntimeWithClient(call, () => undefined, 50), parentAgentId: "chat-1" };
  },
});
