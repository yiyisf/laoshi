# M4：跨平台共用界面视图层与 UI 体验规范

> 对应 [docs/roadmap.md](../roadmap.md) P1 的 **M4（共用界面组件）**，为 **D1（dsh 界面插件）**、**X1（集中处理待办）**、**X2（验收工作台）** 及 **G3（合规与效能报告页）** 提供统一基础。

## 1. 为什么采用两层共享架构

| 平台 | 运行环境 | 约束 |
|---|---|---|
| Paseo 插件 | React Native（`adapters/paseo/plugin/`） | 独立拷贝安装，禁止 DOM API，禁止跨出插件目录的相对导入 |
| dsh 界面插件 / 本机看板 | Web（HTML / React DOM） | 浏览器环境，直接消费 `design/` 的 `--rk-*` CSS 变量与组件样式 |

两者底层数据完全一致（均消费 `laoshi api` 的 JSON 契约 [contracts/cli-json.md](../../contracts/cli-json.md)），设计语言也完全一致（[design/README.md](../../design/README.md) 的 Bento Launchpad 家族：青柠绿表示"等你决定"、靛蓝表示 AI、青色表示运行中）。因此拆为两层：

1. **`ui/shared/view-model.ts`（纯 TypeScript 领域视图模型）**：
   - 零 DOM、零 React Native、零 Node 导入；
   - 统一负责分组（`groupOf`）、6 站放行轨（`trackOf`）、图标与语义色（`iconOf`）、可执行动作矩阵（`actionsFor`）、时间与用量格式化、顶部 KPI 汇总（`summarizeBoard`）、组合筛选搜索（`filterRequirements`）、以及按紧迫度排序的待处理卡片模型（`buildInboxCards`）。
   - Paseo 插件、dsh 界面插件、本机网页全部共用同一套业务状态判断与文案，避免逻辑漂移。
2. **`ui/web/board.ts`（Web 共享视图层）**：
   - 面向 dsh 界面插件（D1）和本机看板；
   - 直接复用 `design/reference/tokens.css`（或 `engine/src/review-assets/rk-tokens.css`）的 `--rk-*` 变量，支持深色默认与浅色切换。

## 2. 参考业界最佳实践的 UI 体验优化

在原有 Paseo 插件界面基础上，借鉴 **Linear（待办聚焦与快捷键）**、**GitHub Actions（步骤放行轨）** 与 **Vercel Dashboard（Bento KPI 概览与抽屉详情）** 的交互模式：

1. **顶部 4 格 Bento KPI 概览条（点击即筛选）**：
   - 展示「需要你处理」「进行中」「待测试验证」「最近完成」四个数字；当存在等待超过 24 小时的紧急事项时自动标出最长等待时长。
   - 点击任意 KPI 卡片即可切换对应筛选状态，减少多层跳转。
2. **即时搜索与项目胶囊（支持 `/` 快捷键）**：
   - 支持按需求标题、项目名、目录、分支、卡片编号与发起人实时过滤；
   - 多仓库场景自动展示 `多仓 +N` 标识。
3. **高优"等你处理"聚焦区（Needs You）**：
   - 按等待时长从久到近排序，自动标注紧迫度（`< 4h` 常规、`≥ 4h` 关注、`≥ 24h` 紧急）；
   - 每张卡给出**一句话影响说明**（"确认前不会开始写代码"等）与**唯一青柠绿主操作 CTA**，避免按钮堆砌。
4. **6 站可视化放行轨 + 右侧详情抽屉**：
   - 每条需求行直接呈现 6 站放行轨（对齐 → 方案 → 实现 → 评审 → 验证 → 验收），进行中带青色脉冲指示，等你决定带青柠高亮；
   - 点击任意行在右侧滑出详情抽屉（不丢失列表滚动位置与筛选条件），支持 `Esc` 关闭，窄屏（400px）自动单栏自适应。

## 3. 后续接入路径

- **D1（dsh 界面插件）**：直接挂载 `ui/web/board.ts`（或基于同一 CSS/DOM 结构绑定 dsh 插件 RPC），把只读/操作请求转发到 `laoshi api`。
- **X1 / X2（集中处理与验收工作台）**：在 `ui/shared/view-model.ts` 增加验收清单与证据状态模型，抽屉内增加「一键试用」「验收勾选」「证据预览」标签页，Paseo 与 dsh 同步获得。
- **G3（合规与效能报告页）**：在顶栏新增「统计与合规」视图，同样复用 `ui/shared` 聚合模型。
