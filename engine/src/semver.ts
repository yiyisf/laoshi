// Version ranges (requiredVersion in the config, a platform's supported range).

import fs from "node:fs";
import path from "node:path";
import { KIT_ROOT } from "./locations.js";

/** Extracts the first semver core (with optional prerelease) from version output like "tool 0.36.0" or "v0.2.2-alpha.2". */
export function extractSemver(raw: string): string | null {
  const m = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\b/.exec(raw);
  return m ? m[1] : null;
}

/** Supported version range declared for a platform in package.json (`reqKit.<platformId>`), or null. */
export function supportedPlatformRange(platformId: string, root: string = KIT_ROOT): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { reqKit?: Record<string, unknown> };
    const range = pkg.reqKit?.[platformId];
    return typeof range === "string" && range.trim() ? range.trim() : null;
  } catch {
    return null;
  }
}

/** Minimal "x.y.z satisfies '>=a.b.c <d.e.f'" for the ranges req-kit declares. */
export function satisfies(version: string, range: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(/[-+]/)[0].split(".").map((n) => Number(n) || 0);
  const cmp = (a: number[], b: number[]) => {
    for (let i = 0; i < 3; i += 1) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
    return 0;
  };
  const v = parse(version);
  return range
    .trim()
    .split(/\s+/)
    .every((part) => {
      const match = /^(>=|<=|>|<|=)?(.+)$/.exec(part);
      if (!match) return false;
      const c = cmp(v, parse(match[2]));
      switch (match[1] ?? "=") {
        case ">=":
          return c >= 0;
        case "<=":
          return c <= 0;
        case ">":
          return c > 0;
        case "<":
          return c < 0;
        default:
          return c === 0;
      }
    });
}
