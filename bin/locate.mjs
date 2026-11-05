// Finds an installed dependency the way Node does: in <dir>/node_modules, then in each
// parent directory. A git checkout keeps dependencies in its own node_modules; an npm
// install puts them next to the package (versions/<v>/node_modules) or inside it (global).
import fs from "node:fs";
import path from "node:path";

export function findDependency(fromDir, name) {
  let dir = path.resolve(fromDir);
  for (;;) {
    const candidate = path.join(dir, "node_modules", ...name.split("/"));
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** tsx's command-line entry, or null when tsx is not installed. */
export function findTsxCli(fromDir) {
  const tsx = findDependency(fromDir, "tsx");
  return tsx ? path.join(tsx, "dist", "cli.mjs") : null;
}
