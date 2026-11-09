// The runtime contract (engine/test/conformance.ts) on the command-line adapter, once per command
// line, with the fake `claude` / `codex` (fake-agent.mjs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runConformance } from "../../../engine/test/conformance.js";
import { cliAdapter } from "../adapter.js";
import { createCliRuntime } from "../cli-runtime.js";

const FAKE = path.join(import.meta.dirname, "fake-agent.mjs");

for (const [label, provider] of [["Claude Code", "claude/default"], ["Codex", "codex/default"]] as const) {
  runConformance({
    name: `命令行 ${label}`,
    capabilities: cliAdapter.capabilities,
    async setup() {
      const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-cli-conf-")));
      const cwd = path.join(base, "repo");
      const fake = path.join(base, "fake");
      fs.mkdirSync(cwd);
      fs.mkdirSync(fake);
      let command = `"${process.execPath}" "${FAKE}"`;
      if (process.platform !== "win32") {
        command = path.join(base, "agent.sh");
        fs.writeFileSync(command, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
      }
      const options = {
        settings: { commands: { claude: command, codex: command }, runTimeoutMinutes: 5 },
        agents: { builder: { provider }, reviewer: { provider } },
        agentsDir: path.join(base, "agents"),
        messagesFile: path.join(base, "messages.log"),
        log: () => undefined,
        env: { ...process.env, FAKE_AGENT_DIR: fake },
        pollMs: 50,
      };
      return { runtime: createCliRuntime(options), cwd, reopen: () => createCliRuntime(options) };
    },
  });
}
