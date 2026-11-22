#!/usr/bin/env node
// Syncs platform-agnostic UI view-model (ui/shared/view-model.ts) into standalone plugin packages
// (such as adapters/paseo/plugin/shared/view-model.ts, which is copied standalone on install).
//
//   node scripts/sync-ui-shared.mjs          write copies
//   node scripts/sync-ui-shared.mjs --check  exit 1 if any copy is out of date

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(REPO, "ui", "shared", "view-model.ts");
const TARGETS = [path.join(REPO, "adapters", "paseo", "plugin", "shared", "view-model.ts")];

const HEADER = "// Generated from ui/shared/view-model.ts by scripts/sync-ui-shared.mjs — do not edit directly.\n";

const expected = `${HEADER}${fs.readFileSync(SOURCE, "utf8")}`;
const checkOnly = process.argv.includes("--check");
const stale = [];

for (const target of TARGETS) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (current === expected) continue;
  if (checkOnly) {
    stale.push(path.relative(REPO, target));
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, expected, "utf8");
    console.log(`已同步 ${path.relative(REPO, target)}`);
  }
}

if (checkOnly) {
  if (stale.length > 0) {
    console.error(`共享视图层未同步，请运行 node scripts/sync-ui-shared.mjs：\n${stale.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`共享视图层一致（${TARGETS.length} 处）`);
}
