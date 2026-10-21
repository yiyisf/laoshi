# 兼容与迁移

- 状态：提议
- 背景：[ADR 0001](../adr/0001-new-repo-core-and-adapters.md)。req-kit 当前 1.13.0，团队里有人在用，且在向内网分发。目标是让他们**几乎无感**地过渡到 laoshi。

## 1. 原则

1. 老用户不被迫迁移；迁移是一条命令加一次确认，可预览。
2. req-kit 1.x 在过渡期可用且可信：只修缺陷，但缺陷要修到位。
3. 同一个需求的数据（功能目录、状态、使用记录）在迁移中不丢。
4. 内网分发方式不变：只靠 npm 镜像（req-kit ADR 0032 的"只用 npm 安装"继续沿用），不依赖 GitHub、Vercel。

## 2. 命名对照与处理

| 项 | req-kit | laoshi | 过渡处理 |
| --- | --- | --- | --- |
| npm 包 | `paseo-req-kit` | `laoshi`（已确认可用） | `paseo-req-kit` 2.0 成为薄分发包 |
| 命令 | `req`、`req-kit`、`paseo-req-kit`、`start-pipeline` | `laoshi` | 旧名全部保留为别名 |
| 入口 skill | `/req`、`/req-setup`、`/req-doctor`、`/req-retro` | `/laoshi`、`/laoshi-setup`、`/laoshi-doctor`、`/laoshi-retro` | **已决定**（[ADR 0005](../adr/0005-skill-names.md)）：`paseo-req-kit` 2.0 额外安装转发到 laoshi 的 `/req*` 薄 skill |
| 机器配置目录 | `~/.req-kit/` | `~/.laoshi/` | 旧目录作回退读取；`REQ_KIT_HOME` 仍然有效，新增 `LAOSHI_HOME` |
| 项目配置 | `.requirement-pipeline.json`、`.requirement-pipeline/`（含 `project-notes.md`、`verify.md`） | `.laoshi.json`、`.laoshi/` | 两者都读，新项目写新名；`laoshi migrate` 提供重命名但不强制（避免逼团队仓库提交改名） |
| 功能目录 | `docs/features/<日期>-<名称>/` | 不变 | — |
| 使用记录 | `~/.req-kit/usage/runs.jsonl`、`~/.req-kit/index/` | `~/.laoshi/...` | 统计同时读新旧两处；格式 `schema: 1` 不变，管理层汇总口径连续 |
| Paseo 插件 | `req plugin install` | `laoshi plugin install`（Paseo 适配器的一部分） | 保留旧命令 |
| `req api` 输出、通知事件、使用记录 | 均为 `schema: 1` | 同，字段名不变 | 外部消费者（插件、IM 适配器、汇总）不受影响，见 [state-v2.md §3](state-v2.md) |

## 3. 过渡期的维护规则

req-kit 1.x 的修复进入 laoshi 的方式：

- **只接收**：数据丢失、错误结论（夸大）、安全边界被突破、使用被完全阻塞的缺陷。其余缺陷和所有新功能先进 laoshi。
- **移植清单**：1.x 每个修复在 laoshi 的 `docs/porting-log.md` 登记一行（1.x 提交、laoshi 提交或"不适用"）。
- **路径一致**：核心文件保持 `engine/src/...` 的路径和名字（[architecture.md §5](architecture.md)），多数补丁可以直接应用。涉及 Paseo 的部分移植到 `adapters/paseo/`。
- **冻结点**：laoshi 达到"对等"后，req-kit 库只剩垫片的维护。

## 4. "对等"的定义

满足以下全部，才可以发布 `paseo-req-kit` 2.0：

1. `engine/test` 全部通过，且用的是同一份测试用例（只改路径和名字）。
2. `evals/` 的端到端用例全部跑过，"夸大"为零，其他指标不差于 1.13 的基线（基线保存在 req-kit 的 `evals/baselines/`，需要先为 1.13 补一份）。
3. Paseo 适配器能力矩阵与 1.13 相同；Paseo 插件功能不退化。
4. 团队内至少 3 个真实需求在 laoshi + Paseo 适配器上完整跑通，未发生数据丢失。
5. `laoshi migrate` 在真实的 1.13 配置、项目和进行中需求上演练通过（含回滚演练）。

## 5. 对使用者的迁移步骤

```text
npx laoshi migrate          # 默认预览，不改任何东西
  ① 检查：是否有进行中的流水线（有则提示先结束或暂停）
  ② 配置：~/.req-kit/config.json → ~/.laoshi/config.json（platform.paseo 段由旧的 daemonUrl 等字段生成）
  ③ skill：安装 laoshi 的 skill；旧的 /req* 是否保留见 §6
  ④ 需求：各项目 docs/features/*/.pipeline/state.json 迁到 v2（保留 .bak-v1）
  ⑤ 报告：做了什么、怎么回滚
npx laoshi migrate --apply  # 确认后执行
```

回滚：恢复 `.bak-v1` 状态文件和旧配置目录，重新安装 req-kit 1.x。`laoshi migrate` 的确认提示里要写明这一步。

## 6. 待定

- ~~skill 名~~：已决定，见 [ADR 0005](../adr/0005-skill-names.md)。仍待做的是转发薄 skill 的写法：只做命令转发和一句"这个命令已改名为 /laoshi"，不复制手册内容，避免两份手册漂移。
- laoshi 的版本从 `0.1.0` 起，达到对等时发布 `1.0.0`，`paseo-req-kit` 2.0 依赖 `laoshi@^1`。
- 内网文档站：laoshi 的站点和现有 req-kit 站点是并存还是替换，以及同步到内网 Git Pages 的流程，需要单独设计。
- 现有对外材料（给技术领导的汇报稿、同事使用说明）在 2.0 之前保持对 req-kit 的描述，2.0 之后统一改口径。
