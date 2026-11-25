// Shared Web board view for dsh web plugin (D1) and local requirement dashboard.
// Follows design/ Bento Launchpad tokens (--rk-*) with top-level Requirement / Stats / Config
// navigation, full-width requirement detail view matching Paseo plugin ergonomics, Markdown/TSV
// modal document viewer, interactive acceptance & history workbenches, and host session links.

import {
  ACTION_TEXT,
  actionsFor,
  ago,
  ATTENTION_LABELS,
  buildInboxCards,
  facts,
  GROUP_EYEBROWS,
  GROUP_LABELS,
  GROUP_ORDER,
  groupOf,
  type RequirementView,
  summarizeBoard,
  trackOf,
  TYPE_LABELS,
} from "../shared/view-model.js";

export interface BoardRenderOptions {
  title?: string;
  platformName?: string;
  readOnly?: boolean;
  now?: number;
  /** Optional API base path (e.g. "/api") enabling live actions, detail fetch, stats, config, and document preview. */
  apiBase?: string;
  /** CSRF token required in X-Laoshi-Token header for POST actions when apiBase is set. */
  csrfToken?: string;
  /** Optional host shell identifier (e.g. "dsh") enabling host session navigation. */
  embedHost?: string;
  /** Initial color theme when hosted inside an iframe. */
  initialTheme?: "dark" | "light";
}

const GROUP_SUBTITLES: Record<string, string> = {
  running: "AI 正在推进",
  verify: "研发已完成，等待测试验证",
  done: "近 14 天内完成",
  other: "较早或未启动的需求",
};

const FILE_LABELS: Record<string, string> = {
  "spec.md": "需求说明",
  "alignment.md": "访谈记录",
  "spec-review.md": "需求说明审阅",
  "changes.md": "需求变更",
  "decisions.tsv": "决策记录",
  "design.md": "方案",
  "design-review.md": "方案审核",
  "preview.md": "确认预览",
  "contract.md": "接口约定",
  "diagnosis.md": "复现与定位",
  "assessment.md": "评估",
  "implementation.md": "实现记录",
  "progress.md": "进展",
  "code-review.md": "代码评审",
  "handoff.md": "提测说明",
  "service-start.md": "服务启动",
  "verification.md": "功能验证",
  "report.md": "完成报告",
  "acceptance.md": "验收记录",
  "lessons.tsv": "可以变成规则的问题",
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Renders a complete, self-contained HTML page for the shared requirement board. */
export function renderBoardHtml(items: RequirementView[], options: BoardRenderOptions = {}): string {
  const now = options.now ?? Date.now();
  const title = options.title ?? "laoshi · 需求看板";
  const platformName = options.platformName ?? "laoshi";
  const readOnly = Boolean(options.readOnly);

  const summary = summarizeBoard(items, now);
  const inbox = buildInboxCards(items, now);
  const projects = [...new Set(items.map((i) => i.project))].sort();

  const grouped = new Map<string, RequirementView[]>();
  for (const item of items) {
    const g = groupOf(item, now);
    if (g === "attention") continue;
    grouped.set(g, [...(grouped.get(g) ?? []), item]);
  }

  const inboxHtml =
    inbox.length === 0
      ? ""
      : `<section class="rk-section" data-group="attention">
  <div class="rk-section-head">
    <span class="rk-eyebrow rk-eyebrow-needs">需要你处理 · ${inbox.length}</span>
    <span class="rk-section-sub">按等待时长从久到近排序</span>
  </div>
  <div class="rk-inbox-grid">
    ${inbox
      .map((card) => {
        const { item, kind, waitedText, urgency, primaryAction } = card;
        const primary = primaryAction ? ACTION_TEXT[primaryAction] : null;
        return `<article class="rk-inbox-card rk-urgency-${urgency}" data-key="${escapeHtml(item.key)}" data-project="${escapeHtml(item.project)}" data-group="attention" data-search="${escapeHtml(`${item.title} ${item.project} ${item.featureDir} ${item.branch ?? ""} ${item.owner ?? ""} ${item.waiting?.card?.id ?? ""}`.toLowerCase())}">
      <div class="rk-card-top">
        <div class="rk-card-title-wrap">
          <span class="rk-badge rk-tone-${kind.tone}">${escapeHtml(kind.label)}</span>
          <h3 class="rk-card-title">${escapeHtml(item.title)}</h3>
        </div>
        <span class="rk-wait rk-wait-${urgency}">${escapeHtml(waitedText)}</span>
      </div>
      <div class="rk-meta">${escapeHtml(facts(item))}${item.owner ? ` · 负责人：${escapeHtml(item.owner)}` : ""}${item.waiting?.card ? ` · 卡片 ${escapeHtml(item.waiting.card.system)} ${escapeHtml(item.waiting.card.id)}` : ""}</div>
      <p class="rk-todo">${escapeHtml(kind.todo)}</p>
      <p class="rk-impact">${escapeHtml(kind.impact)}</p>
      <div class="rk-card-actions">
        ${!readOnly && primary ? `<button type="button" class="rk-btn rk-btn-primary" data-action="${primaryAction}" data-key="${escapeHtml(item.key)}">${escapeHtml(primary.label)}</button>` : ""}
        <button type="button" class="rk-btn" data-open="${escapeHtml(item.key)}">查看详情</button>
      </div>
    </article>`;
      })
      .join("\n")}
  </div>
</section>`;

  const groupsHtml = GROUP_ORDER.filter((g) => g !== "attention" && grouped.has(g))
    .map((g) => {
      const list = grouped.get(g)!;
      return `<section class="rk-section" data-group="${g}">
  <div class="rk-section-head">
    <span class="rk-eyebrow">${GROUP_EYEBROWS[g]} · ${list.length}</span>
    <span class="rk-section-sub">${GROUP_SUBTITLES[g] ?? GROUP_LABELS[g]}</span>
  </div>
  <div class="rk-list">
    ${list
      .map((item) => {
        const stops = trackOf(item);
        const actions = actionsFor(item);
        return `<article class="rk-row" tabindex="0" data-key="${escapeHtml(item.key)}" data-project="${escapeHtml(item.project)}" data-group="${g}" data-search="${escapeHtml(`${item.title} ${item.project} ${item.featureDir} ${item.branch ?? ""} ${item.owner ?? ""} ${item.stage}`.toLowerCase())}">
      <div class="rk-row-main">
        <div class="rk-row-head">
          <strong class="rk-row-title">${escapeHtml(item.title)}</strong>
          <span class="rk-stage">${escapeHtml(item.stage)}</span>
        </div>
        <div class="rk-meta">${escapeHtml(facts(item))}${item.owner ? ` · 负责人：${escapeHtml(item.owner)}` : ""}${item.branch ? ` · <code>${escapeHtml(item.branch)}</code>` : ""} · ${escapeHtml(ago(item.updatedAt, now))}</div>
      </div>
      <ol class="rk-track" aria-label="阶段进度">
        ${stops
          .map(
            (s) =>
              `<li class="rk-stop rk-stop-${s.state}" title="${escapeHtml(`${s.label}（${s.who}）`)}"><span class="rk-dot"></span><span class="rk-stop-label">${escapeHtml(s.label)}</span></li>`,
          )
          .join("")}
      </ol>
      <div class="rk-row-actions">
        ${!readOnly && actions[0] ? `<button type="button" class="rk-btn" data-action="${actions[0]}" data-key="${escapeHtml(item.key)}">${escapeHtml(ACTION_TEXT[actions[0]].label)}</button>` : ""}
        <button type="button" class="rk-btn rk-btn-ghost" data-open="${escapeHtml(item.key)}">详情</button>
      </div>
    </article>`;
      })
      .join("\n")}
  </div>
</section>`;
    })
    .join("\n");

  const payload = JSON.stringify(
    items.map((i) => ({
      key: i.key,
      repo: i.sourceRepo ?? i.repo,
      workRepo: i.repo,
      title: i.title,
      project: i.project,
      featureDir: i.featureDir,
      branch: i.branch ?? null,
      type: i.type ?? null,
      profile: i.profile ?? null,
      stage: i.stage,
      status: i.status,
      attention: i.attention ?? null,
      running: Boolean(i.running),
      hasPrototype: Boolean(i.hasPrototype),
      startedBy: i.startedBy ?? null,
      owner: i.owner ?? null,
      facts: facts(i),
      updated: ago(i.updatedAt, now),
      waiting: i.waiting ?? null,
      stops: trackOf(i),
      actions: readOnly ? [] : actionsFor(i).map((a) => ({ id: a, ...ACTION_TEXT[a] })),
    })),
  ).replace(/</g, "\\u003c");
  const initialTheme = options.initialTheme === "light" ? "light" : "dark";
  const runtimeCfg = JSON.stringify({
    apiBase: options.apiBase ?? null,
    csrfToken: options.csrfToken ?? null,
    readOnly,
    embedHost: options.embedHost ?? null,
    fileLabels: FILE_LABELS,
    attentionLabels: ATTENTION_LABELS,
    typeLabels: TYPE_LABELS,
    actionText: ACTION_TEXT,
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="zh-CN" data-theme="${initialTheme}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
:root {
  --rk-bg: #0c0e12;
  --rk-surface-1: #13161d;
  --rk-surface-2: #1a1e28;
  --rk-border: #262c3a;
  --rk-fg: #eef1f7;
  --rk-muted: #939db2;
  --rk-brand: #b7f34d;
  --rk-brand-fg: #101706;
  --rk-brand-tint: rgba(183, 243, 77, 0.14);
  --rk-data: #38bdf8;
  --rk-data-tint: rgba(56, 189, 248, 0.14);
  --rk-warn: #f59e0b;
  --rk-warn-tint: rgba(245, 158, 11, 0.14);
  --rk-danger: #f87171;
  --rk-danger-tint: rgba(248, 113, 113, 0.14);
  --rk-success: #4ade80;
  --rk-success-tint: rgba(74, 222, 128, 0.14);
  --rk-mono: ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace;
}
[data-theme="light"] {
  --rk-bg: #f6f7f9;
  --rk-surface-1: #ffffff;
  --rk-surface-2: #eef1f5;
  --rk-border: #dce1ea;
  --rk-fg: #111827;
  --rk-muted: #5b6578;
  --rk-brand: #5b8c00;
  --rk-brand-fg: #ffffff;
  --rk-brand-tint: rgba(91, 140, 0, 0.12);
  --rk-data: #0284c7;
  --rk-data-tint: rgba(2, 132, 199, 0.12);
  --rk-warn: #d97706;
  --rk-warn-tint: rgba(217, 119, 6, 0.12);
  --rk-danger: #dc2626;
  --rk-danger-tint: rgba(220, 38, 38, 0.12);
  --rk-success: #15803d;
  --rk-success-tint: rgba(21, 128, 61, 0.12);
}
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--rk-bg); color: var(--rk-fg); }
.rk-shell { max-width: 1120px; margin: 0 auto; padding: 20px 20px 64px; }
.rk-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.rk-topbar-left { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.rk-brand-title { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 700; }
.rk-dot-brand { width: 10px; height: 10px; border-radius: 999px; background: var(--rk-brand); display: inline-block; }
.rk-nav-tabs { display: flex; align-items: center; gap: 4px; background: var(--rk-surface-1); border: 1px solid var(--rk-border); border-radius: 10px; padding: 3px; }
.rk-nav-tab { background: transparent; border: none; color: var(--rk-muted); border-radius: 7px; padding: 5px 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
.rk-nav-tab:hover { color: var(--rk-fg); }
.rk-nav-tab.active { background: var(--rk-brand-tint); color: var(--rk-brand); }
.rk-kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
.rk-stats-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 16px; }
.rk-kpi { background: var(--rk-surface-1); border: 1px solid var(--rk-border); border-radius: 14px; padding: 14px 16px; text-align: left; cursor: pointer; color: inherit; transition: border-color .15s, transform .15s; }
.rk-kpi:hover, .rk-kpi.active { border-color: var(--rk-brand); }
.rk-kpi-static { cursor: default; }
.rk-kpi-static:hover { border-color: var(--rk-border); }
.rk-kpi-label { font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--rk-muted); }
.rk-kpi-num { font-size: 26px; font-weight: 700; margin-top: 6px; font-variant-numeric: tabular-nums; }
.rk-kpi-sub { font-size: 12px; color: var(--rk-muted); margin-top: 2px; }
.rk-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 20px; }
.rk-search { flex: 1; min-width: 220px; background: var(--rk-surface-1); border: 1px solid var(--rk-border); color: var(--rk-fg); border-radius: 10px; padding: 9px 12px; font-size: 13px; }
.rk-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.rk-chip { background: var(--rk-surface-1); border: 1px solid var(--rk-border); color: var(--rk-muted); border-radius: 999px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
.rk-chip:hover { border-color: var(--rk-muted); color: var(--rk-fg); }
.rk-chip.active { background: var(--rk-brand-tint); border-color: var(--rk-brand); color: var(--rk-brand); font-weight: 600; }
.rk-section { margin-bottom: 24px; }
.rk-section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.rk-eyebrow { font: 600 12px/1.2 var(--rk-mono); letter-spacing: 0.04em; color: var(--rk-fg); text-transform: uppercase; }
.rk-eyebrow-needs { color: var(--rk-brand); }
.rk-section-sub { font-size: 12px; color: var(--rk-muted); }
.rk-inbox-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 12px; }
.rk-inbox-card { background: var(--rk-surface-1); border: 1px solid var(--rk-border); border-left: 3px solid var(--rk-brand); border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.rk-urgency-urgent { border-left-color: var(--rk-danger); }
.rk-urgency-elevated { border-left-color: var(--rk-warn); }
.rk-card { background: var(--rk-surface-1); border: 1px solid var(--rk-border); border-radius: 14px; padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; }
.rk-card-danger { border-color: var(--rk-danger); }
.rk-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.rk-card-heading { margin: 0; font-size: 14px; font-weight: 700; color: var(--rk-fg); }
.rk-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.rk-card-title-wrap { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.rk-card-title { margin: 0; font-size: 15px; font-weight: 600; }
.rk-badge { align-self: flex-start; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 6px; white-space: nowrap; }
.rk-tone-needs { background: var(--rk-brand-tint); color: var(--rk-brand); }
.rk-tone-data { background: var(--rk-data-tint); color: var(--rk-data); }
.rk-tone-warning { background: var(--rk-warn-tint); color: var(--rk-warn); }
.rk-tone-danger { background: var(--rk-danger-tint); color: var(--rk-danger); }
.rk-tone-success { background: var(--rk-success-tint); color: var(--rk-success); }
.rk-tone-muted { background: var(--rk-surface-2); color: var(--rk-muted); }
.rk-wait { font: 500 12px/1 var(--rk-mono); color: var(--rk-muted); white-space: nowrap; }
.rk-wait-urgent { color: var(--rk-danger); font-weight: 700; }
.rk-wait-elevated { color: var(--rk-warn); }
.rk-meta { font-size: 12px; color: var(--rk-muted); }
.rk-meta code { font-family: var(--rk-mono); font-size: 11px; }
.rk-mono { font-family: var(--rk-mono); font-size: 12px; color: var(--rk-muted); word-break: break-all; }
.rk-todo { margin: 0; font-size: 13px; }
.rk-impact { margin: 0; font-size: 12px; color: var(--rk-muted); }
.rk-card-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: auto; padding-top: 6px; }
.rk-row-actions { display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex-wrap: nowrap; }
.rk-btn { background: var(--rk-surface-2); border: 1px solid var(--rk-border); color: var(--rk-fg); border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.rk-btn:hover:not(:disabled) { border-color: var(--rk-muted); }
.rk-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.rk-btn-primary { background: var(--rk-brand); border-color: var(--rk-brand); color: var(--rk-brand-fg); }
.rk-btn-primary:hover:not(:disabled) { filter: brightness(0.95); }
.rk-btn-danger { background: var(--rk-danger-tint); border-color: var(--rk-danger); color: var(--rk-danger); }
.rk-btn-ghost { background: transparent; }
.rk-toast { position: fixed; bottom: 20px; right: 20px; max-width: 420px; background: var(--rk-surface-2); border: 1px solid var(--rk-border); color: var(--rk-fg); border-radius: 10px; padding: 10px 14px; font-size: 13px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); z-index: 60; opacity: 0; pointer-events: none; transition: opacity .16s ease; }
.rk-toast.show { opacity: 1; }
.rk-toast.ok { border-color: var(--rk-success); }
.rk-toast.err { border-color: var(--rk-danger); }
.rk-doc-preview { background: var(--rk-bg); border: 1px solid var(--rk-border); border-radius: 10px; padding: 12px; font: 12px/1.6 var(--rk-mono); white-space: pre-wrap; word-break: break-word; max-height: 280px; overflow-y: auto; margin: 0; }
.rk-tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--rk-border); padding-bottom: 10px; flex-wrap: wrap; }
.rk-tab { background: transparent; border: 1px solid transparent; color: var(--rk-muted); border-radius: 8px; padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
.rk-tab.active { background: var(--rk-brand-tint); border-color: var(--rk-brand); color: var(--rk-brand); }
.rk-ac-card { background: var(--rk-surface-2); border: 1px solid var(--rk-border); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; }
.rk-ac-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.rk-ac-id { font: 600 11px/1 var(--rk-mono); color: var(--rk-brand); }
.rk-ac-ev { font-size: 12px; color: var(--rk-muted); background: var(--rk-bg); border-radius: 6px; padding: 6px 8px; }
.rk-mark-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.rk-mark { background: var(--rk-surface-1); border: 1px solid var(--rk-border); color: var(--rk-muted); border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
.rk-mark.active-pass { background: var(--rk-success-tint); border-color: var(--rk-success); color: var(--rk-success); font-weight: 600; }
.rk-mark.active-fail { background: var(--rk-danger-tint); border-color: var(--rk-danger); color: var(--rk-danger); font-weight: 600; }
.rk-mark.active-skip { background: var(--rk-surface-1); border-color: var(--rk-muted); color: var(--rk-fg); font-weight: 600; }
.rk-note-input { width: 100%; background: var(--rk-bg); border: 1px solid var(--rk-border); color: var(--rk-fg); border-radius: 6px; padding: 7px 10px; font-size: 13px; }
.rk-service-link { color: var(--rk-data); text-decoration: none; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
.rk-service-link:hover { text-decoration: underline; }
.rk-info-box { background: var(--rk-surface-2); border: 1px solid var(--rk-border); border-radius: 10px; padding: 10px 12px; font-size: 13px; line-height: 1.6; display: flex; flex-direction: column; gap: 4px; }
.rk-textarea { width: 100%; min-height: 88px; resize: vertical; background: var(--rk-bg); border: 1px solid var(--rk-border); color: var(--rk-fg); border-radius: 8px; padding: 8px 10px; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.rk-change-item { background: var(--rk-surface-2); border: 1px solid var(--rk-border); border-radius: 10px; overflow: hidden; }
.rk-change-head { width: 100%; background: transparent; border: none; color: inherit; padding: 10px 12px; text-align: left; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.rk-change-head:hover { background: var(--rk-surface-1); }
.rk-change-body { border-top: 1px solid var(--rk-border); background: var(--rk-bg); padding: 10px 12px; font: 12px/1.6 var(--rk-mono); white-space: pre-wrap; word-break: break-word; margin: 0; }
.rk-diff { border-top: 1px solid var(--rk-border); background: var(--rk-bg); padding: 8px 0; font: 12px/1.55 var(--rk-mono); overflow-x: auto; max-height: 320px; overflow-y: auto; }
.rk-diff-line { padding: 1px 10px; white-space: pre-wrap; word-break: break-word; }
.rk-diff-add { background: var(--rk-success-tint); color: var(--rk-success); }
.rk-diff-del { background: var(--rk-danger-tint); color: var(--rk-danger); }
.rk-diff-hunk { color: var(--rk-data); }
.rk-list { display: flex; flex-direction: column; gap: 8px; }
.rk-row { background: var(--rk-surface-1); border: 1px solid var(--rk-border); border-radius: 12px; padding: 12px 16px; display: grid; grid-template-columns: minmax(0, 1fr) 316px 176px; align-items: center; gap: 14px; cursor: pointer; }
.rk-row:hover { border-color: var(--rk-brand); }
.rk-row-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.rk-row-title { font-size: 14px; }
.rk-stage { font-size: 11px; padding: 2px 7px; border-radius: 6px; background: var(--rk-surface-2); color: var(--rk-muted); }
.rk-track { list-style: none; margin: 0; padding: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; }
.rk-stop { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--rk-muted); white-space: nowrap; }
.rk-dot { width: 8px; height: 8px; border-radius: 999px; background: var(--rk-border); flex-shrink: 0; }
.rk-stop-done .rk-dot { background: var(--rk-success); }
.rk-stop-now .rk-dot { background: var(--rk-data); box-shadow: 0 0 0 4px var(--rk-data-tint); }
.rk-stop-needs .rk-dot { background: var(--rk-brand); box-shadow: 0 0 0 4px var(--rk-brand-tint); }
.rk-stop-now .rk-stop-label, .rk-stop-needs .rk-stop-label { color: var(--rk-fg); font-weight: 600; }
.rk-empty { background: var(--rk-surface-1); border: 1px dashed var(--rk-border); border-radius: 14px; padding: 32px; text-align: center; color: var(--rk-muted); }
/* Full-width detail view */
.rk-detail-shell { display: flex; flex-direction: column; gap: 16px; }
.rk-detail-nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding-bottom: 10px; border-bottom: 1px solid var(--rk-border); }
.rk-detail-nav-left { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.rk-detail-title { margin: 0; font-size: 22px; font-weight: 700; line-height: 1.3; }
.rk-detail-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.rk-detail-stage { font-size: 14px; font-weight: 600; margin: 0; }
.rk-detail-stage-needs { color: var(--rk-brand); }
.rk-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.rk-detail-section-row { display: flex; flex-direction: column; gap: 14px; }
.rk-step-list { display: flex; flex-direction: column; gap: 8px; }
.rk-step-item { width: 100%; text-align: left; font: inherit; color: inherit; background: var(--rk-surface-2); border: 1px solid var(--rk-border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; }
.rk-step-link { cursor: pointer; transition: border-color .15s, background .15s; }
.rk-step-link:hover, .rk-step-link:focus-visible { border-color: var(--rk-brand); background: var(--rk-surface-1); outline: none; }
.rk-step-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; width: 100%; }
.rk-step-title { font-size: 13px; font-weight: 600; color: var(--rk-fg); }
.rk-step-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--rk-muted); width: 100%; }
.rk-step-jump { font-size: 12px; font-weight: 600; color: var(--rk-brand); white-space: nowrap; }
.rk-step-error { font-size: 12px; color: var(--rk-danger); white-space: pre-wrap; word-break: break-word; }
.rk-bar-row { display: flex; flex-direction: column; gap: 4px; }
.rk-bar-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; }
.rk-bar-track { height: 7px; border-radius: 999px; background: var(--rk-surface-2); overflow: hidden; }
.rk-bar-fill { height: 100%; border-radius: 999px; background: var(--rk-data); }
.rk-cfg-item { width: 100%; text-align: left; font: inherit; color: inherit; background: transparent; border: none; border-top: 1px solid var(--rk-border); padding: 12px 0; cursor: pointer; display: flex; flex-direction: column; gap: 4px; }
.rk-cfg-item:first-child { border-top: none; padding-top: 4px; }
.rk-cfg-item:last-child { padding-bottom: 4px; }
.rk-cfg-item:hover .rk-cfg-label { color: var(--rk-brand); }
.rk-cfg-label { font-size: 14px; font-weight: 600; }
.rk-cfg-detail { margin-top: 6px; display: flex; flex-direction: column; gap: 6px; }
/* Modal dialogs (document viewer & action forms) */
.rk-modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.58); backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 40; }
.rk-modal { width: min(920px, 100%); max-height: 88vh; background: var(--rk-surface-1); border: 1px solid var(--rk-border); border-radius: 16px; display: flex; flex-direction: column; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45); overflow: hidden; }
.rk-modal-sm { width: min(540px, 100%); }
.rk-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; border-bottom: 1px solid var(--rk-border); }
.rk-modal-title { margin: 0; font-size: 16px; font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rk-modal-body { padding: 18px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
/* Markdown & TSV document styles */
.rk-md { font-size: 14px; line-height: 1.7; color: var(--rk-fg); word-break: break-word; }
.rk-md h1, .rk-md h2, .rk-md h3, .rk-md h4 { margin: 16px 0 8px; line-height: 1.35; }
.rk-md h1 { font-size: 20px; border-bottom: 1px solid var(--rk-border); padding-bottom: 6px; }
.rk-md h2 { font-size: 17px; }
.rk-md h3 { font-size: 15px; }
.rk-md h4 { font-size: 14px; color: var(--rk-muted); }
.rk-md > *:first-child { margin-top: 0; }
.rk-md p { margin: 0 0 10px; }
.rk-md ul, .rk-md ol { margin: 0 0 12px; padding-left: 22px; }
.rk-md li { margin: 4px 0; }
.rk-md blockquote { margin: 0 0 12px; padding: 6px 12px; border-left: 3px solid var(--rk-brand); background: var(--rk-surface-2); border-radius: 0 8px 8px 0; color: var(--rk-muted); }
.rk-md hr { border: none; border-top: 1px solid var(--rk-border); margin: 14px 0; }
.rk-md code { font-family: var(--rk-mono); font-size: 12px; background: var(--rk-surface-2); padding: 1px 5px; border-radius: 5px; }
.rk-md pre { background: var(--rk-bg); border: 1px solid var(--rk-border); border-radius: 10px; padding: 12px 14px; overflow-x: auto; margin: 0 0 12px; }
.rk-md pre code { background: none; padding: 0; font-size: 12px; line-height: 1.55; }
.rk-md a { color: var(--rk-data); text-decoration: none; }
.rk-md a:hover { text-decoration: underline; }
.rk-table-wrap { width: 100%; overflow-x: auto; border: 1px solid var(--rk-border); border-radius: 10px; margin-bottom: 12px; }
.rk-table { width: 100%; border-collapse: collapse; font-size: 12px; line-height: 1.5; }
.rk-table th, .rk-table td { border-bottom: 1px solid var(--rk-border); padding: 7px 10px; text-align: left; vertical-align: top; }
.rk-table th { background: var(--rk-surface-2); font-weight: 700; color: var(--rk-fg); white-space: nowrap; }
.rk-table tr:last-child td { border-bottom: none; }
.rk-hidden { display: none !important; }
@media (max-width: 900px) {
  .rk-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rk-row { grid-template-columns: 1fr; }
  .rk-row-actions { justify-content: flex-start; }
  .rk-detail-grid { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<div class="rk-shell">
  <header class="rk-topbar">
    <div class="rk-topbar-left">
      <div class="rk-brand-title"><span class="rk-dot-brand"></span><span>${escapeHtml(title)}</span><span class="rk-stage">${escapeHtml(platformName)}</span></div>
      <nav class="rk-nav-tabs" role="tablist" aria-label="主导航">
        <button type="button" class="rk-nav-tab active" role="tab" aria-selected="true" data-nav="overview">需求</button>
        <button type="button" class="rk-nav-tab" role="tab" aria-selected="false" data-nav="stats">使用统计</button>
        <button type="button" class="rk-nav-tab" role="tab" aria-selected="false" data-nav="config">配置</button>
      </nav>
    </div>
    <div class="rk-card-actions" style="margin-top:0;padding-top:0">
      ${options.apiBase ? `<button type="button" class="rk-btn" id="rk-refresh">刷新</button>` : ""}
      <button type="button" class="rk-btn" id="rk-theme-toggle">切换深浅主题</button>
    </div>
  </header>

  <main id="rk-overview-view">
    <section class="rk-kpi-grid" aria-label="状态概览">
      <button type="button" class="rk-kpi active" data-filter-group="all">
        <div class="rk-kpi-label">需要你处理</div>
        <div class="rk-kpi-num">${summary.attention}</div>
        <div class="rk-kpi-sub">${summary.longestWaitText ? `最长${escapeHtml(summary.longestWaitText)}` : "全部处理完毕"}</div>
      </button>
      <button type="button" class="rk-kpi" data-filter-group="running">
        <div class="rk-kpi-label">进行中</div>
        <div class="rk-kpi-num">${summary.running}</div>
        <div class="rk-kpi-sub">AI 正在推进</div>
      </button>
      <button type="button" class="rk-kpi" data-filter-group="verify">
        <div class="rk-kpi-label">待测试验证</div>
        <div class="rk-kpi-num">${summary.verify}</div>
        <div class="rk-kpi-sub">研发已完成</div>
      </button>
      <button type="button" class="rk-kpi" data-filter-group="done">
        <div class="rk-kpi-label">最近完成（14天）</div>
        <div class="rk-kpi-num">${summary.done}</div>
        <div class="rk-kpi-sub">共 ${summary.total} 个需求</div>
      </button>
    </section>

    <div class="rk-toolbar">
      <input type="search" id="rk-search" class="rk-search" placeholder="搜索需求标题、项目、分支、卡片号…（按 / 聚焦）" />
      ${
        projects.length > 1
          ? `<div class="rk-chips"><button type="button" class="rk-chip active" data-filter-project="">全部项目</button>${projects
              .map((p) => `<button type="button" class="rk-chip" data-filter-project="${escapeHtml(p)}">${escapeHtml(p)}</button>`)
              .join("")}</div>`
          : ""
      }
    </div>

    ${items.length === 0 ? `<div class="rk-empty">还没有记录任何需求。在对话中用 <code>/laoshi</code> 开始一个需求。</div>` : `${inboxHtml}\n${groupsHtml}`}
  </main>

  <section id="rk-detail-view" class="rk-detail-shell rk-hidden" aria-label="需求详情"></section>
  <section id="rk-stats-view" class="rk-detail-shell rk-hidden" aria-label="使用统计"></section>
  <section id="rk-config-view" class="rk-detail-shell rk-hidden" aria-label="配置"></section>
</div>

<div class="rk-modal-backdrop rk-hidden" id="rk-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="rk-modal-title">
  <div class="rk-modal" id="rk-modal-dialog">
    <div class="rk-modal-head">
      <h2 class="rk-modal-title" id="rk-modal-title"></h2>
      <button type="button" class="rk-btn" id="rk-modal-close">关闭</button>
    </div>
    <div class="rk-modal-body" id="rk-modal-body"></div>
  </div>
</div>
<div class="rk-toast" id="rk-toast" role="status" aria-live="polite"></div>
<script>
const ITEMS = ${payload};
const CFG = ${runtimeCfg};
const byKey = new Map(ITEMS.map((i) => [i.key, i]));
const STOP_STATE_LABEL = { done: "已完成", now: "进行中", needs: "等你处理", todo: "待开始" };
const TICK = String.fromCharCode(96);
const FENCE_RE = new RegExp(TICK + TICK + TICK + "([\\\\w-]*)\\\\n([\\\\s\\\\S]*?)" + TICK + TICK + TICK, "g");
const INLINE_CODE_RE = new RegExp(TICK + "([^" + TICK + "]+)" + TICK, "g");

let activeGroup = "all";
let activeProject = "";
let currentSection = "overview";
let activeDetailKey = null;

const searchEl = document.getElementById("rk-search");
const overviewView = document.getElementById("rk-overview-view");
const detailView = document.getElementById("rk-detail-view");
const statsView = document.getElementById("rk-stats-view");
const configViewEl = document.getElementById("rk-config-view");
const modalBackdrop = document.getElementById("rk-modal-backdrop");
const modalDialog = document.getElementById("rk-modal-dialog");
const modalTitle = document.getElementById("rk-modal-title");
const modalBody = document.getElementById("rk-modal-body");
const toastEl = document.getElementById("rk-toast");
let toastTimer = null;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtMinutes(m) {
  const n = Math.max(0, Math.round(Number(m) || 0));
  if (n < 60) return n + " 分钟";
  const hrs = Math.floor(n / 60);
  const rem = n % 60;
  return rem ? hrs + " 小时 " + rem + " 分" : hrs + " 小时";
}

function fmtTokens(n) {
  if (n === null || n === undefined) return "-";
  const num = Number(n);
  if (num >= 10000) return (Math.round(num / 1000) / 10) + " 万";
  return String(Math.round(num));
}

function fmtStepDuration(m) {
  const num = Number(m) || 0;
  if (num < 1) return Math.max(1, Math.round(num * 60)) + " 秒";
  if (num < 60) return Math.round(num * 10) / 10 + " 分钟";
  const hrs = Math.floor(num / 60);
  const mins = Math.round(num % 60);
  return hrs + " 小时" + (mins ? " " + mins + " 分" : "");
}

function fmtStartedAgo(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "刚刚开始";
  if (mins < 60) return mins + " 分钟前开始";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + " 小时前开始";
  return Math.floor(hrs / 24) + " 天前开始";
}

function showToast(msg, kind) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.className = "rk-toast show " + (kind || "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 4200);
}

function isModalOpen() {
  return modalBackdrop && !modalBackdrop.classList.contains("rk-hidden");
}

function openModal(titleText, buildBody, small) {
  if (!modalBackdrop || !modalDialog || !modalTitle || !modalBody) return;
  modalTitle.textContent = titleText || "";
  modalDialog.className = small ? "rk-modal rk-modal-sm" : "rk-modal";
  modalBody.innerHTML = "";
  buildBody(modalBody);
  modalBackdrop.classList.remove("rk-hidden");
}

function closeModal() {
  if (!modalBackdrop || !modalBody) return;
  modalBackdrop.classList.add("rk-hidden");
  modalBody.innerHTML = "";
}

document.getElementById("rk-modal-close")?.addEventListener("click", closeModal);
modalBackdrop?.addEventListener("click", (e) => {
  if (e.target === modalBackdrop) closeModal();
});

function setSection(section) {
  currentSection = section;
  const tabKey = section === "detail" ? "overview" : section;
  document.querySelectorAll("[data-nav]").forEach((btn) => {
    const active = btn.dataset.nav === tabKey;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  overviewView?.classList.toggle("rk-hidden", section !== "overview");
  detailView?.classList.toggle("rk-hidden", section !== "detail");
  statsView?.classList.toggle("rk-hidden", section !== "stats");
  configViewEl?.classList.toggle("rk-hidden", section !== "config");
}

function closeDrawer() {
  if (isModalOpen()) closeModal();
  activeDetailKey = null;
  if (detailView) detailView.innerHTML = "";
  if (currentSection === "detail") setSection("overview");
}

document.getElementById("rk-refresh")?.addEventListener("click", () => {
  if (currentSection === "detail" && activeDetailKey) openDrawer(activeDetailKey);
  else if (currentSection === "stats") loadStatsView(statsPeriodState);
  else if (currentSection === "config") loadConfigView(configRepoState);
  else window.location.reload();
});

document.getElementById("rk-theme-toggle")?.addEventListener("click", () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
});

function resolveTargetKey(target) {
  if (typeof target?.key === "string" && target.key && byKey.has(target.key)) return target.key;
  const repo = typeof target?.repo === "string" ? target.repo : "";
  const feature = typeof target?.featureDir === "string" ? target.featureDir : (typeof target?.feature === "string" ? target.feature : "");
  if (repo && feature) {
    const match = ITEMS.find((i) => (i.repo === repo || i.workRepo === repo) && i.featureDir === feature);
    if (match) return match.key;
    return repo + "::" + feature;
  }
  return typeof target?.key === "string" ? target.key : "";
}

function openRequirementOrReload(target) {
  const key = resolveTargetKey(target);
  if (!key) return;
  if (byKey.has(key)) { openDrawer(key); return; }
  const u = new URL(window.location.href);
  u.searchParams.set("open", key);
  if (target?.repo) u.searchParams.set("repo", target.repo);
  if (target?.featureDir || target?.feature) u.searchParams.set("feature", target.featureDir || target.feature);
  window.location.replace(u.toString());
}

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "laoshi:theme" && (msg.theme === "light" || msg.theme === "dark")) {
    document.documentElement.dataset.theme = msg.theme;
  }
  if (msg.type === "laoshi:open-requirement") {
    openRequirementOrReload(msg);
  }
});

function openHostSession(sessionId, parentSessionId, label) {
  if (!CFG.embedHost || !sessionId || window.parent === window) return;
  window.parent.postMessage({
    type: "laoshi:open-session",
    sessionId,
    parentSessionId: parentSessionId || null,
    label: label || null,
  }, window.location.origin);
}

// ---------- Safe Markdown & TSV rendering ----------
function formatInlineMd(escapedText) {
  const codes = [];
  let text = escapedText.replace(INLINE_CODE_RE, (_, code) => {
    const idx = codes.length;
    codes.push("<code>" + code + "</code>");
    return "\\u0000IC" + idx + "\\u0000";
  });
  text = text.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, (_, label, url) => {
    const clean = url.replace(/&amp;/g, "&").trim();
    if (/^(https?:\\/\\/|\\/|#)/i.test(clean)) {
      return '<a href="' + escHtml(clean) + '" target="_blank" rel="noopener noreferrer">' + label + "</a>";
    }
    return label + " (" + url + ")";
  });
  text = text.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\\*([^*\\n]+)\\*(?!\\*)/g, "$1<em>$2</em>");
  return text.replace(/\\u0000IC(\\d+)\\u0000/g, (_, idx) => codes[Number(idx)] || "");
}

function splitTableRow(line) {
  return line.trim().replace(/^\\|/, "").replace(/\\|$/, "").split("|").map((c) => c.trim());
}

function isTableSep(line) {
  const trimmed = line.trim();
  if (!trimmed.includes("-")) return false;
  return /^\\|?(\\s*:?-{3,}:?\\s*\\|)+(\\s*:?-{3,}:?\\s*)?\\|?$/.test(trimmed);
}

function renderMarkdownHtml(raw) {
  const normalized = String(raw || "").replace(/\\r\\n/g, "\\n");
  const blocks = [];
  const withPlaceholders = normalized.replace(FENCE_RE, (_, _lang, body) => {
    const idx = blocks.length;
    blocks.push("<pre><code>" + escHtml(body.replace(/\\n$/, "")) + "</code></pre>");
    return "\\n\\u0000BLK" + idx + "\\u0000\\n";
  });
  const lines = withPlaceholders.split("\\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) { i++; continue; }
    const blk = /^\\u0000BLK(\\d+)\\u0000$/.exec(trimmed);
    if (blk) { out.push(blocks[Number(blk[1])] || ""); i++; continue; }
    const hd = /^(#{1,4})\\s+(.+)$/.exec(trimmed);
    if (hd) {
      const level = hd[1].length;
      out.push("<h" + level + ">" + formatInlineMd(escHtml(hd[2])) + "</h" + level + ">");
      i++; continue;
    }
    if (/^(---|\\*\\*\\*|___)$/.test(trimmed)) { out.push("<hr />"); i++; continue; }
    if (trimmed.startsWith(">")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(formatInlineMd(escHtml(lines[i].trim().replace(/^>\\s?/, ""))));
        i++;
      }
      out.push("<blockquote><p>" + quoteLines.join("<br />") + "</p></blockquote>");
      continue;
    }
    if (trimmed.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const headers = splitTableRow(trimmed);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().includes("|") && lines[i].trim()) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      let html = '<div class="rk-table-wrap"><table class="rk-table"><thead><tr>';
      for (const h of headers) html += "<th>" + formatInlineMd(escHtml(h)) + "</th>";
      html += "</tr></thead><tbody>";
      for (const r of rows) {
        html += "<tr>";
        for (let c = 0; c < headers.length; c++) html += "<td>" + formatInlineMd(escHtml(r[c] || "")) + "</td>";
        html += "</tr>";
      }
      html += "</tbody></table></div>";
      out.push(html);
      continue;
    }
    if (/^[-*]\\s+/.test(trimmed)) {
      const itemsHtml = [];
      while (i < lines.length && /^\\s*[-*]\\s+/.test(lines[i])) {
        itemsHtml.push("<li>" + formatInlineMd(escHtml(lines[i].replace(/^\\s*[-*]\\s+/, ""))) + "</li>");
        i++;
      }
      out.push("<ul>" + itemsHtml.join("") + "</ul>");
      continue;
    }
    if (/^\\d+\\.\\s+/.test(trimmed)) {
      const itemsHtml = [];
      while (i < lines.length && /^\\s*\\d+\\.\\s+/.test(lines[i])) {
        itemsHtml.push("<li>" + formatInlineMd(escHtml(lines[i].replace(/^\\s*\\d+\\.\\s+/, ""))) + "</li>");
        i++;
      }
      out.push("<ol>" + itemsHtml.join("") + "</ol>");
      continue;
    }
    const para = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t || /^(#{1,4}\\s|[-*]\\s|\\d+\\.\\s|>|---|\\u0000BLK)/.test(t)) break;
      if (t.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) break;
      para.push(formatInlineMd(escHtml(lines[i])));
      i++;
    }
    out.push("<p>" + para.join("<br />") + "</p>");
  }
  return out.join("");
}

function renderTsvTableNode(content) {
  const lines = String(content || "").replace(/\\r\\n/g, "\\n").split("\\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length === 0) return el("div", "rk-meta", "（空表格）");
  const rows = lines.map((l) => l.split("\\t"));
  const wrap = el("div", "rk-table-wrap");
  const table = el("table", "rk-table");
  const thead = document.createElement("thead");
  const thr = document.createElement("tr");
  for (const h of rows[0]) thr.append(el("th", "", h));
  thead.append(thr);
  const tbody = document.createElement("tbody");
  for (let r = 1; r < rows.length; r++) {
    const tr = document.createElement("tr");
    for (let c = 0; c < rows[0].length; c++) tr.append(el("td", "", rows[r][c] || ""));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  return wrap;
}

async function openDocumentModal(item, file) {
  const label = (CFG.fileLabels && CFG.fileLabels[file]) || file;
  openModal(label + "（" + file + "）", (body) => {
    const loading = el("div", "rk-meta", "正在读取文档内容…");
    body.append(loading);
    const fq = new URLSearchParams({ repo: item.repo, feature: item.featureDir, file });
    fetch(CFG.apiBase + "/file?" + fq.toString())
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("读取文档失败"))))
      .then((doc) => {
        body.innerHTML = "";
        if (!doc || typeof doc.content !== "string") {
          body.append(el("div", "rk-meta", "无法读取文档内容。"));
          return;
        }
        if (file.endsWith(".tsv")) {
          body.append(renderTsvTableNode(doc.content));
        } else {
          const md = el("div", "rk-md");
          md.innerHTML = renderMarkdownHtml(doc.content);
          body.append(md);
        }
        if (doc.truncated) body.append(el("div", "rk-meta", "文件较大，只显示开头的 512 KB。"));
      })
      .catch((err) => {
        body.innerHTML = "";
        body.append(el("div", "rk-step-error", String(err)));
      });
  });
}

// ---------- Action & Review Helpers ----------
async function postAction(payload) {
  const res = await fetch(CFG.apiBase + "/action", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(CFG.csrfToken ? { "X-Laoshi-Token": CFG.csrfToken } : {}) },
    body: JSON.stringify(payload),
  });
  return res.json().catch(() => ({ ok: false, message: "响应解析失败" }));
}

async function runAction(actionId, key, btn) {
  const item = byKey.get(key);
  if (!item) return;
  if (!CFG.apiBase) { showToast("当前为静态预览模式，请通过 laoshi board 启动看板后执行操作。", "err"); return; }
  if (actionId === "verify") { openVerifyModal(item); return; }
  const act = (item.actions || []).find((a) => a.id === actionId) || (CFG.actionText && CFG.actionText[actionId]);
  if (act?.confirm && !window.confirm(act.confirm)) return;
  if (btn) btn.disabled = true;
  try {
    const data = await postAction({ action: actionId, repo: item.repo, featureDir: item.featureDir });
    if (data.ok) {
      showToast(data.message || "操作已提交", "ok");
      setTimeout(() => window.location.reload(), 900);
    } else {
      showToast(data.message || data.error || "操作失败", "err");
      if (btn) btn.disabled = false;
    }
  } catch (err) {
    showToast("请求失败：" + String(err), "err");
    if (btn) btn.disabled = false;
  }
}

function openVerifyModal(item) {
  openModal("开始测试验证：" + item.title, (body) => {
    body.append(el("p", "rk-todo", "选择验证环境："));
    const bar = el("div", "rk-card-actions");
    const runEnv = async (verifyEnv, btn) => {
      btn.disabled = true;
      try {
        const data = await postAction({ action: "verify", repo: item.repo, featureDir: item.featureDir, verifyEnv });
        showToast(data.message || (data.ok ? "已启动验证" : "操作失败"), data.ok ? "ok" : "err");
        closeModal();
        if (data.ok) setTimeout(() => window.location.reload(), 900);
      } finally {
        btn.disabled = false;
      }
    };
    const localBtn = el("button", "rk-btn rk-btn-primary", "在本地验证");
    localBtn.type = "button";
    localBtn.onclick = () => runEnv("local", localBtn);
    const depBtn = el("button", "rk-btn", "在已部署的测试环境验证");
    depBtn.type = "button";
    depBtn.onclick = () => runEnv("deployed", depBtn);
    const cancelBtn = el("button", "rk-btn rk-btn-ghost", "取消");
    cancelBtn.type = "button";
    cancelBtn.onclick = closeModal;
    bar.append(localBtn, depBtn, cancelBtn);
    body.append(bar);
  }, true);
}

function openChangeModal(item) {
  openModal("发起改需求：" + item.title, (body) => {
    body.append(el("p", "rk-todo", CFG.actionText?.change?.confirm || "把需求变更发给需求的对话，由它更新需求说明并继续。"));
    const ta = el("textarea", "rk-textarea");
    ta.placeholder = "描述要调整的功能、字段或验收标准…";
    const bar = el("div", "rk-card-actions");
    const submitBtn = el("button", "rk-btn rk-btn-primary", "确认发起");
    submitBtn.type = "button";
    submitBtn.onclick = async () => {
      const text = ta.value.trim();
      if (!text) { showToast("请先填写要修改的需求内容", "err"); return; }
      submitBtn.disabled = true;
      try {
        const data = await postAction({ action: "change", repo: item.repo, featureDir: item.featureDir, text });
        showToast(data.message || (data.ok ? "已发送改需求通知" : "发送失败"), data.ok ? "ok" : "err");
        if (data.ok) { closeModal(); setTimeout(() => window.location.reload(), 900); }
      } finally {
        submitBtn.disabled = false;
      }
    };
    const cancelBtn = el("button", "rk-btn rk-btn-ghost", "取消");
    cancelBtn.type = "button";
    cancelBtn.onclick = closeModal;
    bar.append(submitBtn, cancelBtn);
    body.append(ta, bar);
  }, true);
}

function openHandoverModal(item) {
  openModal("转交需求：" + item.title, (body) => {
    body.append(el("p", "rk-todo", CFG.actionText?.handover?.confirm || "把当前需求的负责权转交给另一位同事。"));
    const toInput = el("input", "rk-note-input");
    toInput.type = "text";
    toInput.placeholder = "接手人姓名或账号";
    const noteInput = el("input", "rk-note-input");
    noteInput.type = "text";
    noteInput.placeholder = "交接说明（可选，例如：请跟进验证环节）";
    const bar = el("div", "rk-card-actions");
    const submitBtn = el("button", "rk-btn rk-btn-primary", "确认转交");
    submitBtn.type = "button";
    submitBtn.onclick = async () => {
      const to = toInput.value.trim();
      if (!to) { showToast("请填写接手人", "err"); return; }
      submitBtn.disabled = true;
      try {
        const data = await postAction({ action: "handover", repo: item.repo, featureDir: item.featureDir, to, note: noteInput.value.trim() });
        showToast(data.message || (data.ok ? "已转交" : "转交失败"), data.ok ? "ok" : "err");
        if (data.ok) { closeModal(); setTimeout(() => window.location.reload(), 900); }
      } finally {
        submitBtn.disabled = false;
      }
    };
    const cancelBtn = el("button", "rk-btn rk-btn-ghost", "取消");
    cancelBtn.type = "button";
    cancelBtn.onclick = closeModal;
    bar.append(submitBtn, cancelBtn);
    body.append(toInput, noteInput, bar);
  }, true);
}

async function openExternalReviewPage(item, page, btn) {
  if (!CFG.apiBase) return;
  if (btn) btn.disabled = true;
  try {
    const qs = new URLSearchParams({ repo: item.repo, feature: item.featureDir, page });
    const res = await fetch(CFG.apiBase + "/review-url?" + qs.toString());
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.url) {
      window.open(data.url, "_blank", "noopener,noreferrer");
    } else {
      showToast(data?.error || "当前未开启审查页面", "err");
    }
  } catch (err) {
    showToast("打开审查页面失败：" + String(err), "err");
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---------- Full-width Requirement Detail View (Paseo parity) ----------
function computeDetailActions(d, item) {
  if (CFG.readOnly) return [];
  const running = Boolean(d?.running ?? item.running);
  const attention = d?.attention ?? item.attention;
  const status = d?.status ?? item.status;
  const acts = running ? ["stop"]
    : attention === "approval" ? ["approve"]
    : attention === "interrupted" || attention === "business" ? ["resume"]
    : attention === "not_started" ? ["start"]
    : status === "phase_done" ? ["verify"]
    : [];
  const external = Array.isArray(d?.external) ? d.external : [];
  if (!running && status && external.some((e) => e.pending > 0 || !e.id)) acts.push("sync");
  if (acts.length === 0 && (item.actions || []).length > 0 && !d) return item.actions.map((a) => a.id);
  return acts;
}

function renderMetadataCards(grid, item, detail) {
  // 1. 位置 Card
  const locCard = el("div", "rk-card");
  locCard.append(el("h3", "rk-card-heading", "位置"));
  const repoPath = (detail?.repo || item.workRepo || item.repo) + "/" + item.featureDir;
  locCard.append(el("div", "rk-mono", repoPath));
  const branchVal = detail?.branch || item.branch;
  if (branchVal) locCard.append(el("div", "rk-meta", "分支 " + branchVal));
  const joints = Array.isArray(detail?.joint) ? detail.joint : [];
  for (const j of joints) {
    const jLine = el("div", "rk-meta", "联合开发「" + j.name + "」：" + j.repo + (j.branch ? "（分支 " + j.branch + "）" : ""));
    locCard.append(jLine);
  }
  grid.append(locCard);

  // 2. 用时与用量 Card
  if (detail?.usage) {
    const u = detail.usage;
    const uCard = el("div", "rk-card");
    uCard.append(el("h3", "rk-card-heading", "用时与用量"));
    uCard.append(el("div", "rk-todo", (u.steps ?? 0) + " 个步骤，agent 合计 " + fmtMinutes(u.agentMinutes)));
    const tokText = "输入 " + fmtTokens(u.inputTokens) + " tokens，输出 " + fmtTokens(u.outputTokens) + " tokens" + (u.costUsd !== null && u.costUsd !== undefined ? "，约 $" + Number(u.costUsd).toFixed(2) : "");
    uCard.append(el("div", "rk-meta", tokText));
    grid.append(uCard);
  }

  // 3. 质量门 Card
  const gateRuns = [
    ...((detail?.gate && Array.isArray(detail.gate.runs)) ? detail.gate.runs : []),
    ...joints.flatMap((j) => (j.gate && Array.isArray(j.gate.runs) ? j.gate.runs : [])),
  ];
  if (gateRuns.length > 0) {
    const last = gateRuns[gateRuns.length - 1];
    const failed = gateRuns.filter((r) => !r.passed).length;
    const gCard = el("div", "rk-card");
    gCard.append(el("h3", "rk-card-heading", "质量门"));
    gCard.append(el("div", "rk-todo", "运行 " + gateRuns.length + " 次" + (failed > 0 ? "，其中 " + failed + " 次发现改动带来的新失败" : "，都没有新失败")));
    gCard.append(el("div", "rk-meta", "最近一次（" + last.key + "）：" + (last.passed ? "通过" : "新失败：" + (last.newFailures || []).join("、"))));
    grid.append(gCard);
  }

  // 4. 外部系统 Card
  const extList = Array.isArray(detail?.external) ? detail.external : [];
  if (extList.length > 0) {
    const eCard = el("div", "rk-card");
    eCard.append(el("h3", "rk-card-heading", "外部系统"));
    for (const ext of extList) {
      const box = el("div");
      box.style.display = "flex";
      box.style.flexDirection = "column";
      box.style.gap = "4px";
      const top = el("div", "rk-mark-row");
      top.append(el("span", "rk-todo", ext.name + "：" + (ext.id || "还没有建卡")));
      if (ext.status) top.append(el("span", "rk-badge rk-tone-muted", ext.status));
      box.append(top);
      if (ext.url) {
        const a = el("a", "rk-service-link", "打开卡片 ↗");
        a.href = ext.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        box.append(a);
      }
      if (ext.pending > 0) {
        box.append(el("div", "rk-step-error", "有 " + ext.pending + " 次调用没有成功：" + (ext.lastError || "")));
      }
      eCard.append(box);
    }
    grid.append(eCard);
  }
}

function renderStepsCard(container, detail, originAgentId) {
  const allSteps = Array.isArray(detail?.steps) ? detail.steps : [];
  if (allSteps.length === 0) return;
  const card = el("div", "rk-card");
  const head = el("div", "rk-card-head");
  const title = el("h3", "rk-card-heading", "步骤（" + allSteps.length + "）");
  const toggleBtn = el("button", "rk-btn rk-btn-ghost rk-hidden");
  toggleBtn.type = "button";
  head.append(title, toggleBtn);
  const list = el("div", "rk-step-list");
  card.append(head, list);

  let showAll = false;
  const STEP_OUTCOME = { running: "运行中", completed: "完成", failed: "失败" };
  const draw = () => {
    list.innerHTML = "";
    const slice = showAll ? allSteps : allSteps.slice(-12);
    if (allSteps.length > 12) {
      toggleBtn.classList.remove("rk-hidden");
      toggleBtn.textContent = showAll ? "只看最近的" : "显示全部";
    }
    for (const st of slice) {
      const canJump = Boolean(CFG.embedHost && st.agentId);
      const row = document.createElement(canJump ? "button" : "div");
      if (canJump) {
        row.type = "button";
        row.className = "rk-step-item rk-step-link";
        row.onclick = () => openHostSession(st.agentId, originAgentId, st.title);
      } else {
        row.className = "rk-step-item";
      }
      const top = el("div", "rk-step-top");
      top.append(el("span", "rk-step-title", st.title || st.stepId || "步骤"));
      const tone = st.outcome === "failed" ? "danger" : st.outcome === "running" ? "data" : "muted";
      const badge = el("span", "rk-badge rk-tone-" + tone, st.outcome === "completed" && st.result ? st.result : (STEP_OUTCOME[st.outcome] || st.outcome || "完成"));
      top.append(badge);

      const metaRow = el("div", "rk-step-meta");
      const agoText = fmtStartedAgo(st.startedAt);
      metaRow.append(el("span", "", "第 " + (st.attempt || 1) + " 次尝试 · " + fmtStepDuration(st.minutes) + (agoText ? " · " + agoText : "")));
      if (canJump) metaRow.append(el("span", "rk-step-jump", "查看执行记录 ↗"));
      row.append(top, metaRow);
      if (st.error) row.append(el("div", "rk-step-error", st.error));
      list.append(row);
    }
  };
  toggleBtn.onclick = () => { showAll = !showAll; draw(); };
  draw();
  container.append(card);
}

function openDrawer(key) {
  const item = byKey.get(key);
  if (!item || !detailView) return;
  activeDetailKey = key;
  setSection("detail");
  detailView.innerHTML = "";

  // Top Back Navigation Bar
  const navBar = el("div", "rk-detail-nav");
  const navLeft = el("div", "rk-detail-nav-left");
  const backBtn = el("button", "rk-btn", "← 返回需求列表");
  backBtn.type = "button";
  backBtn.onclick = closeDrawer;
  navLeft.append(backBtn);
  const metaHint = el("span", "rk-meta", item.project + " / " + item.featureDir);
  navLeft.append(metaHint);
  const navRight = el("div", "rk-card-actions");
  navRight.style.marginTop = "0";
  navRight.style.paddingTop = "0";
  if (item.branch) navRight.append(el("span", "rk-stage rk-mono", item.branch));
  if (CFG.apiBase) {
    const refBtn = el("button", "rk-btn rk-btn-ghost", "刷新详情");
    refBtn.type = "button";
    refBtn.onclick = () => openDrawer(key);
    navRight.append(refBtn);
  }
  navBar.append(navLeft, navRight);
  detailView.append(navBar);

  // Header Card (Hero)
  const heroCard = el("div", "rk-card");
  const eyebrowRow = el("div", "rk-card-head");
  eyebrowRow.append(el("span", "rk-eyebrow rk-eyebrow-needs", "REQUIREMENT"));
  if (item.branch) eyebrowRow.append(el("span", "rk-mono", item.branch));
  const titleRow = el("div", "rk-detail-title-row");
  titleRow.append(el("h1", "rk-detail-title", item.title));
  const statusBadgeHost = el("span");
  statusBadgeHost.style.display = "inline-flex";
  titleRow.append(statusBadgeHost);

  const paintStatusBadge = (d) => {
    statusBadgeHost.innerHTML = "";
    const att = d?.attention ?? item.attention;
    const isRun = Boolean(d?.running ?? item.running);
    if (att) {
      const tone = att === "interrupted" ? "danger" : att === "not_completed" ? "warning" : "needs";
      statusBadgeHost.append(el("span", "rk-badge rk-tone-" + tone, (CFG.attentionLabels && CFG.attentionLabels[att]) || att));
    } else if (isRun) {
      statusBadgeHost.append(el("span", "rk-badge rk-tone-data", "进行中"));
    }
  };
  paintStatusBadge(null);

  // 6-stop StepTrack
  const trackList = el("ol", "rk-track");
  for (const s of item.stops || []) {
    const li = el("li", "rk-stop rk-stop-" + s.state);
    li.title = s.label + "（" + s.who + "）";
    const dot = el("span", "rk-dot");
    const lbl = el("span", "rk-stop-label", s.label);
    li.append(dot, lbl);
    trackList.append(li);
  }

  const factsEl = el("div", "rk-meta");
  const whoText = item.owner ? " · 负责人：" + item.owner : item.startedBy ? " · 发起人：" + item.startedBy : "";
  factsEl.textContent = item.facts + whoText + " · " + item.updated;

  const stageEl = el("p", "rk-detail-stage" + (item.attention ? " rk-detail-stage-needs" : ""), item.stage);
  const estimateEl = el("div", "rk-meta rk-hidden");
  const stopReasonEl = el("div", "rk-step-error rk-hidden");
  const businessHintEl = el("div", "rk-meta rk-hidden", "需求方的决定请在发起需求的对话中回答，回答后再继续。");
  if (item.attention === "business") businessHintEl.classList.remove("rk-hidden");
  const actionBar = el("div", "rk-card-actions");

  heroCard.append(eyebrowRow, titleRow, trackList, factsEl, stageEl, estimateEl, stopReasonEl, businessHintEl, actionBar);
  detailView.append(heroCard);

  // Sub-tabs (详情概览 / 验收工作台 / 变更与接手)
  const subTabs = el("div", "rk-tabs");
  const tabOverview = el("button", "rk-tab active", "详情概览");
  tabOverview.type = "button";
  const tabAccept = el("button", "rk-tab" + (CFG.apiBase ? "" : " rk-hidden"), "验收工作台");
  tabAccept.type = "button";
  const tabHistory = el("button", "rk-tab" + (CFG.apiBase ? "" : " rk-hidden"), "变更与接手");
  tabHistory.type = "button";
  subTabs.append(tabOverview, tabAccept, tabHistory);

  const overviewPane = el("div", "rk-detail-section-row");
  const acceptPane = el("div", "rk-card rk-hidden", "正在加载验收清单与试用信息…");
  const historyPane = el("div", "rk-card rk-hidden", "正在加载变更历史与负责人信息…");

  let acceptLoaded = false;
  let historyLoaded = false;
  const selectSubTab = (which) => {
    tabOverview.classList.toggle("active", which === "overview");
    tabAccept.classList.toggle("active", which === "accept");
    tabHistory.classList.toggle("active", which === "history");
    overviewPane.classList.toggle("rk-hidden", which !== "overview");
    acceptPane.classList.toggle("rk-hidden", which !== "accept");
    historyPane.classList.toggle("rk-hidden", which !== "history");
    if (which === "accept" && !acceptLoaded && CFG.apiBase) {
      acceptLoaded = true;
      loadAcceptanceWorkbench(item, acceptPane);
    }
    if (which === "history" && !historyLoaded && CFG.apiBase) {
      historyLoaded = true;
      loadHistoryPane(item, historyPane);
    }
  };
  tabOverview.onclick = () => selectSubTab("overview");
  tabAccept.onclick = () => selectSubTab("accept");
  tabHistory.onclick = () => selectSubTab("history");

  const metaGrid = el("div", "rk-detail-grid");
  const docsCard = el("div", "rk-card rk-hidden");
  const stepsHost = el("div", "rk-detail-section-row");
  renderMetadataCards(metaGrid, item, null);
  overviewPane.append(metaGrid, docsCard, stepsHost);

  detailView.append(subTabs, overviewPane, acceptPane, historyPane);

  const renderHeroActions = (d) => {
    actionBar.innerHTML = "";
    const files = Array.isArray(d?.files) ? d.files : [];
    const running = Boolean(d?.running ?? item.running);
    const attention = d?.attention ?? item.attention;
    const status = d?.status ?? item.status;
    const hasProto = Boolean(d?.hasPrototype ?? item.hasPrototype);
    const stageStr = String(d?.stage ?? item.stage ?? "");
    const hr = d?.humanReview ?? null;
    const canAccept = files.includes("report.md") && !running;
    const canReviewCode = (files.includes("code-review.md") || files.includes("implementation.md")) && !running;
    const waitingAcc = stageStr.startsWith("待验收") || stageStr === "验收未通过";
    const codeNeedsRev = canReviewCode && (!hr || hr.stale) && (status === "completed" || status === "phase_done");
    const acts = computeDetailActions(d, item);
    const primary = attention === "approval" && hasProto ? "review"
      : codeNeedsRev ? "code"
      : canAccept && waitingAcc ? "check"
      : (acts.find((a) => a !== "stop" && !(a === "approve" && hasProto)) || null);

    if (CFG.apiBase && canReviewCode) {
      const lbl = !hr ? "代码审查" : hr.status === "approved" ? (hr.stale ? "代码审查（有新改动，需重新评审）" : "代码审查（已通过）") : "代码审查（已退回修改）";
      const b = el("button", "rk-btn" + (primary === "code" ? " rk-btn-primary" : ""), lbl + " ↗");
      b.type = "button";
      b.onclick = () => openExternalReviewPage(item, "code", b);
      actionBar.append(b);
    }
    if (CFG.apiBase && canAccept) {
      const b = el("button", "rk-btn" + (primary === "check" ? " rk-btn-primary" : ""), "验收清单（可一键试用）");
      b.type = "button";
      b.onclick = () => selectSubTab("accept");
      actionBar.append(b);
    }
    if (CFG.apiBase && canAccept && !CFG.readOnly) {
      const tBtn = el("button", "rk-btn", "一键试用");
      tBtn.type = "button";
      tBtn.onclick = () => selectSubTab("accept");
      actionBar.append(tBtn);
    }
    if (CFG.apiBase && hasProto) {
      const pBtn = el("button", "rk-btn" + (primary === "review" ? " rk-btn-primary" : ""), attention === "approval" ? "审查原型并确认方案 ↗" : "审查原型 ↗");
      pBtn.type = "button";
      pBtn.onclick = () => openExternalReviewPage(item, "prototype", pBtn);
      actionBar.append(pBtn);
    }
    for (const a of acts) {
      const label = (CFG.actionText && CFG.actionText[a] && CFG.actionText[a].label) || a;
      const cls = a === "stop" ? "rk-btn rk-btn-danger" : primary === a ? "rk-btn rk-btn-primary" : "rk-btn";
      const b = el("button", cls, label);
      b.type = "button";
      b.onclick = () => runAction(a, item.key, b);
      actionBar.append(b);
    }
    if (CFG.apiBase && !CFG.readOnly) {
      const chBtn = el("button", "rk-btn", "改需求");
      chBtn.type = "button";
      chBtn.onclick = () => openChangeModal(item);
      const hoBtn = el("button", "rk-btn", "转交");
      hoBtn.type = "button";
      hoBtn.onclick = () => openHandoverModal(item);
      actionBar.append(chBtn, hoBtn);
    }
    const originId = d?.run?.originAgentId || null;
    if (CFG.embedHost && originId) {
      const oBtn = el("button", "rk-btn", "打开需求对话 ↗");
      oBtn.type = "button";
      oBtn.onclick = () => openHostSession(originId, null, item.title);
      actionBar.append(oBtn);
    }
  };
  renderHeroActions(null);

  if (CFG.apiBase) {
    const qs = new URLSearchParams({ repo: item.repo, feature: item.featureDir });
    fetch(CFG.apiBase + "/detail?" + qs.toString())
      .then((r) => (r.ok ? r.json() : null))
      .then((detail) => {
        if (!detail || activeDetailKey !== key) return;
        paintStatusBadge(detail);
        if (detail.stage) {
          stageEl.textContent = detail.stage;
          stageEl.className = "rk-detail-stage" + (detail.attention ? " rk-detail-stage-needs" : "");
        }
        const ownerSuffix = detail.owner ? " · 负责人：" + detail.owner : item.owner ? " · 负责人：" + item.owner : item.startedBy ? " · 发起人：" + item.startedBy : "";
        factsEl.textContent = item.facts + ownerSuffix + " · " + item.updated;

        const est = detail.estimate;
        if (est && detail.attention !== "approval") {
          estimateEl.classList.remove("rk-hidden");
          const lead = est.over
            ? "已超过同档位需求通常的用时（已用 " + fmtMinutes(est.usedAgentMinutes) + "，通常 " + fmtMinutes(est.typicalAgentMinutes) + "）"
            : "预计还要约 " + fmtMinutes(Math.max(5, est.leftMinutes));
          const tokPart = est.usedTokens !== null && est.usedTokens !== undefined
            ? " · 已用 " + fmtTokens(est.usedTokens) + " tokens" + (est.typicalTokens !== null && est.typicalTokens !== undefined ? "（通常 " + fmtTokens(est.typicalTokens) + "）" : "")
            : "";
          estimateEl.textContent = lead + tokPart + " · 按本机最近 " + est.basis + " 个同档位需求，不含等人的时间";
        }
        if (detail.run?.stopReason && !detail.running) {
          stopReasonEl.textContent = detail.run.stopReason;
          stopReasonEl.classList.remove("rk-hidden");
        }
        if (detail.attention === "business") businessHintEl.classList.remove("rk-hidden");

        renderHeroActions(detail);
        metaGrid.innerHTML = "";
        renderMetadataCards(metaGrid, item, detail);

        const files = Array.isArray(detail.files) ? detail.files : [];
        if (files.length > 0) {
          docsCard.classList.remove("rk-hidden");
          docsCard.innerHTML = "";
          docsCard.append(el("h3", "rk-card-heading", "文档（" + files.length + "）"));
          const chipWrap = el("div", "rk-chips");
          for (const f of files) {
            const label = (CFG.fileLabels && CFG.fileLabels[f]) || f;
            const c = el("button", "rk-chip", label === f ? f : label + " · " + f);
            c.type = "button";
            c.onclick = () => openDocumentModal(item, f);
            chipWrap.append(c);
          }
          docsCard.append(chipWrap);
        }

        stepsHost.innerHTML = "";
        renderStepsCard(stepsHost, detail, detail.run?.originAgentId || null);
      })
      .catch(() => {
        showToast("加载需求详情失败", "err");
      });
  }
  window.scrollTo({ top: 0, behavior: "auto" });
}

// ---------- Acceptance Workbench ----------
function loadAcceptanceWorkbench(item, pane) {
  const PIPE_LABEL = { pass: "流水线：通过", fail: "流水线：未通过", unverified: "流水线：未验证", unknown: "待人工核对" };
  const qs = new URLSearchParams({ repo: item.repo, feature: item.featureDir });
  fetch(CFG.apiBase + "/acceptance?" + qs.toString())
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("无法加载验收信息"))))
    .then((data) => {
      pane.innerHTML = "";
      pane.style.gap = "16px";
      const list = data.checklist || { items: [], notes: [] };

      const tryTitle = el("h3", "rk-card-heading", "一键试用与测试准备");
      const tryBar = el("div", "rk-mark-row");
      const tryResult = el("div", "rk-meta");
      if (!CFG.readOnly) {
        const startTry = el("button", "rk-btn rk-btn-primary", "一键启动试用");
        startTry.type = "button";
        const stopTry = el("button", "rk-btn", "停止试用");
        stopTry.type = "button";
        const callTry = async (stop) => {
          startTry.disabled = true;
          stopTry.disabled = true;
          tryResult.textContent = stop ? "正在停止试用服务…" : "正在启动试用服务…";
          try {
            const resp = await fetch(CFG.apiBase + "/try", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(CFG.csrfToken ? { "X-Laoshi-Token": CFG.csrfToken } : {}) },
              body: JSON.stringify({ repo: item.repo, featureDir: item.featureDir, stop }),
            });
            const body = await resp.json().catch(() => ({ ok: false, message: "响应解析失败" }));
            tryResult.innerHTML = "";
            tryResult.append(el("div", "", body.message || (body.ok ? "完成" : "失败")));
            for (const svc of body.services || []) {
              if (svc.url) {
                const a = el("a", "rk-service-link", svc.name + "：" + svc.url + " ↗");
                a.href = svc.url;
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                tryResult.append(document.createElement("br"), a);
              }
            }
            showToast(body.ok ? (stop ? "已停止试用服务" : "试用服务已启动") : (body.message || "试用操作未完成"), body.ok ? "ok" : "err");
          } catch (err) {
            tryResult.textContent = "请求失败：" + String(err);
          } finally {
            startTry.disabled = false;
            stopTry.disabled = false;
          }
        };
        startTry.onclick = () => callTry(false);
        stopTry.onclick = () => callTry(true);
        tryBar.append(startTry, stopTry);
      }
      pane.append(tryTitle, tryBar, tryResult);
      if ((data.howTo || []).length > 0) {
        const pre = el("pre", "rk-doc-preview", data.howTo.join("\\n"));
        pre.style.maxHeight = "160px";
        pane.append(pre);
      }

      const acTitle = el("h3", "rk-card-heading", "验收清单（共 " + (list.items || []).length + " 项）");
      acTitle.style.marginTop = "6px";
      pane.append(acTitle);

      const answers = new Map();
      if ((list.items || []).length === 0) {
        pane.append(el("div", "rk-meta", "当前需求说明中没有解析到 AC 验收标准。"));
      } else {
        for (const ac of list.items) {
          const card = el("div", "rk-ac-card");
          const head = el("div", "rk-ac-head");
          head.append(el("span", "rk-ac-id", ac.id + (ac.required ? "" : "（可选）")));
          head.append(el("span", "rk-stage", PIPE_LABEL[ac.pipeline] || ac.pipeline));
          const title = el("div", "", ac.title);
          title.style.fontWeight = "600";
          card.append(head, title);
          if (ac.evidence) card.append(el("div", "rk-ac-ev", "证据：" + ac.evidence));
          if (!CFG.readOnly) {
            const marks = el("div", "rk-mark-row");
            const note = el("input", "rk-note-input");
            note.type = "text";
            note.placeholder = "备注（不通过时建议写明原因）";
            const entry = { id: ac.id, mark: "", note: "" };
            note.oninput = () => { entry.note = note.value; };
            for (const [m, label] of [["pass", "通过"], ["fail", "不通过"], ["skip", "跳过"]]) {
              const btn = el("button", "rk-mark", label);
              btn.type = "button";
              btn.onclick = () => {
                entry.mark = m;
                answers.set(ac.id, entry);
                marks.querySelectorAll(".rk-mark").forEach((x) => { x.className = "rk-mark"; });
                btn.className = "rk-mark active-" + m;
              };
              marks.append(btn);
            }
            card.append(marks, note);
          }
          pane.append(card);
        }
        if (!CFG.readOnly) {
          const submitRow = el("div", "rk-mark-row");
          submitRow.style.marginTop = "6px";
          const reviewer = el("input", "rk-note-input");
          reviewer.type = "text";
          reviewer.style.flex = "1";
          reviewer.placeholder = "验收人姓名（默认：需求方）";
          const submit = el("button", "rk-btn rk-btn-primary", "提交验收结论");
          submit.type = "button";
          submit.onclick = async () => {
            submit.disabled = true;
            try {
              const payloadAnswers = [...answers.values()].filter((a) => a.mark);
              const resp = await fetch(CFG.apiBase + "/acceptance", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(CFG.csrfToken ? { "X-Laoshi-Token": CFG.csrfToken } : {}) },
                body: JSON.stringify({ repo: item.repo, featureDir: item.featureDir, reviewer: reviewer.value, answers: payloadAnswers }),
              });
              const body = await resp.json().catch(() => ({ ok: false, message: "提交失败" }));
              showToast(body.message || (body.ok ? "验收已提交" : "提交失败"), body.ok ? "ok" : "err");
              if (body.ok) setTimeout(() => window.location.reload(), 1000);
            } finally {
              submit.disabled = false;
            }
          };
          submitRow.append(reviewer, submit);
          pane.append(submitRow);
        }
      }
    })
    .catch((err) => { pane.textContent = "加载验收工作台失败：" + String(err); });
}

// ---------- History & Handover Pane ----------
function loadHistoryPane(item, pane) {
  const qs = new URLSearchParams({ repo: item.repo, feature: item.featureDir });
  fetch(CFG.apiBase + "/history?" + qs.toString())
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("无法加载变更历史"))))
    .then((data) => {
      pane.textContent = "";
      pane.style.gap = "16px";
      const summary = el("div", "rk-info-box");
      const curOwner = data?.owner?.owner || item.owner || item.startedBy || "未指定";
      summary.append(el("div", "", "当前负责人：" + curOwner));
      summary.append(el("div", "rk-meta", "需求说明版本：" + (data?.specVersion ? "v" + data.specVersion : "未标注")));
      const trail = data?.owner?.history || [];
      if (trail.length > 0) {
        const last = trail[trail.length - 1];
        const when = last.at ? String(last.at).slice(0, 16).replace("T", " ") : "";
        summary.append(el("div", "rk-meta", "最近转交：" + (last.from || "未指定") + " → " + last.to + (when ? "（" + when + "）" : "") + (last.note ? " · " + last.note : "")));
      }
      pane.append(summary);

      const changes = data?.changes || [];
      pane.append(el("h3", "rk-card-heading", "变更记录（" + changes.length + " 项）"));
      if (changes.length === 0) {
        pane.append(el("div", "rk-meta", "暂无变更记录。"));
      } else {
        for (const ch of changes) {
          const box = el("div", "rk-change-item");
          const btn = el("button", "rk-change-head");
          btn.type = "button";
          const hint = el("span", "rk-meta", "展开");
          btn.append(el("span", "", ch.title), hint);
          const bodyPre = el("pre", "rk-change-body rk-hidden", ch.body || "（无正文）");
          btn.onclick = () => {
            const hidden = bodyPre.classList.toggle("rk-hidden");
            hint.textContent = hidden ? "展开" : "收起";
          };
          box.append(btn, bodyPre);
          pane.append(box);
        }
      }

      const commits = data?.commits || [];
      pane.append(el("h3", "rk-card-heading", "需求说明修改历史（" + commits.length + " 次提交）"));
      if (commits.length === 0) {
        pane.append(el("div", "rk-meta", "暂无 git 提交历史。"));
      } else {
        for (const cm of commits) {
          const box = el("div", "rk-change-item");
          const btn = el("button", "rk-change-head");
          btn.type = "button";
          const day = cm.date ? String(cm.date).slice(0, 16).replace("T", " ") : "";
          const hint = el("span", "rk-meta", "查看差异");
          btn.append(el("span", "", (day ? day + " · " : "") + (cm.author ? cm.author + " · " : "") + (cm.subject || cm.commit.slice(0, 7))), hint);
          const diffBox = el("div", "rk-diff rk-hidden");
          for (const line of (cm.diff || "").split(/\\r?\\n/)) {
            let cls = "rk-diff-line";
            if (line.startsWith("+") && !line.startsWith("+++")) cls += " rk-diff-add";
            else if (line.startsWith("-") && !line.startsWith("---")) cls += " rk-diff-del";
            else if (line.startsWith("@@")) cls += " rk-diff-hunk";
            diffBox.append(el("div", cls, line || " "));
          }
          if (cm.truncated) diffBox.append(el("div", "rk-meta", "差异内容较长，已截断至 20000 字符。"));
          btn.onclick = () => {
            const hidden = diffBox.classList.toggle("rk-hidden");
            hint.textContent = hidden ? "查看差异" : "收起差异";
          };
          box.append(btn, diffBox);
          pane.append(box);
        }
      }
    })
    .catch((err) => { pane.textContent = "加载变更历史失败：" + String(err); });
}

// ---------- Usage Statistics View ----------
function monthStamp(offset) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

let statsPeriodState = { since: "30d" };
async function loadStatsView(period) {
  statsPeriodState = period || { since: "30d" };
  if (!statsView) return;
  statsView.innerHTML = "";
  const header = el("div", "rk-card");
  header.append(el("h1", "rk-detail-title", "使用统计"));
  const periods = [
    { label: "最近 30 天", value: { since: "30d" } },
    { label: "本月", value: { month: monthStamp(0) } },
    { label: "上月", value: { month: monthStamp(-1) } },
  ];
  const chipRow = el("div", "rk-chips");
  for (const p of periods) {
    const isAct = (p.value.since && statsPeriodState.since === p.value.since) || (p.value.month && statsPeriodState.month === p.value.month);
    const chip = el("button", "rk-chip" + (isAct ? " active" : ""), p.label);
    chip.type = "button";
    chip.onclick = () => loadStatsView(p.value);
    chipRow.append(chip);
  }
  header.append(chipRow);
  statsView.append(header);

  if (!CFG.apiBase) {
    statsView.append(el("div", "rk-empty", "当前为静态预览模式，请通过 laoshi board 启动看板查看使用统计。"));
    return;
  }
  const loading = el("div", "rk-meta", "正在汇总使用记录…");
  statsView.append(loading);
  try {
    const qs = new URLSearchParams();
    if (statsPeriodState.since) qs.set("since", statsPeriodState.since);
    if (statsPeriodState.month) qs.set("month", statsPeriodState.month);
    const d = await fetch(CFG.apiBase + "/stats?" + qs.toString()).then((r) => (r.ok ? r.json() : Promise.reject(new Error("加载统计失败"))));
    loading.remove();
    if (!d || !d.active) {
      statsView.append(el("div", "rk-empty", "这段时间没有流水线运行记录。"));
      return;
    }
    const OUTCOME = { completed: "已完成", completed_with_issues: "有遗留问题", not_completed: "未完成", unknown: "结论未记录" };
    const kpiGrid = el("div", "rk-stats-kpi-grid");
    const addKpi = (label, value, sub) => {
      const card = el("div", "rk-kpi rk-kpi-static");
      card.append(el("div", "rk-kpi-label", label), el("div", "rk-kpi-num", value));
      if (sub) card.append(el("div", "rk-kpi-sub", sub));
      kpiGrid.append(card);
    };
    const byTypeStr = Object.entries(d.byType || {}).map(([k, v]) => ((CFG.typeLabels && CFG.typeLabels[k]) || "普通") + " " + v).join("，");
    const byOutStr = Object.entries(d.completed?.byOutcome || {}).map(([k, v]) => (OUTCOME[k] || k) + " " + v).join("，");
    addKpi("有进展的需求", String(d.active), byTypeStr);
    addKpi("完成", String(d.completed?.total ?? 0), byOutStr);
    addKpi("交付周期中位数", d.cycleHours?.median == null ? "-" : d.cycleHours.median + " 小时", "首次开始到完成");
    addKpi("平均评审轮数", d.rework?.averageReviewRounds == null ? "-" : String(d.rework.averageReviewRounds), d.rework?.withDefectRounds == null ? "" : Math.round(d.rework.withDefectRounds * 100) + "% 需要缺陷修复");
    addKpi("agent 合计用时", fmtMinutes(d.usage?.agentMinutes), "输入 " + fmtTokens(d.usage?.inputTokens) + "，输出 " + fmtTokens(d.usage?.outputTokens) + " tokens");
    if (d.usage?.costUsd !== null && d.usage?.costUsd !== undefined) addKpi("费用", "$" + Number(d.usage.costUsd).toFixed(2));
    statsView.append(kpiGrid);

    if (d.oversight && (d.oversight.reviews.total + d.oversight.acceptance.total + d.oversight.merged.requirements + d.oversight.issues.total) > 0) {
      const ov = el("div", "rk-card");
      const h = el("div", "rk-card-head");
      h.append(el("span", "rk-eyebrow", "OVERSIGHT"), el("span", "rk-meta", "人工把关和合并后"));
      ov.append(
        h,
        el("div", "rk-todo", "人工代码评审 " + d.oversight.reviews.total + " 次（" + d.oversight.reviews.requirements + " 个需求），退回修改 " + d.oversight.reviews.sentBack + " 次；第一次就通过 " + d.oversight.reviews.passedFirstTime + " 个"),
        el("div", "rk-todo", "需求方验收 " + d.oversight.acceptance.total + " 次，不通过 " + d.oversight.acceptance.failed + " 次；第一次就通过 " + d.oversight.acceptance.passedFirstTime + " 个"),
        el("div", "rk-todo", "合并进主干 " + d.oversight.merged.requirements + " 个需求" + (d.oversight.merged.medianHoursAfterCompletion == null ? "" : "，完成到合并中位数 " + d.oversight.merged.medianHoursAfterCompletion + " 小时") + "；合并后发现问题 " + d.oversight.issues.total + " 个"),
      );
      statsView.append(ov);
    }

    if (d.tokens && d.tokens.total) {
      const tk = el("div", "rk-card");
      const h = el("div", "rk-card-head");
      h.append(el("span", "rk-eyebrow", "TOKENS"), el("span", "rk-meta", "token 花在哪"));
      tk.append(h);
      const pct = (x) => Math.round((Number(x) || 0) * 100) + "%";
      tk.append(el("div", "rk-todo", "合计 " + fmtTokens(d.tokens.total) + " tokens" + (d.tokens.rework ? "，其中返工（修订、修复、复验和第 2 轮起的评审）占 " + pct(d.tokens.rework.share) : "") + (d.tokens.cachedShare != null ? "；输入中 " + pct(d.tokens.cachedShare) + " 来自提示缓存" : "")));
      if (d.tokens.perRequirement?.median != null) tk.append(el("div", "rk-meta", "每个完成的需求中位数 " + fmtTokens(d.tokens.perRequirement.median)));
      const addBar = (label, value, share, note) => {
        const row = el("div", "rk-bar-row");
        const bh = el("div", "rk-bar-head");
        bh.append(el("span", "", label), el("span", "rk-meta", fmtTokens(value) + " · " + pct(share) + note));
        const track = el("div", "rk-bar-track");
        const fill = el("div", "rk-bar-fill");
        fill.style.width = Math.max(1, Math.round((Number(share) || 0) * 100)) + "%";
        track.append(fill);
        row.append(bh, track);
        tk.append(row);
      };
      for (const r of (d.tokens.byStep || []).slice(0, 12)) addBar(r.title, r.tokens, r.share, "（" + r.steps + " 次）");
      if ((d.tokens.byAgent || []).some((a) => a.agent !== "（未记录）")) {
        const subHead = el("h4", "rk-card-heading", "按模型");
        subHead.style.marginTop = "6px";
        tk.append(subHead);
        for (const r of d.tokens.byAgent) addBar(r.agent, r.tokens, r.share, "（" + r.steps + " 步）");
      }
      statsView.append(tk);
    }

    if (Array.isArray(d.waits) && d.waits.length > 0) {
      const wc = el("div", "rk-card");
      wc.append(el("h3", "rk-card-heading", "等待"));
      for (const w of d.waits) wc.append(el("div", "rk-todo", w.label + "：" + w.requirements + " 个需求，平均 " + fmtMinutes(w.averageMinutes)));
      statsView.append(wc);
    }

    const stCard = el("div", "rk-card");
    stCard.append(el("h3", "rk-card-heading", "各步骤用时"));
    for (const st of d.steps || []) stCard.append(el("div", "rk-todo", st.title + "：" + st.count + " 次，平均 " + fmtMinutes(st.averageMinutes) + "，合计 " + fmtMinutes(st.totalMinutes)));
    stCard.append(el("div", "rk-meta", "质量门运行 " + (d.rework?.gateRuns ?? 0) + " 次，发现新失败 " + (d.rework?.gateFailed ?? 0) + " 次。机器：" + (d.machines || []).join("、")));
    statsView.append(stCard);
    statsView.append(el("div", "rk-meta", "给管理方的汇报文件：在终端运行 laoshi stats --report --month " + monthStamp(0) + "；几台机器一起汇报见 laoshi stats --export 和 --merge。"));
  } catch (err) {
    loading.className = "rk-step-error";
    loading.textContent = String(err);
  }
}

// ---------- Config View ----------
let configRepoState = null;
async function loadConfigView(repo) {
  configRepoState = repo || null;
  if (!configViewEl) return;
  configViewEl.innerHTML = "";

  const LAYER = {
    machine: { label: "本机", tone: "needs", hint: "这台机器自己的设置" },
    team: { label: "团队", tone: "warning", hint: "团队共用的配置，覆盖本机的同名设置" },
    project: { label: "项目", tone: "success", hint: "项目仓库中的设置，覆盖本机和团队的" },
  };
  const SCOPE_NOTE = { any: null, machine: "只能在本机配置中设置", machine_team: "只能在本机或团队配置中设置（会运行命令或发消息）" };

  const header = el("div", "rk-card");
  header.append(
    el("h1", "rk-detail-title", "laoshi 配置"),
    el("div", "rk-meta", "这台机器上生效的全部设置，用大白话写出每一项是什么、现在是什么、来自哪个文件。这一页只看不改。"),
  );
  const projMap = new Map();
  for (const r of ITEMS) if (r.repo && r.project) projMap.set(r.repo, r.project);
  const projList = [...projMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const projChips = el("div", "rk-chips");
  const allProjChip = el("button", "rk-chip" + (!configRepoState ? " active" : ""), "本机（不含项目）");
  allProjChip.type = "button";
  allProjChip.onclick = () => loadConfigView(null);
  projChips.append(allProjChip);
  for (const [dir, name] of projList) {
    const c = el("button", "rk-chip" + (configRepoState === dir ? " active" : ""), name);
    c.type = "button";
    c.onclick = () => loadConfigView(dir);
    projChips.append(c);
  }
  header.append(projChips);
  configViewEl.append(header);

  if (!CFG.apiBase) {
    configViewEl.append(el("div", "rk-empty", "当前为静态预览模式，请通过 laoshi board 启动看板查看完整配置。"));
    return;
  }
  const loading = el("div", "rk-meta", "正在读取配置…");
  configViewEl.append(loading);
  try {
    const qs = new URLSearchParams();
    if (configRepoState) qs.set("repo", configRepoState);
    const view = await fetch(CFG.apiBase + "/config" + (qs.toString() ? "?" + qs.toString() : "")).then((r) => (r.ok ? r.json() : Promise.reject(new Error("加载配置失败"))));
    loading.remove();

    if (view.error) {
      const errCard = el("div", "rk-card rk-card-danger");
      errCard.append(el("h3", "rk-card-heading", "配置有错误，流水线现在无法启动"), el("div", "rk-step-error", view.error), el("div", "rk-meta", "修好后在终端运行 laoshi doctor 检查。"));
      configViewEl.append(errCard);
    }

    const srcCard = el("div", "rk-card");
    srcCard.append(el("h3", "rk-card-heading", "配置从哪里来"), el("div", "rk-meta", "按下面的顺序叠加，后面的覆盖前面的；没有写的用默认值。"));
    if (!view.sources || view.sources.length === 0) {
      srcCard.append(el("div", "rk-meta", "还没有本机配置文件。在终端运行 laoshi install 生成。"));
    } else {
      view.sources.forEach((src, idx) => {
        const meta = LAYER[src.layer] || { label: src.layer, tone: "muted", hint: "" };
        const row = el("div", "rk-mark-row");
        row.append(el("span", "rk-meta", (idx + 1) + "."), el("span", "rk-badge rk-tone-" + meta.tone, meta.label), el("span", "rk-mono", src.path));
        srcCard.append(row);
      });
    }
    if (Array.isArray(view.ignored) && view.ignored.length > 0) {
      srcCard.append(el("div", "rk-step-error", "没有生效：" + view.ignored.join("、") + "（这些设置不能写在团队或项目配置中）"));
    }
    configViewEl.append(srcCard);

    const filterRow = el("div", "rk-toolbar");
    filterRow.style.marginBottom = "0";
    const cfgSearch = el("input", "rk-search");
    cfgSearch.type = "search";
    cfgSearch.placeholder = "搜索设置，例如：超时、备用模型、推送";
    let changedOnly = false;
    const changedCount = (view.groups || []).reduce((n, g) => n + (g.items || []).filter((i) => i.changed).length, 0);
    const chips = el("div", "rk-chips");
    const chipAll = el("button", "rk-chip active", "全部");
    chipAll.type = "button";
    const chipChanged = el("button", "rk-chip", "只看改过的（" + changedCount + "）");
    chipChanged.type = "button";
    chips.append(chipAll, chipChanged);
    filterRow.append(cfgSearch, chips);
    configViewEl.append(filterRow);

    const groupsHost = el("div", "rk-detail-section-row");
    configViewEl.append(groupsHost);

    const renderGroups = () => {
      groupsHost.innerHTML = "";
      const q = cfgSearch.value.trim().toLowerCase();
      let renderedAny = false;
      for (const g of view.groups || []) {
        const filtered = (g.items || []).filter((it) => (!changedOnly || it.changed) && (!q || (it.label + " " + it.key + " " + it.display + " " + (it.description || "")).toLowerCase().includes(q)));
        if (filtered.length === 0) continue;
        renderedAny = true;
        const gCard = el("div", "rk-card");
        gCard.append(el("h3", "rk-card-heading", g.title));
        if (g.description) gCard.append(el("div", "rk-meta", g.description));
        for (const it of filtered) {
          const itemBtn = el("button", "rk-cfg-item");
          itemBtn.type = "button";
          const head = el("div", "rk-card-head");
          head.style.width = "100%";
          head.append(el("span", "rk-cfg-label", it.label));
          const origin = it.changed && Array.isArray(it.setBy) && it.setBy.length > 0 ? it.setBy[it.setBy.length - 1] : null;
          const badgeMeta = origin ? (LAYER[origin] || { label: origin, tone: "muted" }) : { label: "默认", tone: "muted" };
          head.append(el("span", "rk-badge rk-tone-" + badgeMeta.tone, badgeMeta.label));
          itemBtn.append(head, el("div", "rk-todo", it.display));
          if (it.description) itemBtn.append(el("div", "rk-meta", it.description));

          const detailBox = el("div", "rk-cfg-detail rk-hidden");
          const scopeStr = SCOPE_NOTE[it.scope] ? " · " + SCOPE_NOTE[it.scope] : "";
          const setByStr = Array.isArray(it.setBy) && it.setBy.length > 0 ? " · 写在" + it.setBy.map((l) => (LAYER[l]?.label || l)).join("、") + "配置中" : " · 没有在任何配置文件中写，用的是默认值";
          detailBox.append(
            el("div", "rk-meta", "配置项 " + it.key + setByStr + scopeStr),
            el("pre", "rk-change-body", JSON.stringify(it.value, null, 2) ?? "null"),
          );
          itemBtn.onclick = () => detailBox.classList.toggle("rk-hidden");
          itemBtn.append(detailBox);
          gCard.append(itemBtn);
        }
        groupsHost.append(gCard);
      }
      if (!renderedAny) {
        groupsHost.append(el("div", "rk-empty", changedOnly && !q ? "所有设置都是默认值。" : "没有符合的设置。"));
      }
    };
    chipAll.onclick = () => { changedOnly = false; chipAll.classList.add("active"); chipChanged.classList.remove("active"); renderGroups(); };
    chipChanged.onclick = () => { changedOnly = true; chipChanged.classList.add("active"); chipAll.classList.remove("active"); renderGroups(); };
    cfgSearch.addEventListener("input", renderGroups);
    renderGroups();

    const guide = el("div", "rk-card");
    guide.append(
      el("h3", "rk-card-heading", "怎么修改"),
      el("div", "rk-meta", "· 模型（builder、reviewer、备用模型）：在终端运行 laoshi configure。"),
      el("div", "rk-meta", "· 项目的检查命令、服务启动方式、接哪些卡片：在项目的对话中运行 /laoshi-setup。"),
      el("div", "rk-meta", "· 其他设置：编辑上面“配置从哪里来”中的文件；密码与令牌不会在这里显示。"),
    );
    configViewEl.append(guide);
  } catch (err) {
    loading.className = "rk-step-error";
    loading.textContent = String(err);
  }
}

// ---------- Overview Filters & Event Wiring ----------
function applyFilter() {
  const q = (searchEl?.value || "").trim().toLowerCase();
  document.querySelectorAll("[data-key].rk-inbox-card, [data-key].rk-row").forEach((node) => {
    const okGroup = activeGroup === "all" || node.dataset.group === activeGroup;
    const okProject = !activeProject || node.dataset.project === activeProject;
    const okQuery = !q || (node.dataset.search || "").includes(q);
    node.classList.toggle("rk-hidden", !(okGroup && okProject && okQuery));
  });
}

document.querySelectorAll("[data-filter-group]").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeGroup = btn.dataset.filterGroup === activeGroup ? "all" : btn.dataset.filterGroup;
    document.querySelectorAll("[data-filter-group]").forEach((b) => b.classList.toggle("active", b.dataset.filterGroup === activeGroup));
    applyFilter();
  });
});

document.querySelectorAll("[data-filter-project]").forEach((btn) => {
  btn.addEventListener("click", () => {
    activeProject = btn.dataset.filterProject || "";
    document.querySelectorAll("[data-filter-project]").forEach((b) => b.classList.toggle("active", (b.dataset.filterProject || "") === activeProject));
    applyFilter();
  });
});

searchEl?.addEventListener("input", applyFilter);

document.querySelectorAll("[data-nav]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const which = btn.dataset.nav || "overview";
    if (which === "overview") {
      if (currentSection === "detail") closeDrawer();
      else setSection("overview");
    } else if (which === "stats") {
      setSection("stats");
      loadStatsView(statsPeriodState);
    } else if (which === "config") {
      setSection("config");
      loadConfigView(configRepoState);
    }
  });
});

document.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  const actBtn = target.closest("[data-action]");
  if (actBtn instanceof HTMLButtonElement) { runAction(actBtn.dataset.action || "", actBtn.dataset.key || "", actBtn); return; }
  const openBtn = target.closest("[data-open]");
  if (openBtn instanceof HTMLElement) { openDrawer(openBtn.dataset.open || ""); return; }
  const row = target.closest(".rk-row");
  if (row instanceof HTMLElement && !target.closest("button")) openDrawer(row.dataset.key || "");
});

document.addEventListener("keydown", (e) => {
  if (e.key === "/" && currentSection === "overview" && !isModalOpen() && document.activeElement !== searchEl) {
    e.preventDefault();
    searchEl?.focus();
  }
  if (e.key === "Escape") {
    if (isModalOpen()) closeModal();
    else if (currentSection === "detail") closeDrawer();
  }
});

const initParams = new URLSearchParams(window.location.search);
const initOpenKey = resolveTargetKey({
  key: initParams.get("open") || "",
  repo: initParams.get("repo") || "",
  featureDir: initParams.get("feature") || "",
});
if (initOpenKey && byKey.has(initOpenKey)) {
  openDrawer(initOpenKey);
  if (typeof window.history?.replaceState === "function") {
    initParams.delete("open");
    initParams.delete("repo");
    initParams.delete("feature");
    const qs = initParams.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : ""));
  }
}
</script>
</body>
</html>`;
}
