// The Paseo adapter's own settings (laoshi M2c): platform.paseo in the install-level config,
//   { "platform": { "adapter": "paseo", "paseo": { "daemonUrl": "ws://…", "daemonPasswordEnv": "…" } } }
// The top-level daemonUrl / daemonPasswordEnv of req-kit 1.x still work when platform.paseo does not set them.

import { DEFAULT_CONFIG } from "../../engine/src/config.js";

export interface DaemonSettings {
  daemonUrl: string;
  daemonPasswordEnv: string;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

/** Where the daemon is, from a loaded config or a raw config file's contents. */
export function daemonOf(config: unknown): DaemonSettings {
  const c = (config ?? {}) as { daemonUrl?: unknown; daemonPasswordEnv?: unknown; platform?: { paseo?: { daemonUrl?: unknown; daemonPasswordEnv?: unknown } } };
  const own = c.platform && typeof c.platform === "object" ? (c.platform.paseo ?? {}) : {};
  return {
    daemonUrl: text(own.daemonUrl) ?? text(c.daemonUrl) ?? DEFAULT_CONFIG.daemonUrl,
    daemonPasswordEnv: text(own.daemonPasswordEnv) ?? text(c.daemonPasswordEnv) ?? DEFAULT_CONFIG.daemonPasswordEnv,
  };
}
