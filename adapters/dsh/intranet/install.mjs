#!/usr/bin/env node
// laoshi on DeepSeek Harness (dsh), one machine: the same as `laoshi install --platform dsh`
// (bin/install.mjs), kept so the intranet steps (docs/intranet/install-verify.md) stay the same.
//
//   node adapters/dsh/intranet/install.mjs [--home <LAOSHI_HOME>] [--dsh-home <DSH_HOME>] [--profile web]
//        [--dsh-bin <path to dsh's bin.js>] [--approvals ask|allow] [--skills-dir <dir>] [--dry-run]
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const kit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const args = process.argv.slice(2).map((a) => (a === "--skills-dir" ? "--target" : a));
if (!args.includes("--profile")) args.push("--profile", "web");
const r = spawnSync(process.execPath, [path.join(kit, "bin", "install.mjs"), "--platform", "dsh", ...args], { stdio: "inherit", windowsHide: true });
process.exit(r.status ?? 1);
