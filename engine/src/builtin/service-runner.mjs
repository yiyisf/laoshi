// laoshi M2b: runs one builtin service (engine/src/builtin/services.ts) detached from the engine.
// It reads the service's output over pipes and appends it to the log itself: handing the log file
// to a detached service directly loses its output on Windows. When the service exits it records the
// exit code, then exits too. Plain JavaScript: started with `node` alone.
//
//   node service-runner.mjs <job.json>
//   job: { runId, command, cwd, env, logFile, recordFile }

import { spawn } from "node:child_process";
import fs from "node:fs";

const job = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const append = (chunk) => fs.appendFileSync(job.logFile, chunk);

function finish(exitCode) {
  try {
    const rec = JSON.parse(fs.readFileSync(job.recordFile, "utf8"));
    // A newer start of the same service owns the record now.
    if (rec.runId === job.runId) fs.writeFileSync(job.recordFile, JSON.stringify({ ...rec, pid: null, exitCode }));
  } catch {
    // The record is gone: nothing to update.
  }
  process.exit(0);
}

// The system's default shell: cmd.exe on Windows (never PowerShell), /bin/sh elsewhere.
const child = spawn(job.command, { cwd: job.cwd, env: { ...process.env, ...job.env }, shell: true, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
child.stdout.on("data", append);
child.stderr.on("data", append);
child.on("error", (error) => {
  append(`[laoshi] 无法启动：${error.message}\n`);
  finish(null);
});
child.on("exit", (code) => finish(code));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
