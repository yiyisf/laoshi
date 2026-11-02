// laoshi M2e: the skills as a platform's users get them (docs/design/platform-vocabulary.md, rule 2).
// Skills are written once for every platform; an installer renders them for the configured one:
//   {{REQ_KIT_ROOT}} / {{PIPELINE_LAUNCHER}} / {{REQ_KIT_VERSION}}  the installation
//   {{platform.<word>}}                                            the platform's words (words.ts)
//   {{fragment.<name>}} on a line of its own                       a section the platform provides
//                                                                  (PlatformAdapter.skillSetup), or laoshi's
// A line whose word is null, or whose fragment the platform does not have, is left out.
//
//   tsx engine/src/skills-render.ts --out <dir> [--config <install-level config>]

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { defaultConfigPath, ENGINE_DIR, KIT_ROOT, kitVersion, LAUNCHER } from "./locations.js";
import { adapterFor, adapterForFile, wordsFor } from "./runtime-loader.js";
import { type PlatformWords, renderWords } from "./words.js";

export const SKILLS_DIR = path.join(KIT_ROOT, "skills");
/** laoshi's own /laoshi-setup sections, for platforms whose services are laoshi's builtin ones. */
export const BUILTIN_SETUP = path.join(ENGINE_DIR, "skill-fragments", "setup-builtin.md");

export interface SkillValues {
  root: string;
  launcher: string;
  version: string;
  words: PlatformWords;
  fragments: Record<string, string>;
}

/** "<!-- fragment: name -->" blocks of a fragments file, by name. */
export function parseFragments(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let name: string | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (name) out[name] = lines.join("\n").trim();
  };
  for (const line of text.split("\n")) {
    const m = /^<!--\s*fragment:\s*(\w+)\s*-->$/.exec(line.trim());
    if (m) {
      flush();
      name = m[1];
      lines = [];
    } else if (name) lines.push(line);
  }
  flush();
  return out;
}

/** The skills' values for a configuration's platform (the install-level configuration's when not given). */
export function skillValues(config?: unknown, root: string = KIT_ROOT): SkillValues {
  const adapter = config === undefined ? adapterForFile(defaultConfigPath()) : adapterFor(config);
  const file = adapter.skillSetup ?? (adapter.capabilities.services === "builtin" ? BUILTIN_SETUP : null);
  return {
    root,
    launcher: path.join(root, path.relative(KIT_ROOT, LAUNCHER)),
    version: kitVersion(),
    words: wordsFor(config),
    fragments: file ? parseFragments(fs.readFileSync(file, "utf8")) : {},
  };
}

/** One skill file's text for the platform. */
export function renderSkillText(text: string, v: SkillValues): string {
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*\{\{fragment\.(\w+)\}\}\s*$/.exec(line);
    if (!m) lines.push(line);
    else if (v.fragments[m[1]]) lines.push(v.fragments[m[1]]);
  }
  const filled = lines
    .join("\n")
    .replaceAll("{{REQ_KIT_ROOT}}", v.root.split(path.sep).join("/"))
    .replaceAll("{{PIPELINE_LAUNCHER}}", v.launcher.split(path.sep).join("/"))
    .replaceAll("{{REQ_KIT_VERSION}}", v.version);
  return renderWords(filled, v.words);
}

/** Writes every skill, rendered, under `out` (one directory per skill, as installers place them). */
export function renderSkills(out: string, v: SkillValues, from: string = SKILLS_DIR): string[] {
  const written: string[] = [];
  for (const rel of fs.readdirSync(from, { recursive: true }) as string[]) {
    const src = path.join(from, rel);
    if (fs.statSync(src).isDirectory()) continue;
    const dest = path.join(out, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (rel.endsWith(".md")) fs.writeFileSync(dest, renderSkillText(fs.readFileSync(src, "utf8"), v));
    else fs.copyFileSync(src, dest);
    written.push(rel);
  }
  return written;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).replace(/\.ts$/, "") === path.join(ENGINE_DIR, "src", "skills-render");
if (isMain) {
  const { values } = parseArgs({ options: { out: { type: "string" }, config: { type: "string" } } });
  if (!values.out) {
    console.error("用法：skills-render --out <目录> [--config <安装级配置>]");
    process.exit(2);
  }
  const config = values.config ? JSON.parse(fs.readFileSync(path.resolve(values.config), "utf8")) : undefined;
  const written = renderSkills(path.resolve(values.out), skillValues(config));
  console.log(`已写入 ${written.length} 个文件到 ${path.resolve(values.out)}`);
}
