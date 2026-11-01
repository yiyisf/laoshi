// Version ranges (requiredVersion in the config, a platform's supported range).

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
