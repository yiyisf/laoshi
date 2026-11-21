## 背景

<!-- 为什么做这次改动：问题背景、关联的里程碑或 ADR -->

## 改动

<!-- 列出主要变化，面向评审者和后续 CHANGELOG 整理 -->

- 

## 验证

<!-- 实际跑过的命令和结果 -->

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] 如涉及 `docs/guide/`、`contracts/`、`docs/adr/`：`node site/scripts/sync-docs.mjs --check`
- [ ] 如涉及依赖变更：确认 `package-lock.json` 中只包含公网 `https://registry.npmjs.org/` 地址
