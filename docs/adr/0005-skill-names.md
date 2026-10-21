# 0005 入口 skill 命名

- 状态：已采纳（2026-10-21，由项目负责人确认）
- 详见：[compat-migration.md §2](../design/compat-migration.md)

## 背景

req-kit 的入口 skill 是 `/req`、`/req-setup`、`/req-doctor`、`/req-retro`，同事已经习惯。laoshi 是新的名字，团队内部也习惯称"老师"。保留旧名会让产品名和命令不一致；直接改名有学习成本。

## 决定

- laoshi 的入口 skill 命名为 `/laoshi`、`/laoshi-setup`、`/laoshi-doctor`、`/laoshi-retro`。
- `paseo-req-kit` 2.0 额外安装 `/req*` 转发 skill，只做命令转发并提示新名字，**不复制手册内容**。
- 命令行 `laoshi` 为主命令，`req`、`req-kit`、`paseo-req-kit`、`start-pipeline` 保留为别名。

## 影响

- 旧用户升级到 2.0 后 `/req` 仍可用，可以逐步改用 `/laoshi`。
- 转发 skill 在 laoshi 1.x 的整个生命周期内保留，何时移除另行决定。
- 文档、站点和汇报材料中的命令示例在 2.0 之后统一改为 `/laoshi*`。
