# 0004 对外契约在迁移中保持稳定

- 状态：提议
- 详见：[state-v2.md §3](../design/state-v2.md)、[compat-migration.md](../design/compat-migration.md)

## 背景

状态文件 v2 要把带 Paseo 含义的字段改名（`originAgentId`、`workspaceId`、`schedules`）。同样的名字出现在三份有外部消费者的契约里：`req api` 的 JSON（Paseo 插件读取）、通知事件（内部 IM 适配器读取）、使用记录（管理层汇总）。

## 决定

- 三份契约保持 `schema: 1` 和现有字段名；由输出层把 v2 的中性字段映射回旧名。
- 需要中性名时，后续发布 `schema: 2`，同时输出新旧两个名字，过渡期结束再去掉旧名。
- 状态文件本身升到 v2，迁移单向（回滚靠 `.bak-v1`），进行中的流水线不迁移。

## 影响

- 输出层要有一张字段映射表，并有测试保证映射正确。
- 使用数据汇总口径在迁移前后连续，不需要管理侧改动。
