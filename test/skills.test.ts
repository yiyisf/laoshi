import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import os from "node:os";
import { BUILTIN_SETUP, parseFragments, renderSkills, skillValues } from "../engine/src/skills-render.js";
import { NEUTRAL_WORDS } from "../engine/src/words.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const SKILLS = path.join(ROOT, "skills");
const KNOWN = new Set(["{{REQ_KIT_ROOT}}", "{{PIPELINE_LAUNCHER}}", "{{REQ_KIT_VERSION}}"]);

function markdownFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? markdownFiles(full) : e.name.endsWith(".md") ? [full] : [];
  });
}

test("每个 skill 的 frontmatter：name 与目录名一致，有 description，不含会破坏 YAML 的半角冒号加空格", () => {
  for (const name of fs.readdirSync(SKILLS)) {
    const text = fs.readFileSync(path.join(SKILLS, name, "SKILL.md"), "utf8");
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(front, `${name}：缺少 frontmatter`);
    assert.match(front[1], new RegExp(`^name: ${name}$`, "m"), `${name}：name 与目录名不一致`);
    const description = /^description: (.+)$/m.exec(front[1]);
    assert.ok(description && description[1].length < 1024, `${name}：description 缺失或过长`);
    assert.ok(!/: /.test(description[1]), `${name}：description 中有 ": "，会被 YAML 误读`);
  }
});

// laoshi M2e: skill text also names the platform's words and sections (engine/src/skills-render.ts).
const WORDS = new Set(Object.keys(NEUTRAL_WORDS));
const FRAGMENT_FILES = [BUILTIN_SETUP, path.join(ROOT, "adapters", "paseo", "skill", "setup.md"), path.join(ROOT, "adapters", "mogao", "skill", "setup.md"), path.join(ROOT, "adapters", "cli", "skill", "setup.md")];
const FRAGMENTS = new Set(FRAGMENT_FILES.flatMap((f) => Object.keys(parseFragments(fs.readFileSync(f, "utf8")))));

test("skill 中只用已知的占位符，引用的安装目录内文件都存在", () => {
  for (const file of [...markdownFiles(SKILLS), ...FRAGMENT_FILES]) {
    const text = fs.readFileSync(file, "utf8");
    for (const placeholder of text.match(/\{\{[A-Z_]+\}\}/g) ?? []) {
      assert.ok(KNOWN.has(placeholder), `${file}：未知占位符 ${placeholder}`);
    }
    for (const [, word] of text.matchAll(/\{\{platform\.(\w+)\}\}/g)) assert.ok(WORDS.has(word), `${file}：未知的平台词 ${word}`);
    for (const [, name] of text.matchAll(/\{\{fragment\.(\w+)\}\}/g)) assert.ok(FRAGMENTS.has(name), `${file}：未知的片段 ${name}`);
    for (const [, rel] of text.matchAll(/\{\{REQ_KIT_ROOT\}\}\/([\w./-]+)/g)) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `${file} 引用了不存在的 ${rel}`);
    }
  }
});

test("原则索引中的七条原则都有对应的 skill", () => {
  const index = fs.readFileSync(path.join(ROOT, "principles", "INDEX.md"), "utf8");
  const names = [...index.matchAll(/`(principle-[a-z-]+)`/g)].map((m) => m[1]);
  assert.equal(names.length, 7);
  for (const name of names) assert.ok(fs.existsSync(path.join(SKILLS, name, "SKILL.md")), `缺少 ${name}`);
});

test("/laoshi 的每本手册都有\"步骤\"一节，且都在入口的路由表中", () => {
  const dir = path.join(SKILLS, "laoshi", "playbooks");
  const entry = fs.readFileSync(path.join(SKILLS, "laoshi", "SKILL.md"), "utf8");
  const playbooks = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  assert.equal(playbooks.length, 9);
  for (const file of playbooks) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    assert.match(text, /^## 步骤\n\n1\. /m, `${file} 缺少"步骤"一节`);
    assert.ok(entry.includes(`skills/laoshi/playbooks/${file}`), `${file} 不在 /laoshi 的路由表中`);
  }
});

test("skill 按平台渲染（laoshi M2e）：占位符都替换掉；dsh 用 laoshi 内置的工作区设置，看不到别的平台", () => {
  for (const [adapter, config] of [["paseo", { platform: { adapter: "paseo" } }], ["dsh", { platform: { adapter: "dsh" } }], ["mogao", { platform: { adapter: "mogao" } }], ["cli", { platform: { adapter: "cli" } }]] as const) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), `laoshi-skills-${adapter}-`));
    const written = renderSkills(out, skillValues(config, "/opt/laoshi"));
    assert.ok(written.includes(path.join("laoshi", "SKILL.md")) && written.includes(path.join("laoshi-setup", "SKILL.md")));
    for (const file of markdownFiles(out)) {
      const text = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(text, /\{\{/, `${adapter}：${file} 还有占位符`);
      if (adapter !== "paseo") assert.doesNotMatch(text, /paseo/i, `${adapter}：${file} 提到了 Paseo`);
      if (adapter === "mogao" || adapter === "cli") assert.doesNotMatch(text, /\bdsh\b|DeepSeek/i, `${adapter}：${file} 提到了 dsh`);
      if (adapter === "cli") assert.doesNotMatch(text, /摸高|aimax/i, `${adapter}：${file} 提到了摸高`);
    }
    // 摸高's expert pins the version: every command that starts laoshi carries it (bin/ensure-version.mjs).
    const entry = fs.readFileSync(path.join(out, "laoshi", "SKILL.md"), "utf8");
    if (adapter === "mogao") {
      assert.match(entry, /LAOSHI_WANT_VERSION=\S+ node "\/opt\/laoshi\/bin\/start-pipeline\.mjs"/);
      assert.doesNotMatch(entry, /(?<!LAOSHI_WANT_VERSION=\S+ )node "\/opt\/laoshi\//, "摸高上每条 laoshi 命令都带版本");
    } else assert.doesNotMatch(entry, /LAOSHI_WANT_VERSION/);
    const setup = fs.readFileSync(path.join(out, "laoshi-setup", "SKILL.md"), "utf8");
    assert.match(setup, adapter === "paseo" ? /paseo\.json/ : /\.laoshi\/services\.json/);
    assert.match(setup, /\/opt\/laoshi\/contracts\/verify\.md/);
  }
});
