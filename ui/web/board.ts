// Shared Web board view for dsh web plugin (D1) and local requirement dashboard.
// Follows design/ Bento Launchpad tokens (--rk-*) and industry-standard Linear / GitHub Actions /
// Vercel Dashboard ergonomics: clickable Bento KPI cards, instant `/` search, Needs-You focus
// queue with urgency badges and impact notes, 6-stop release track, and slide-over detail drawer.

import {
  ACTION_TEXT,
  actionsFor,
  ago,
  buildInboxCards,
  facts,
  GROUP_EYEBROWS,
  GROUP_LABELS,
  GROUP_ORDER,
  groupOf,
  type RequirementView,
  summarizeBoard,
  trackOf,
} from "../shared/view-model.js";

export interface BoardRenderOptions {
  title?: string;
  platformName?: string;
  readOnly?: boolean;
  now?: number;
  /** Optional API base path (e.g. "/api") enabling live actions, detail fetch, and document preview. */
  apiBase?: string;
  /** CSRF token required in X-Laoshi-Token header for POST actions when apiBase is set. */
  csrfToken?: string;
}

const GROUP_SUBTITLES: Record<string, string> = {
  running: "AI 正在推进",
  verify: "研发已完成，等待测试验证",
  done: "近 14 天内完成",
  other: "较早或未启动的需求",
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
      title: i.title,
      project: i.project,
      featureDir: i.featureDir,
      branch: i.branch ?? null,
      stage: i.stage,
      status: i.status,
      startedBy: i.startedBy ?? null,
      owner: i.owner ?? null,
      facts: facts(i),
      updated: ago(i.updatedAt, now),
      waiting: i.waiting ?? null,
      stops: trackOf(i),
      actions: readOnly ? [] : actionsFor(i).map((a) => ({ id: a, ...ACTION_TEXT[a] })),
    })),
  ).replace(/</g, "\\u003c");
  const runtimeCfg = JSON.stringify({
    apiBase: options.apiBase ?? null,
    csrfToken: options.csrfToken ?? null,
    readOnly,
  }).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="zh-CN" data-theme="dark">
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
  --rk-danger: #dc2626;
  --rk-danger-tint: rgba(220, 38, 38, 0.12);
  --rk-success: #15803d;
  --rk-success-tint: rgba(21, 128, 61, 0.12);
}
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--rk-bg); color: var(--rk-fg); }
.rk-shell { max-width: 1120px; margin: 0 auto; padding: 24px 20px 64px; }
.rk-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 18px; }
.rk-brand-title { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 700; }
.rk-dot-brand { width: 10px; height: 10px; border-radius: 999px; background: var(--rk-brand); display: inline-block; }
.rk-kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 18px; }
.rk-kpi { background: var(--rk-surface-1); border: 1px solid var(--rk-border); border-radius: 14px; padding: 14px 16px; text-align: left; cursor: pointer; color: inherit; transition: border-color .15s, transform .15s; }
.rk-kpi:hover, .rk-kpi.active { border-color: var(--rk-brand); }
.rk-kpi-label { font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--rk-muted); }
.rk-kpi-num { font-size: 26px; font-weight: 700; margin-top: 6px; font-variant-numeric: tabular-nums; }
.rk-kpi-sub { font-size: 12px; color: var(--rk-muted); margin-top: 2px; }
.rk-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 20px; }
.rk-search { flex: 1; min-width: 220px; background: var(--rk-surface-1); border: 1px solid var(--rk-border); color: var(--rk-fg); border-radius: 10px; padding: 9px 12px; font-size: 13px; }
.rk-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.rk-chip { background: var(--rk-surface-1); border: 1px solid var(--rk-border); color: var(--rk-muted); border-radius: 999px; padding: 5px 12px; font-size: 12px; cursor: pointer; }
.rk-chip.active { background: var(--rk-brand-tint); border-color: var(--rk-brand); color: var(--rk-brand); font-weight: 600; }
.rk-section { margin-bottom: 24px; }
.rk-section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.rk-eyebrow { font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--rk-fg); }
.rk-eyebrow-needs { color: var(--rk-brand); }
.rk-section-sub { font-size: 12px; color: var(--rk-muted); }
.rk-inbox-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 12px; }
.rk-inbox-card { background: var(--rk-surface-1); border: 1px solid var(--rk-border); border-left: 3px solid var(--rk-brand); border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.rk-urgency-urgent { border-left-color: var(--rk-danger); }
.rk-urgency-elevated { border-left-color: var(--rk-warn); }
.rk-card-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.rk-card-title-wrap { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.rk-card-title { margin: 0; font-size: 15px; font-weight: 600; }
.rk-badge { align-self: flex-start; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 6px; }
.rk-tone-needs { background: var(--rk-brand-tint); color: var(--rk-brand); }
.rk-tone-danger { background: var(--rk-danger-tint); color: var(--rk-danger); }
.rk-tone-success { background: var(--rk-success-tint); color: var(--rk-success); }
.rk-tone-muted { background: var(--rk-surface-2); color: var(--rk-muted); }
.rk-wait { font: 500 12px/1 var(--rk-mono); color: var(--rk-muted); white-space: nowrap; }
.rk-wait-urgent { color: var(--rk-danger); font-weight: 700; }
.rk-wait-elevated { color: var(--rk-warn); }
.rk-meta { font-size: 12px; color: var(--rk-muted); }
.rk-meta code { font-family: var(--rk-mono); font-size: 11px; }
.rk-todo { margin: 0; font-size: 13px; }
.rk-impact { margin: 0; font-size: 12px; color: var(--rk-muted); }
.rk-card-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: auto; padding-top: 6px; }
.rk-row-actions { display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex-wrap: nowrap; }
.rk-btn { background: var(--rk-surface-2); border: 1px solid var(--rk-border); color: var(--rk-fg); border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.rk-btn-primary { background: var(--rk-brand); border-color: var(--rk-brand); color: var(--rk-brand-fg); }
.rk-btn-danger { background: var(--rk-danger-tint); border-color: var(--rk-danger); color: var(--rk-danger); }
.rk-btn-ghost { background: transparent; }
.rk-toast { position: fixed; bottom: 20px; right: 20px; max-width: 420px; background: var(--rk-surface-2); border: 1px solid var(--rk-border); color: var(--rk-fg); border-radius: 10px; padding: 10px 14px; font-size: 13px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); z-index: 30; opacity: 0; pointer-events: none; transition: opacity .16s ease; }
.rk-toast.show { opacity: 1; }
.rk-toast.ok { border-color: var(--rk-success); }
.rk-toast.err { border-color: var(--rk-danger); }
.rk-doc-preview { background: var(--rk-bg); border: 1px solid var(--rk-border); border-radius: 10px; padding: 12px; font: 12px/1.6 var(--rk-mono); white-space: pre-wrap; word-break: break-word; max-height: 280px; overflow-y: auto; margin: 0; }
.rk-tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--rk-border); padding-bottom: 10px; }
.rk-tab { background: transparent; border: 1px solid transparent; color: var(--rk-muted); border-radius: 8px; padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer; }
.rk-tab.active { background: var(--rk-brand-tint); border-color: var(--rk-brand); color: var(--rk-brand); }
.rk-ac-card { background: var(--rk-surface-2); border: 1px solid var(--rk-border); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.rk-ac-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.rk-ac-id { font: 600 11px/1 var(--rk-mono); color: var(--rk-brand); }
.rk-ac-ev { font-size: 12px; color: var(--rk-muted); background: var(--rk-bg); border-radius: 6px; padding: 6px 8px; }
.rk-mark-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.rk-mark { background: var(--rk-surface-1); border: 1px solid var(--rk-border); color: var(--rk-muted); border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
.rk-mark.active-pass { background: rgba(74, 222, 128, 0.16); border-color: var(--rk-success); color: var(--rk-success); font-weight: 600; }
.rk-mark.active-fail { background: var(--rk-danger-tint); border-color: var(--rk-danger); color: var(--rk-danger); font-weight: 600; }
.rk-mark.active-skip { background: var(--rk-surface-1); border-color: var(--rk-muted); color: var(--rk-fg); font-weight: 600; }
.rk-note-input { width: 100%; background: var(--rk-bg); border: 1px solid var(--rk-border); color: var(--rk-fg); border-radius: 6px; padding: 6px 8px; font-size: 12px; }
.rk-service-link { color: var(--rk-data); text-decoration: none; font-family: var(--rk-mono); font-size: 12px; }
.rk-service-link:hover { text-decoration: underline; }
.rk-info-box { background: var(--rk-surface-2); border: 1px solid var(--rk-border); border-radius: 10px; padding: 10px 12px; font-size: 13px; line-height: 1.6; display: flex; flex-direction: column; gap: 4px; }
.rk-textarea { width: 100%; min-height: 76px; resize: vertical; background: var(--rk-bg); border: 1px solid var(--rk-border); color: var(--rk-fg); border-radius: 8px; padding: 8px 10px; font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.rk-change-item { background: var(--rk-surface-2); border: 1px solid var(--rk-border); border-radius: 10px; overflow: hidden; }
.rk-change-head { width: 100%; background: transparent; border: none; color: inherit; padding: 9px 12px; text-align: left; cursor: pointer; display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; }
.rk-change-head:hover { background: var(--rk-surface-1); }
.rk-change-body { border-top: 1px solid var(--rk-border); background: var(--rk-bg); padding: 10px 12px; font: 12px/1.6 var(--rk-mono); white-space: pre-wrap; word-break: break-word; margin: 0; }
.rk-diff { border-top: 1px solid var(--rk-border); background: var(--rk-bg); padding: 8px 0; font: 12px/1.55 var(--rk-mono); overflow-x: auto; max-height: 300px; overflow-y: auto; }
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
.rk-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.45); backdrop-filter: blur(2px); opacity: 0; pointer-events: none; transition: opacity .18s ease; z-index: 19; }
.rk-backdrop.open { opacity: 1; pointer-events: auto; }
.rk-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(460px, 100vw); background: var(--rk-surface-1); border-left: 1px solid var(--rk-border); padding: 22px; transform: translateX(100%); transition: transform .18s ease; overflow-y: auto; z-index: 20; display: flex; flex-direction: column; gap: 16px; }
.rk-drawer.open { transform: translateX(0); }
.rk-drawer-section { border-top: 1px solid var(--rk-border); padding-top: 14px; display: flex; flex-direction: column; gap: 10px; }
.rk-drawer-section-title { font-size: 12px; font-weight: 600; color: var(--rk-muted); margin: 0; }
.rk-vtrack { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.rk-vstop { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; border-radius: 8px; background: var(--rk-surface-2); font-size: 13px; }
.rk-vstop-left { display: flex; align-items: center; gap: 8px; }
.rk-vstop-who { font-size: 12px; color: var(--rk-muted); }
.rk-hidden { display: none !important; }
@media (max-width: 900px) {
  .rk-kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rk-row { grid-template-columns: 1fr; }
  .rk-row-actions { justify-content: flex-start; }
}
</style>
</head>
<body>
<div class="rk-shell">
  <header class="rk-topbar">
    <div class="rk-brand-title"><span class="rk-dot-brand"></span><span>${escapeHtml(title)}</span><span class="rk-stage">${escapeHtml(platformName)}</span></div>
    <div class="rk-card-actions" style="margin-top:0;padding-top:0">
      ${options.apiBase ? `<button type="button" class="rk-btn" id="rk-refresh">刷新</button>` : ""}
      <button type="button" class="rk-btn" id="rk-theme-toggle">切换深浅主题</button>
    </div>
  </header>

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
</div>

<div class="rk-backdrop" id="rk-backdrop" aria-hidden="true"></div>
<aside class="rk-drawer" id="rk-drawer" aria-hidden="true"></aside>
<div class="rk-toast" id="rk-toast" role="status" aria-live="polite"></div>
<script>
const ITEMS = ${payload};
const CFG = ${runtimeCfg};
const byKey = new Map(ITEMS.map((i) => [i.key, i]));
const STOP_STATE_LABEL = { done: "已完成", now: "进行中", needs: "等你处理", todo: "待开始" };
let activeGroup = "all";
let activeProject = "";
const searchEl = document.getElementById("rk-search");
const drawer = document.getElementById("rk-drawer");
const backdrop = document.getElementById("rk-backdrop");
const toastEl = document.getElementById("rk-toast");
let toastTimer = null;

function showToast(msg, kind) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.className = "rk-toast show " + (kind || "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 4200);
}

function closeDrawer() {
  drawer?.classList.remove("open");
  drawer?.setAttribute("aria-hidden", "true");
  backdrop?.classList.remove("open");
  backdrop?.setAttribute("aria-hidden", "true");
}

backdrop?.addEventListener("click", closeDrawer);
document.getElementById("rk-refresh")?.addEventListener("click", () => window.location.reload());

async function runAction(actionId, key, btn) {
  const item = byKey.get(key);
  if (!item) return;
  if (!CFG.apiBase) { showToast("当前为静态预览模式，请通过 laoshi board 启动看板后执行操作。", "err"); return; }
  const act = (item.actions || []).find((a) => a.id === actionId);
  if (act?.confirm && !window.confirm(act.confirm)) return;
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(CFG.apiBase + "/action", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(CFG.csrfToken ? { "X-Laoshi-Token": CFG.csrfToken } : {}) },
      body: JSON.stringify({ action: actionId, repo: item.repo, featureDir: item.featureDir }),
    });
    const data = await res.json().catch(() => ({ ok: false, message: "响应解析失败" }));
    if (res.ok && data.ok) {
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

function applyFilter() {
  const q = (searchEl?.value || "").trim().toLowerCase();
  document.querySelectorAll("[data-key].rk-inbox-card, [data-key].rk-row").forEach((el) => {
    const okGroup = activeGroup === "all" || el.dataset.group === activeGroup;
    const okProject = !activeProject || el.dataset.project === activeProject;
    const okQuery = !q || (el.dataset.search || "").includes(q);
    el.classList.toggle("rk-hidden", !(okGroup && okProject && okQuery));
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

document.getElementById("rk-theme-toggle")?.addEventListener("click", () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
});

function openDrawer(key) {
  const item = byKey.get(key);
  if (!item || !drawer) return;
  drawer.innerHTML = "";

  const head = document.createElement("div");
  head.className = "rk-card-top";
  const h = document.createElement("h2");
  h.style.margin = "0";
  h.style.fontSize = "17px";
  h.textContent = item.title;
  const close = document.createElement("button");
  close.className = "rk-btn";
  close.textContent = "关闭";
  close.onclick = closeDrawer;
  head.append(h, close);

  const info = document.createElement("div");
  info.style.display = "flex";
  info.style.flexDirection = "column";
  info.style.gap = "6px";
  const stageBadge = document.createElement("span");
  stageBadge.className = "rk-badge rk-tone-needs";
  stageBadge.textContent = item.stage;
  const meta = document.createElement("div");
  meta.className = "rk-meta";
  meta.textContent = item.facts + (item.branch ? " · " + item.branch : "") + " · " + item.updated;
  const dir = document.createElement("div");
  dir.className = "rk-meta";
  const whoLabel = item.owner ? " · 负责人：" + item.owner : item.startedBy ? " · 发起人：" + item.startedBy : "";
  dir.textContent = "功能目录：" + item.featureDir + whoLabel;
  info.append(stageBadge, meta, dir);

  const trackSec = document.createElement("div");
  trackSec.className = "rk-drawer-section";
  const trackTitle = document.createElement("h3");
  trackTitle.className = "rk-drawer-section-title";
  trackTitle.textContent = "阶段放行轨";
  const list = document.createElement("ol");
  list.className = "rk-vtrack";
  for (const s of item.stops || []) {
    const li = document.createElement("li");
    li.className = "rk-vstop rk-stop-" + s.state;
    const left = document.createElement("span");
    left.className = "rk-vstop-left";
    const dot = document.createElement("span");
    dot.className = "rk-dot";
    const name = document.createElement("strong");
    name.textContent = s.label;
    const who = document.createElement("span");
    who.className = "rk-vstop-who";
    who.textContent = "（" + s.who + "）";
    left.append(dot, name, who);
    const st = document.createElement("span");
    st.className = "rk-stage";
    st.textContent = STOP_STATE_LABEL[s.state] || s.state;
    li.append(left, st);
    list.append(li);
  }
  trackSec.append(trackTitle, list);

  drawer.append(head, info);

  const overviewPane = document.createElement("div");
  overviewPane.style.display = "flex";
  overviewPane.style.flexDirection = "column";
  overviewPane.style.gap = "16px";
  overviewPane.append(trackSec);

  if ((item.actions || []).length > 0) {
    const actSec = document.createElement("div");
    actSec.className = "rk-drawer-section";
    const actTitle = document.createElement("h3");
    actTitle.className = "rk-drawer-section-title";
    actTitle.textContent = "可执行操作";
    const bar = document.createElement("div");
    bar.className = "rk-card-actions";
    bar.style.marginTop = "0";
    item.actions.forEach((a, idx) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = a.id === "stop" ? "rk-btn rk-btn-danger" : idx === 0 ? "rk-btn rk-btn-primary" : "rk-btn";
      b.dataset.action = a.id;
      b.dataset.key = item.key;
      b.textContent = a.label;
      bar.append(b);
    });
    actSec.append(actTitle, bar);
    overviewPane.append(actSec);
  }

  if (CFG.apiBase) {
    const tabs = document.createElement("div");
    tabs.className = "rk-tabs";
    const tabOverview = document.createElement("button");
    tabOverview.type = "button";
    tabOverview.className = "rk-tab active";
    tabOverview.textContent = "概览与产物";
    const tabAccept = document.createElement("button");
    tabAccept.type = "button";
    tabAccept.className = "rk-tab";
    tabAccept.textContent = "验收工作台";
    const tabHistory = document.createElement("button");
    tabHistory.type = "button";
    tabHistory.className = "rk-tab";
    tabHistory.textContent = "变更与接手";
    tabs.append(tabOverview, tabAccept, tabHistory);

    const acceptPane = document.createElement("div");
    acceptPane.className = "rk-hidden";
    acceptPane.style.display = "flex";
    acceptPane.style.flexDirection = "column";
    acceptPane.style.gap = "14px";
    acceptPane.textContent = "正在加载验收清单与试用信息…";

    const historyPane = document.createElement("div");
    historyPane.className = "rk-hidden";
    historyPane.style.display = "flex";
    historyPane.style.flexDirection = "column";
    historyPane.style.gap = "14px";
    historyPane.textContent = "正在加载变更历史与负责人信息…";

    let acceptLoaded = false;
    let historyLoaded = false;
    const selectTab = (which) => {
      tabOverview.classList.toggle("active", which === "overview");
      tabAccept.classList.toggle("active", which === "accept");
      tabHistory.classList.toggle("active", which === "history");
      overviewPane.classList.toggle("rk-hidden", which !== "overview");
      acceptPane.classList.toggle("rk-hidden", which !== "accept");
      historyPane.classList.toggle("rk-hidden", which !== "history");
    };
    tabOverview.onclick = () => selectTab("overview");
    tabAccept.onclick = () => {
      selectTab("accept");
      if (!acceptLoaded) {
        acceptLoaded = true;
        loadAcceptanceWorkbench(item, acceptPane);
      }
    };
    tabHistory.onclick = () => {
      selectTab("history");
      if (!historyLoaded) {
        historyLoaded = true;
        loadHistoryPane(item, historyPane);
      }
    };

    const estSec = document.createElement("div");
    estSec.className = "rk-drawer-section rk-hidden";
    const estTitle = document.createElement("h3");
    estTitle.className = "rk-drawer-section-title";
    estTitle.textContent = "进度与用时预估";
    const estBox = document.createElement("div");
    estBox.className = "rk-info-box";
    estSec.append(estTitle, estBox);
    overviewPane.append(estSec);

    const jointSec = document.createElement("div");
    jointSec.className = "rk-drawer-section rk-hidden";
    const jointTitle = document.createElement("h3");
    jointTitle.className = "rk-drawer-section-title";
    jointTitle.textContent = "联合开发仓库";
    const jointList = document.createElement("div");
    jointList.style.display = "flex";
    jointList.style.flexDirection = "column";
    jointList.style.gap = "8px";
    jointSec.append(jointTitle, jointList);
    overviewPane.append(jointSec);

    const docSec = document.createElement("div");
    docSec.className = "rk-drawer-section";
    const docTitle = document.createElement("h3");
    docTitle.className = "rk-drawer-section-title";
    docTitle.textContent = "相关产物";
    const docChips = document.createElement("div");
    docChips.className = "rk-chips";
    const docPre = document.createElement("pre");
    docPre.className = "rk-doc-preview rk-hidden";
    docSec.append(docTitle, docChips, docPre);
    overviewPane.append(docSec);

    drawer.append(tabs, overviewPane, acceptPane, historyPane);

    const qs = new URLSearchParams({ repo: item.repo, feature: item.featureDir });
    fetch(CFG.apiBase + "/detail?" + qs.toString())
      .then((r) => (r.ok ? r.json() : null))
      .then((detail) => {
        const est = detail?.estimate;
        if (est) {
          estSec.classList.remove("rk-hidden");
          const fmtMin = (m) => { const n = Math.max(0, Math.round(m)); return n < 60 ? n + " 分钟" : Math.floor(n / 60) + " 小时" + (n % 60 ? " " + (n % 60) + " 分" : ""); };
          const fmtTok = (n) => (n >= 10000 ? (Math.round(n / 1000) / 10) + " 万" : String(Math.round(n)));
          const used = "已用 " + fmtMin(est.usedAgentMinutes) + (est.usedTokens != null ? " · " + fmtTok(est.usedTokens) + " tokens" : "");
          const med = "同类中位数约 " + fmtMin(est.typicalAgentMinutes) + (est.typicalTokens != null ? " · " + fmtTok(est.typicalTokens) + " tokens" : "") + "（参考最近 " + est.basis + " 个）";
          const tail = est.over ? "已超过常规中位数用时，复杂需求可能更久。" : "预计还需约 " + fmtMin(Math.max(5, est.leftMinutes)) + "（不含等待人工确认时间）。";
          estBox.textContent = used + " ｜ " + tail + " " + med;
        }
        const joints = detail?.joint || [];
        if (joints.length > 0) {
          jointSec.classList.remove("rk-hidden");
          jointTitle.textContent = "联合开发仓库（" + joints.length + " 个）";
          for (const j of joints) {
            const card = document.createElement("div");
            card.className = "rk-info-box";
            card.style.gap = "4px";
            const top = document.createElement("div");
            top.style.display = "flex";
            top.style.justifyContent = "space-between";
            top.style.alignItems = "center";
            top.style.gap = "8px";
            const name = document.createElement("strong");
            name.style.fontSize = "13px";
            name.textContent = j.name + (j.branch ? " · " + j.branch : "");
            top.append(name);
            if (j.gate && Array.isArray(j.gate.checks) && j.gate.checks.length > 0) {
              const failed = j.gate.checks.filter((c) => c.outcome === "fail").length;
              const badge = document.createElement("span");
              badge.className = "rk-badge " + (failed > 0 ? "rk-tone-danger" : "rk-tone-success");
              badge.textContent = failed > 0 ? "质量门 " + failed + " 项未通过" : "质量门已通过";
              top.append(badge);
            }
            const sub = document.createElement("div");
            sub.className = "rk-meta";
            sub.style.marginTop = "4px";
            sub.textContent = "工作区：" + (j.repo || "未建工作区");
            card.append(top, sub);
            jointList.append(card);
          }
        }
        const files = detail?.files || [];
        if (files.length === 0) { docTitle.textContent = "相关产物（暂无）"; return; }
        for (const f of files.slice(0, 8)) {
          const c = document.createElement("button");
          c.type = "button";
          c.className = "rk-chip";
          c.textContent = f;
          c.onclick = async () => {
            docChips.querySelectorAll(".rk-chip").forEach((x) => x.classList.remove("active"));
            c.classList.add("active");
            docPre.classList.remove("rk-hidden");
            docPre.textContent = "加载中…";
            const fq = new URLSearchParams({ repo: item.repo, feature: item.featureDir, file: f });
            const resp = await fetch(CFG.apiBase + "/file?" + fq.toString());
            const body = await resp.json().catch(() => null);
            docPre.textContent = body?.content || "无法读取文件内容";
          };
          docChips.append(c);
        }
      })
      .catch(() => { docTitle.textContent = "相关产物（加载失败）"; });
  } else {
    drawer.append(overviewPane);
  }

  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  backdrop?.classList.add("open");
  backdrop?.setAttribute("aria-hidden", "false");
}

function loadAcceptanceWorkbench(item, pane) {
  const PIPE_LABEL = { pass: "流水线：通过", fail: "流水线：未通过", unverified: "流水线：未验证", unknown: "待人工核对" };
  const qs = new URLSearchParams({ repo: item.repo, feature: item.featureDir });
  fetch(CFG.apiBase + "/acceptance?" + qs.toString())
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("无法加载验收信息"))))
    .then((data) => {
      pane.innerHTML = "";
      const list = data.checklist || { items: [], notes: [] };

      const trySec = document.createElement("div");
      trySec.className = "rk-drawer-section";
      trySec.style.borderTop = "none";
      trySec.style.paddingTop = "0";
      const tryTitle = document.createElement("h3");
      tryTitle.className = "rk-drawer-section-title";
      tryTitle.textContent = "一键试用与测试准备";
      const tryBar = document.createElement("div");
      tryBar.className = "rk-mark-row";
      const tryResult = document.createElement("div");
      tryResult.className = "rk-meta";

      if (!CFG.readOnly) {
        const startTry = document.createElement("button");
        startTry.type = "button";
        startTry.className = "rk-btn rk-btn-primary";
        startTry.textContent = "一键启动试用";
        const stopTry = document.createElement("button");
        stopTry.type = "button";
        stopTry.className = "rk-btn";
        stopTry.textContent = "停止试用";
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
            const msg = document.createElement("div");
            msg.textContent = body.message || (body.ok ? "完成" : "失败");
            tryResult.append(msg);
            for (const svc of body.services || []) {
              if (svc.url) {
                const a = document.createElement("a");
                a.className = "rk-service-link";
                a.href = svc.url;
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.textContent = svc.name + "：" + svc.url;
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
      trySec.append(tryTitle, tryBar, tryResult);
      if ((data.howTo || []).length > 0) {
        const pre = document.createElement("pre");
        pre.className = "rk-doc-preview";
        pre.style.maxHeight = "140px";
        pre.textContent = data.howTo.join("\\n");
        trySec.append(pre);
      }
      pane.append(trySec);

      const acSec = document.createElement("div");
      acSec.className = "rk-drawer-section";
      const acTitle = document.createElement("h3");
      acTitle.className = "rk-drawer-section-title";
      acTitle.textContent = "验收清单（共 " + (list.items || []).length + " 项）";
      acSec.append(acTitle);

      const answers = new Map();
      if ((list.items || []).length === 0) {
        const empty = document.createElement("div");
        empty.className = "rk-meta";
        empty.textContent = "当前需求说明中没有解析到 AC 验收标准。";
        acSec.append(empty);
      } else {
        for (const ac of list.items) {
          const card = document.createElement("div");
          card.className = "rk-ac-card";
          const head = document.createElement("div");
          head.className = "rk-ac-head";
          const id = document.createElement("span");
          id.className = "rk-ac-id";
          id.textContent = ac.id + (ac.required ? "" : "（可选）");
          const pipe = document.createElement("span");
          pipe.className = "rk-stage";
          pipe.textContent = PIPE_LABEL[ac.pipeline] || ac.pipeline;
          head.append(id, pipe);

          const title = document.createElement("div");
          title.style.fontSize = "13px";
          title.style.fontWeight = "600";
          title.textContent = ac.title;
          card.append(head, title);

          if (ac.evidence) {
            const ev = document.createElement("div");
            ev.className = "rk-ac-ev";
            ev.textContent = "证据：" + ac.evidence;
            card.append(ev);
          }

          if (!CFG.readOnly) {
            const marks = document.createElement("div");
            marks.className = "rk-mark-row";
            const note = document.createElement("input");
            note.type = "text";
            note.className = "rk-note-input";
            note.placeholder = "备注（不通过时建议写明原因）";
            const entry = { id: ac.id, mark: "", note: "" };
            note.oninput = () => { entry.note = note.value; };
            for (const [m, label] of [["pass", "通过"], ["fail", "不通过"], ["skip", "跳过"]]) {
              const btn = document.createElement("button");
              btn.type = "button";
              btn.className = "rk-mark";
              btn.textContent = label;
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
          acSec.append(card);
        }

        if (!CFG.readOnly) {
          const submitRow = document.createElement("div");
          submitRow.className = "rk-mark-row";
          submitRow.style.marginTop = "6px";
          const reviewer = document.createElement("input");
          reviewer.type = "text";
          reviewer.className = "rk-note-input";
          reviewer.style.flex = "1";
          reviewer.placeholder = "验收人姓名（默认：需求方）";
          const submit = document.createElement("button");
          submit.type = "button";
          submit.className = "rk-btn rk-btn-primary";
          submit.textContent = "提交验收结论";
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
          acSec.append(submitRow);
        }
      }
      pane.append(acSec);
    })
    .catch((err) => { pane.textContent = "加载验收工作台失败：" + String(err); });
}

function loadHistoryPane(item, pane) {
  const qs = new URLSearchParams({ repo: item.repo, feature: item.featureDir });
  fetch(CFG.apiBase + "/history?" + qs.toString())
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("无法加载变更历史"))))
    .then((data) => {
      pane.textContent = "";

      const summary = document.createElement("div");
      summary.className = "rk-info-box";
      const ownerLine = document.createElement("div");
      const curOwner = data?.owner?.owner || item.owner || item.startedBy || "未指定";
      ownerLine.textContent = "当前负责人：" + curOwner;
      const verLine = document.createElement("div");
      verLine.className = "rk-meta";
      verLine.textContent = "需求说明版本：" + (data?.specVersion ? "v" + data.specVersion : "未标注");
      summary.append(ownerLine, verLine);
      const trail = data?.owner?.history || [];
      if (trail.length > 0) {
        const last = trail[trail.length - 1];
        const trailLine = document.createElement("div");
        trailLine.className = "rk-meta";
        const when = last.at ? String(last.at).slice(0, 16).replace("T", " ") : "";
        trailLine.textContent = "最近转交：" + (last.from || "未指定") + " → " + last.to + (when ? "（" + when + "）" : "") + (last.note ? " · " + last.note : "");
        summary.append(trailLine);
      }
      pane.append(summary);

      if (!CFG.readOnly) {
        const changeSec = document.createElement("div");
        changeSec.className = "rk-drawer-section";
        const changeTitle = document.createElement("h3");
        changeTitle.className = "rk-drawer-section-title";
        changeTitle.textContent = "发起改需求";
        const ta = document.createElement("textarea");
        ta.className = "rk-textarea";
        ta.placeholder = "描述要调整的功能、字段或验收标准…";
        const changeRow = document.createElement("div");
        changeRow.className = "rk-mark-row";
        const changeBtn = document.createElement("button");
        changeBtn.type = "button";
        changeBtn.className = "rk-btn rk-btn-primary";
        changeBtn.textContent = "发起改需求";
        changeBtn.onclick = async () => {
          const text = ta.value.trim();
          if (!text) { showToast("请先填写要修改的需求内容", "err"); return; }
          if (!window.confirm("把改动转给这个需求的对话：它会先停下流水线，和你确认变化并更新需求说明后继续。确定发送？")) return;
          changeBtn.disabled = true;
          try {
            const resp = await fetch(CFG.apiBase + "/action", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(CFG.csrfToken ? { "X-Laoshi-Token": CFG.csrfToken } : {}) },
              body: JSON.stringify({ action: "change", repo: item.repo, featureDir: item.featureDir, text }),
            });
            const body = await resp.json().catch(() => ({ ok: false, message: "请求解析失败" }));
            showToast(body.message || (body.ok ? "已发送改需求通知" : "发送失败"), body.ok ? "ok" : "err");
            if (body.ok) { ta.value = ""; setTimeout(() => window.location.reload(), 900); }
          } catch (err) {
            showToast("请求失败：" + String(err), "err");
          } finally {
            changeBtn.disabled = false;
          }
        };
        changeRow.append(changeBtn);
        changeSec.append(changeTitle, ta, changeRow);
        pane.append(changeSec);

        const hoSec = document.createElement("div");
        hoSec.className = "rk-drawer-section";
        const hoTitle = document.createElement("h3");
        hoTitle.className = "rk-drawer-section-title";
        hoTitle.textContent = "转交给同事";
        const toInput = document.createElement("input");
        toInput.type = "text";
        toInput.className = "rk-note-input";
        toInput.placeholder = "接手人姓名或账号";
        const noteInput = document.createElement("input");
        noteInput.type = "text";
        noteInput.className = "rk-note-input";
        noteInput.placeholder = "交接说明（可选，例如：请跟进验证环节）";
        const hoBtn = document.createElement("button");
        hoBtn.type = "button";
        hoBtn.className = "rk-btn";
        hoBtn.style.alignSelf = "flex-start";
        hoBtn.textContent = "确认转交";
        hoBtn.onclick = async () => {
          const to = toInput.value.trim();
          if (!to) { showToast("请填写接手人", "err"); return; }
          hoBtn.disabled = true;
          try {
            const resp = await fetch(CFG.apiBase + "/action", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...(CFG.csrfToken ? { "X-Laoshi-Token": CFG.csrfToken } : {}) },
              body: JSON.stringify({ action: "handover", repo: item.repo, featureDir: item.featureDir, to, note: noteInput.value.trim() }),
            });
            const body = await resp.json().catch(() => ({ ok: false, message: "请求解析失败" }));
            showToast(body.message || (body.ok ? "已转交" : "转交失败"), body.ok ? "ok" : "err");
            if (body.ok) setTimeout(() => window.location.reload(), 900);
          } catch (err) {
            showToast("请求失败：" + String(err), "err");
          } finally {
            hoBtn.disabled = false;
          }
        };
        hoSec.append(hoTitle, toInput, noteInput, hoBtn);
        pane.append(hoSec);
      }

      const chSec = document.createElement("div");
      chSec.className = "rk-drawer-section";
      const chTitle = document.createElement("h3");
      chTitle.className = "rk-drawer-section-title";
      const changes = data?.changes || [];
      chTitle.textContent = "变更记录（" + changes.length + " 项）";
      chSec.append(chTitle);
      if (changes.length === 0) {
        const empty = document.createElement("div");
        empty.className = "rk-meta";
        empty.textContent = "暂无变更记录。";
        chSec.append(empty);
      } else {
        for (const ch of changes) {
          const box = document.createElement("div");
          box.className = "rk-change-item";
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "rk-change-head";
          const tSpan = document.createElement("span");
          tSpan.textContent = ch.title;
          const hint = document.createElement("span");
          hint.className = "rk-meta";
          hint.textContent = "展开";
          btn.append(tSpan, hint);
          const bodyPre = document.createElement("pre");
          bodyPre.className = "rk-change-body rk-hidden";
          bodyPre.textContent = ch.body || "（无正文）";
          btn.onclick = () => {
            const hidden = bodyPre.classList.toggle("rk-hidden");
            hint.textContent = hidden ? "展开" : "收起";
          };
          box.append(btn, bodyPre);
          chSec.append(box);
        }
      }
      pane.append(chSec);

      const cmSec = document.createElement("div");
      cmSec.className = "rk-drawer-section";
      const cmTitle = document.createElement("h3");
      cmTitle.className = "rk-drawer-section-title";
      const commits = data?.commits || [];
      cmTitle.textContent = "需求说明修改历史（" + commits.length + " 次提交）";
      cmSec.append(cmTitle);
      if (commits.length === 0) {
        const empty = document.createElement("div");
        empty.className = "rk-meta";
        empty.textContent = "暂无 git 提交历史。";
        cmSec.append(empty);
      } else {
        for (const cm of commits) {
          const box = document.createElement("div");
          box.className = "rk-change-item";
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "rk-change-head";
          const label = document.createElement("span");
          const day = cm.date ? String(cm.date).slice(0, 16).replace("T", " ") : "";
          label.textContent = (day ? day + " · " : "") + (cm.author ? cm.author + " · " : "") + (cm.subject || cm.commit.slice(0, 7));
          const hint = document.createElement("span");
          hint.className = "rk-meta";
          hint.textContent = "查看差异";
          btn.append(label, hint);
          const diffBox = document.createElement("div");
          diffBox.className = "rk-diff rk-hidden";
          const rawLines = (cm.diff || "").split(/\\r?\\n/);
          for (const line of rawLines) {
            const row = document.createElement("div");
            let cls = "rk-diff-line";
            if (line.startsWith("+") && !line.startsWith("+++")) cls += " rk-diff-add";
            else if (line.startsWith("-") && !line.startsWith("---")) cls += " rk-diff-del";
            else if (line.startsWith("@@")) cls += " rk-diff-hunk";
            row.className = cls;
            row.textContent = line || " ";
            diffBox.append(row);
          }
          if (cm.truncated) {
            const tr = document.createElement("div");
            tr.className = "rk-meta";
            tr.style.padding = "6px 10px";
            tr.textContent = "差异内容较长，已截断至 20000 字符。";
            diffBox.append(tr);
          }
          btn.onclick = () => {
            const hidden = diffBox.classList.toggle("rk-hidden");
            hint.textContent = hidden ? "查看差异" : "收起差异";
          };
          box.append(btn, diffBox);
          cmSec.append(box);
        }
      }
      pane.append(cmSec);
    })
    .catch((err) => { pane.textContent = "加载变更历史失败：" + String(err); });
}

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
  if (e.key === "/" && document.activeElement !== searchEl) { e.preventDefault(); searchEl?.focus(); }
  if (e.key === "Escape") closeDrawer();
});
</script>
</body>
</html>`;
}
