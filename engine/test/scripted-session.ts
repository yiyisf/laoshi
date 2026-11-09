// A pretend agent session for adapters' fake platforms in the conformance tests (conformance.ts):
// it plays the conformance prompt language (WRITE:<file>:<text>, SLEEP:<ms>, FAIL) in its working
// directory, one turn at a time, and keeps what happened as plain events each fake turns into its
// platform's format (a Paseo timeline, dsh session records, …).
import fs from "node:fs";
import path from "node:path";

export interface SessionEvent {
  time: number;
  type: "tool_start" | "tool_end" | "message";
  callId?: string;
  command?: string;
  text?: string;
}

export class ScriptedSession {
  running = false;
  /** The latest turn's error (FAIL), or null. */
  error: string | null = null;
  turns = 0;
  readonly events: SessionEvent[] = [];
  private generation = 0;
  private calls = 0;

  constructor(readonly cwd: string) {}

  /** Starts a turn (stopping any running one) and resolves when it ends: ok, failed, or stopped. */
  play(prompt: string): Promise<"ok" | "failed" | "stopped"> {
    const generation = ++this.generation;
    this.running = true;
    this.error = null;
    this.turns += 1;
    const live = () => generation === this.generation;
    return (async () => {
      const wait = Number(/SLEEP:(\d+)/.exec(prompt)?.[1] ?? 0);
      for (const until = Date.now() + wait; Date.now() < until; ) {
        if (!live()) return "stopped";
        await new Promise((r) => setTimeout(r, 20));
      }
      if (!live()) return "stopped";
      for (const [, file, text] of prompt.matchAll(/WRITE:([^:\s]+):(\S+)/g)) {
        const callId = `call-${++this.calls}`;
        const command = `echo ${text} > ${file}`;
        this.events.push({ time: Date.now(), type: "tool_start", callId, command });
        fs.writeFileSync(path.join(this.cwd, file), text);
        this.events.push({ time: Date.now(), type: "tool_end", callId });
      }
      if (/\bFAIL\b/.test(prompt)) {
        this.error = "boom";
        this.running = false;
        return "failed";
      }
      this.events.push({ time: Date.now(), type: "message", text: `done: turn ${this.turns}` });
      this.running = false;
      return "ok";
    })();
  }

  /** Stops the running turn (the next play starts fresh). */
  stop(): void {
    this.generation += 1;
    this.running = false;
  }

  /** Waits until the turn ends or timeoutMs passes; true when it ended. */
  async settled(timeoutMs: number): Promise<boolean> {
    const until = Date.now() + timeoutMs;
    while (this.running && Date.now() < until) await new Promise((r) => setTimeout(r, 20));
    return !this.running;
  }

  lastMessage(): string | null {
    return this.events.filter((e) => e.type === "message").at(-1)?.text ?? null;
  }
}
