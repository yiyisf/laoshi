// The runtime contract (engine/test/conformance.ts) on the 摸高 adapter, with the fake `aimax`.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runConformance } from "../../../engine/test/conformance.js";
import { mogaoAdapter } from "../adapter.js";
import { createMogaoRuntime, mogaoSettings } from "../mogao-runtime.js";

const FAKE = path.join(import.meta.dirname, "fake-aimax.mjs");

runConformance({
  name: "摸高",
  capabilities: mogaoAdapter.capabilities,
  // The fake is started through a shell script.
  skip: process.platform === "win32",
  async setup() {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "laoshi-mogao-conf-")));
    const cwd = path.join(base, "repo");
    const fake = path.join(base, "aimax");
    fs.mkdirSync(cwd);
    fs.mkdirSync(fake);
    const bin = path.join(base, "aimax.sh");
    fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`, { mode: 0o755 });
    const options = {
      settings: mogaoSettings({ platform: { mogao: { command: bin } } }, {}),
      agentsDir: path.join(base, "agents"),
      log: () => undefined,
      chatOut: null,
      env: { ...process.env, FAKE_AIMAX_DIR: fake },
      pollMs: 50,
    };
    return { runtime: createMogaoRuntime(options), cwd, reopen: () => createMogaoRuntime(options), parentAgentId: "chat-conformance" };
  },
});
