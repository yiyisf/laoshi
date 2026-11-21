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
}

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
        return `<article class="rk-inbox-card rk-urgency-${urgency}" data-key="${escapeHtml(item.key)}" data-project="${escapeHtml(item.project)}" data-group="attention" data-search="${escapeHtml(`${item.title} ${item.project} ${item.featureDir} ${item.branch ?? ""} ${item.waiting?.card?.id ?? ""}`.toLowerCase())}">
      <div class="rk-card-top">
        <div class="rk-card-title-wrap">
          <span class="rk-badge rk-tone-${kind.tone}">${escapeHtml(kind.label)}</span>
          <h3 class="rk-card-title">${escapeHtml(item.title)}</h3>
        </div>
        <span class="rk-wait rk-wait-${urgency}">${escapeHtml(waitedText)}</span>
      </div>
      <div class="rk-meta">${escapeHtml(facts(item))}${item.waiting?.card ? ` · 卡片 ${escapeHtml(item.waiting.card.system)} ${escapeHtml(item.waiting.card.id)}` : ""}</div>
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
    <span class="rk-section-sub">${GROUP_LABELS[g]}</span>
  </div>
  <div class="rk-list">
    ${list
      .map((item) => {
        const stops = trackOf(item);
        const actions = actionsFor(item);
        return `<article class="rk-row" tabindex="0" data-key="${escapeHtml(item.key)}" data-project="${escapeHtml(item.project)}" data-group="${g}" data-search="${escapeHtml(`${item.title} ${item.project} ${item.featureDir} ${item.branch ?? ""} ${item.stage}`.toLowerCase())}">
      <div class="rk-row-main">
        <div class="rk-row-head">
          <strong class="rk-row-title">${escapeHtml(item.title)}</strong>
          <span class="rk-stage">${escapeHtml(item.stage)}</span>
        </div>
        <div class="rk-meta">${escapeHtml(facts(item))}${item.branch ? ` · <code>${escapeHtml(item.branch)}</code>` : ""} · ${escapeHtml(ago(item.updatedAt, now))}</div>
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
      title: i.title,
      project: i.project,
      featureDir: i.featureDir,
      branch: i.branch ?? null,
      stage: i.stage,
      status: i.status,
      facts: facts(i),
      updated: ago(i.updatedAt, now),
      stops: trackOf(i),
      actions: readOnly ? [] : actionsFor(i).map((a) => ({ id: a, ...ACTION_TEXT[a] })),
    })),
  ).replace(/</g, "\\u003c");

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
.rk-btn-ghost { background: transparent; }
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
    <button type="button" class="rk-btn" id="rk-theme-toggle">切换深浅主题</button>
  </header>

  <section class="rk-kpi-grid" aria-label="状态概览">
    <button type="button" class="rk-kpi active" data-filter-group="all">
      <div class="rk-kpi-label">需要你处理</div>
      <div class="rk-kpi-num">${summary.attention}</div>
      <div class="rk-kpi-sub">${summary.longestWaitText ? `最长 ${escapeHtml(summary.longestWaitText)}` : "全部处理完毕"}</div>
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
<script>
const ITEMS = ${payload};
const byKey = new Map(ITEMS.map((i) => [i.key, i]));
const STOP_STATE_LABEL = { done: "已完成", now: "进行中", needs: "等你处理", todo: "待开始" };
let activeGroup = "all";
let activeProject = "";
const searchEl = document.getElementById("rk-search");
const drawer = document.getElementById("rk-drawer");
const backdrop = document.getElementById("rk-backdrop");

function closeDrawer() {
  drawer?.classList.remove("open");
  drawer?.setAttribute("aria-hidden", "true");
  backdrop?.classList.remove("open");
  backdrop?.setAttribute("aria-hidden", "true");
}

backdrop?.addEventListener("click", closeDrawer);

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
  dir.textContent = "功能目录：" + item.featureDir;
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

  drawer.append(head, info, trackSec);

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
      b.className = idx === 0 ? "rk-btn rk-btn-primary" : "rk-btn";
      b.dataset.action = a.id;
      b.dataset.key = item.key;
      b.textContent = a.label;
      bar.append(b);
    });
    actSec.append(actTitle, bar);
    drawer.append(actSec);
  }

  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  backdrop?.classList.add("open");
  backdrop?.setAttribute("aria-hidden", "false");
}

document.addEventListener("click", (e) => {
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
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
