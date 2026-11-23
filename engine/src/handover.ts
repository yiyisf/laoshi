// Requirement handover (X5): transfers the current owner of a requirement and keeps an audit trail
// in <featureAbs>/.pipeline/owner.json (local runtime metadata, never committed).

import fs from "node:fs";
import path from "node:path";
import { userOf } from "./identity.js";
import { readState, replaceFile } from "./state.js";

export interface HandoverEvent {
  from: string | null;
  to: string;
  at: string;
  note: string | null;
}

export interface OwnerRecord {
  owner: string | null;
  history: HandoverEvent[];
}

export function ownerPath(featureAbs: string): string {
  return path.join(featureAbs, ".pipeline", "owner.json");
}

/** Reads the current owner and handover history; returns an empty record when absent. */
export function readOwner(featureAbs: string): OwnerRecord {
  const file = ownerPath(featureAbs);
  if (!fs.existsSync(file)) return { owner: null, history: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<OwnerRecord>;
    const owner = typeof raw.owner === "string" && raw.owner.trim() ? raw.owner.trim() : null;
    const history = Array.isArray(raw.history)
      ? raw.history.filter(
          (h): h is HandoverEvent =>
            typeof h === "object" && h !== null && typeof h.to === "string" && typeof h.at === "string",
        )
      : [];
    return { owner, history };
  } catch {
    return { owner: null, history: [] };
  }
}

/** Transfers the requirement to `to`, recording `from`, timestamp and optional note. */
export function handover(
  featureAbs: string,
  input: { to: string; note?: string | null; from?: string | null },
): OwnerRecord {
  const to = input.to.trim();
  if (!to) throw new Error("接手人不能为空");
  if (to.length > 64) throw new Error("接手人名称不能超过 64 个字符");

  const current = readOwner(featureAbs);
  let from = input.from !== undefined ? (input.from?.trim() || null) : current.owner;
  if (from === undefined || (from === null && input.from === undefined)) {
    let startedBy: string | null = null;
    try {
      startedBy = readState(path.join(featureAbs, ".pipeline", "state.json"))?.startedBy ?? null;
    } catch {
      startedBy = null;
    }
    from = startedBy ?? userOf();
  }

  const note = input.note?.trim() ? input.note.trim().slice(0, 500) : null;
  const next: OwnerRecord = {
    owner: to,
    history: [
      ...current.history,
      {
        from: from ?? null,
        to,
        at: new Date().toISOString(),
        note,
      },
    ],
  };

  const dir = path.join(featureAbs, ".pipeline");
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");

  const file = ownerPath(featureAbs);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  replaceFile(tmp, file);
  return next;
}
