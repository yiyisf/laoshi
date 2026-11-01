// Where the laoshi dsh plugin listens and how the engine finds it. Shared by the plugin (runs in
// the dsh host) and the engine's dsh runtime, so both compute the same places from DSH_HOME.
//
// The plugin opens a local socket (a named pipe on Windows) and writes a random token next to it;
// only processes that can read the token, i.e. the same user, can call it (ADR 0008: the engine
// talks to the plugin only, never to dsh's /api).
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";

/** dsh's home: $DSH_HOME, else ~/.dsh (dsh's own default). */
export function dshHome(env = process.env) {
  const configured = env.DSH_HOME?.trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), ".dsh");
}

/** The plugin's files under dsh's home, and the socket or pipe it listens on. */
export function channelPaths(home = dshHome()) {
  const dir = path.join(home, "laoshi");
  const tag = crypto.createHash("sha256").update(path.resolve(home)).digest("hex").slice(0, 12);
  let socket;
  if (process.platform === "win32") {
    socket = `\\\\.\\pipe\\laoshi-dsh-${tag}`;
  } else {
    socket = path.join(dir, "plugin.sock");
    // Unix socket paths are limited to about 104 bytes; a long home falls back to the temp directory
    // (the token, not the path, is what keeps other users out).
    if (Buffer.byteLength(socket) > 100) socket = path.join(os.tmpdir(), `laoshi-dsh-${tag}.sock`);
  }
  return { dir, socket, token: path.join(dir, "token"), log: path.join(dir, "plugin.log") };
}
