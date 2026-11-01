// laoshi M2b: runs a new worktree's setup commands (.laoshi/services.json "setup") in the
// background, so the process that created the worktree need not wait. Plain JavaScript: started
// with `node` alone. Writes its progress to the status file the engine polls.
//
//   node setup-runner.mjs <job.json>
//   job: { cwd, commands: string[], env: Record<string,string>, statusFile, logFile }

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const job = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const status = (s) => fs.writeFileSync(job.statusFile, JSON.stringify({ ...s, at: new Date().toISOString(), pid: process.pid }));
const log = fs.openSync(job.logFile, "a");

status({ status: "running", error: null });
for (const command of job.commands) {
  fs.writeSync(log, `\n$ ${command}\n`);
  // The system's default shell: cmd.exe on Windows (never PowerShell), /bin/sh elsewhere.
  const r = spawnSync(command, { cwd: job.cwd, env: { ...process.env, ...job.env }, shell: true, stdio: ["ignore", log, log], windowsHide: true });
  if (r.error || r.status !== 0) {
    const why = r.error ? r.error.message : `退出码 ${r.status}`;
    status({ status: "failed", error: `准备命令「${command}」失败（${why}），输出见 ${job.logFile}` });
    process.exit(1);
  }
}
status({ status: "completed", error: null });
