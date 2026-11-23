// Requirement change history (X5): reads spec version, parsed changes.md entries,
// git history/diffs of spec.md, and handover/ownership metadata for one requirement.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { locate } from "./api.js";
import { type OwnerRecord, readOwner } from "./handover.js";

const MAX_DIFF_CHARS = 20_000;

export interface ChangeEntry {
  title: string;
  body: string;
}

export interface SpecCommit {
  commit: string;
  date: string;
  author: string;
  subject: string;
  diff: string;
  truncated: boolean;
}

export interface RequirementHistory {
  specVersion: string | null;
  changes: ChangeEntry[];
  commits: SpecCommit[];
  owner: OwnerRecord;
}

/** Extracts spec version from header lines such as "- 版本：2" or "版本：2". */
export function parseSpecVersion(content: string): string | null {
  const m = /^(?:-\s*)?版本\s*[：:]\s*(.+)$/m.exec(content);
  return m?.[1]?.trim() || null;
}

/** Splits changes.md by "## " headings, returning up to `max` entries newest-first. */
export function parseChanges(content: string, max = 50): ChangeEntry[] {
  const lines = content.split(/\r?\n/);
  const entries: Array<{ title: string; bodyLines: string[] }> = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      entries.push({ title: line.slice(3).trim(), bodyLines: [] });
    } else if (entries.length > 0) {
      entries[entries.length - 1].bodyLines.push(line);
    }
  }
  return entries
    .map((e) => ({ title: e.title, body: e.bodyLines.join("\n").trim() }))
    .slice(-max)
    .reverse();
}

function readGitHistory(repo: string, posixSpec: string): SpecCommit[] {
  const logRes = spawnSync(
    "git",
    ["log", "-n", "10", "--format=%H%x1f%aI%x1f%an%x1f%s", "--", posixSpec],
    { cwd: repo, encoding: "utf8", windowsHide: true },
  );
  if (logRes.status !== 0 || !logRes.stdout) return [];

  const commits: SpecCommit[] = [];
  for (const line of logRes.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [commit, date = "", author = "", subject = ""] = line.split("\x1f");
    if (!commit) continue;
    const showRes = spawnSync(
      "git",
      ["show", "--format=", "--unified=3", commit, "--", posixSpec],
      { cwd: repo, encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
    );
    const raw = showRes.status === 0 ? (showRes.stdout ?? "").trimEnd() : "";
    const truncated = raw.length > MAX_DIFF_CHARS;
    commits.push({
      commit,
      date,
      author,
      subject,
      diff: truncated ? raw.slice(0, MAX_DIFF_CHARS) : raw,
      truncated,
    });
  }
  return commits;
}

/** Returns version, changelog sections, spec.md git diffs, and handover history for a requirement. */
export function apiHistory(repoArg: string, feature: string): RequirementHistory {
  const { repo, featureDir } = locate(repoArg, feature);
  const featureAbs = path.join(repo, featureDir);
  const specFile = path.join(featureAbs, "spec.md");
  const changesFile = path.join(featureAbs, "changes.md");

  const specVersion = fs.existsSync(specFile) ? parseSpecVersion(fs.readFileSync(specFile, "utf8")) : null;
  const changes = fs.existsSync(changesFile) ? parseChanges(fs.readFileSync(changesFile, "utf8")) : [];
  const posixSpec = `${featureDir.split(path.sep).join("/")}/spec.md`;
  const commits = readGitHistory(repo, posixSpec);
  const owner = readOwner(featureAbs);

  return { specVersion, changes, commits, owner };
}
