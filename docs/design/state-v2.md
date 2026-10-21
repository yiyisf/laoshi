# 状态文件 v2

- 状态：提议
- 现状：req-kit 的 `state.json` 是 `version: 1`（`engine/src/state.ts` 中 `STATE_VERSION = 1`，`STATE_MIGRATIONS` 目前为空）。格式规则见 [contracts/state.md](../../contracts/state.md)：只加可选字段不升版；改变字段含义或增加必需字段要升版并写迁移。

## 1. 为什么要升版

v1 里有几个字段带着 Paseo 的含义，换平台后名称会误导，且其语义（"Paseo 的工作区""Paseo 的定时任务"）不一定在别的平台存在：

| v1 字段 | 问题 |
| --- | --- |
| `originAgentId` | "发起对话的 agent"：别的平台未必有 agent 形式的会话 |
| `worktree.workspaceId`、`joint[].workspaceId` | Paseo 工作区 ID |
| `schedules[]`（`id`、`kind`、`at`） | Paseo 定时任务 ID |

## 2. v1 → v2 的改动

只做**改名**和**新增可选字段**，不改变任何流程语义：

| v1 | v2 | 说明 |
| --- | --- | --- |
| `originAgentId` | `originSessionId` | 值不变 |
| `worktree.workspaceId` | `worktree.workspaceRef` | 值不变；由适配器解释 |
| `joint[].workspaceId` | `joint[].workspaceRef` | 同上 |
| `schedules[].id` | `wakeups[].ref` | 数组名与键名一起改；`kind`（`reminder`、`auto-resume`、`watchdog`、`verify-start`、`approval-continue`）、`at` 不变 |
| — | `adapter: { id, version }` | 新增，可选。记录这次运行用的适配器与平台版本，便于排查 |
| — | `mode: "engine" \| "chat"` | 新增，可选。缺省为 `engine`；模式 B 为 `chat`（见 [in-chat-orchestration.md](in-chat-orchestration.md)） |
| — | `stepRequest: { key, since } \| null` | 新增，可选。模式 B 中"等待会话 agent 执行的步骤" |

保持不变（已经是中性的）：`history[].agentId`（`cli-json.md` 的 `steps[].agentId`、`current[].agentId` 同理）、`history[].agent`（含义为"这一步用的 agent 配置标签"）、`waitingPermission.agentId`、`external`、`pushed`、`gate`、`budget` 等。

`history[].agent` 的现有注释写着"Paseo profile 名或 `provider/model`"，注释要改成"agent 配置标签"，字段不动。

## 3. 迁移规则

沿用 req-kit 的机制：读到旧版本自动迁移，原文件保留为 `state.json.bak-v1`；读到比自己新的版本拒绝运行。

补充三条：

1. **进行中的流水线不迁移。** 迁移前检查 `status === "running"` 且 `pid` 仍存活：拒绝并提示"等它结束或先暂停"。避免新旧进程同时写同一个文件。
2. **迁移是单向的。** req-kit 1.x 读到 v2 会拒绝运行。回滚办法是恢复 `.bak-v1` 并改用 1.x。这点要写进升级说明和 `laoshi migrate` 的确认提示里。
3. **对外契约不随状态改名。** 被改名的字段同时出现在三份对外契约里，它们有外部消费者（Paseo 插件、内部 IM 通知适配器、管理层的使用数据汇总）：

   | 契约 | 受影响字段 |
   | --- | --- |
   | `cli-json.md`（`req api`，`schema: 1`） | `sourceRepo`/`workspaceId`、`run.originAgentId`、`joint[].workspaceId` |
   | `notifier-event.md`（`schema: 1`） | `originAgentId` |
   | `usage-record.md`（`schema: 1`） | `workspaceId` |

   决定：这三份契约**保持 `schema: 1` 和现有字段名不变**，由输出层把 `originSessionId`、`workspaceRef` 映射回旧名输出。需要中性名时，在后续的 `schema: 2` 里同时给出新旧两个名字，过渡一段时间后再去掉旧名。这样迁移状态文件不会让已有的插件、通知和汇总失效。
4. **兼容读取一个过渡期。** laoshi 读 v1 时在内存中迁移、首次写入时落盘为 v2。

## 4. 迁移函数（草案）

```ts
STATE_MIGRATIONS[1] = (old) => {
  const s = structuredClone(old);
  s.version = 2;
  s.originSessionId = s.originAgentId ?? null; delete s.originAgentId;
  if (s.worktree) { s.worktree.workspaceRef = s.worktree.workspaceId; delete s.worktree.workspaceId; }
  for (const j of s.joint ?? []) { j.workspaceRef = j.workspaceId; delete j.workspaceId; }
  if (s.schedules) { s.wakeups = s.schedules.map(({ id, ...rest }) => ({ ref: id, ...rest })); delete s.schedules; }
  return s;
};
```

## 5. 测试要求

- `engine/test/state.test.ts` 增加 v1→v2 迁移用例：含 `worktree`、`joint`、`schedules` 的完整旧状态；缺字段的旧状态；`.bak-v1` 的产生；读取更新版本时拒绝。
- 用 req-kit 真实运行产生的状态文件做夹具（脱敏后），不只用手写样例。
- 迁移后 `req`/`laoshi` 的 `--status`、`--resume` 对迁移后的需求行为与迁移前一致。
