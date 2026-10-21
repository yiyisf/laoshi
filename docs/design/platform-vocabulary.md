# 平台词汇表

- 状态：提议
- 解决的问题：req-kit 的面向使用者的文案（`messages.ts`、`launch.ts`、`control.ts`、部分提示词与 skill）直接写着"在 Paseo 的 Schedules 中可以看到""在 Paseo 侧边栏的'需求'中打开""打开名为「X」的 agent 批准"。换平台后这些指引会错。

## 1. 做法

文案里不写平台名和界面位置，写成词汇键；每个适配器提供一张词汇表，渲染时替换。

```text
未渲染：已预约在 {time} 开始（{platform.scheduleUi}）。
Paseo ：已预约在 22:00 开始（Paseo 定时任务，在 Paseo 的 Schedules 中可以看到）。
内部平台：已预约在 22:00 开始（平台定时任务）。
```

## 2. 词汇键（从 req-kit 现有文案归纳）

| 键 | 含义 | Paseo 的取值示例 |
| --- | --- | --- |
| `platform.name` | 平台名 | Paseo |
| `platform.session` | 发起流水线的"对话/会话" | 对话 |
| `platform.subagentList` | 使用者在哪里看到每个步骤 | 这个对话的子 agent 列表 |
| `platform.scheduleUi` | 在哪里看到、取消预约 | Paseo 定时任务，在 Paseo 的 Schedules 中可以看到 |
| `platform.requirementPage` | 需求总览/审查页入口 | 在 Paseo 侧边栏的"需求"中打开 |
| `platform.approvePermission` | 步骤 agent 等权限批准时怎么处理 | 打开名为「{agentTitle}」的 agent，查看并批准这个请求 |
| `platform.newWorkspace` | 使用者想自己建隔离工作区时怎么做 | New workspace → Isolation 选 New worktree |
| `platform.workspaceConfigFile` | 平台的工作区配置文件，没有则为空 | paseo.json |

词汇键随适配器开发逐步补充；新增键时同时更新本表。

## 3. 规则

1. **可以为空**：平台没有对应概念时取值为 `null`，对应的整句话被省略。因此需要引用界面位置的句子必须能单独拆出，不能嵌在别的句子中间。
2. **skill 与提示词在安装时渲染**（静态文本，随安装写入目标目录）；**运行时消息**（通知、命令输出）在运行时渲染。
3. **核心代码和提示词里不允许出现平台名**。加一条 CI 检查：除 `adapters/<平台>/` 和词汇表外，搜到平台名即失败（`paseo`、各内部平台名通过配置给出）。
4. **命令示例也属于词汇**：例如 `skills/req-setup` 里生成 `paseo.json` 的步骤属于"平台接入物"，由适配器提供对应的 setup 片段，通用的 `/req-setup` 只负责项目说明与验证方法。

## 4. 需要先收敛的位置（来自资产清单）

- `engine/src/messages.ts`（约 11 处）、`launch.ts`（约 10 处）、`control.ts`（约 5 处）
- 提示词：`07b-handoff`、`08-service-start`、`09-verify`、`browser-verify`、`joint`、`paseo-services`
- skill：`req/SKILL.md`、`req-setup/SKILL.md`（14 处）、`req-doctor/SKILL.md`、手册 `new`、`status`、`takeover`、`verify`
