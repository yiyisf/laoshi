# 更新记录

laoshi 的版本号遵循语义化版本，从 0.1.0 开始；每一版的标题写成 `## <版本> - <日期>`。每一版先写使用者会看到的变化，再写升级须知。laoshi 之前的历史见 paseo-req-kit 的更新记录（laoshi 从它的 1.15.0 抽出）。

## 0.3.1 - 2026-11-27

正式版（npm `latest` 标签）：把共享 Web 需求看板直接内嵌到 DeepSeek Harness（`dsh`）左侧导航栏并支持全宽详情与 Paseo 一致化体验，增加会话顶部栏直达需求详情快捷入口与阶段执行记录跳回，修复 `dsh` 插件覆盖升级不生效，支持 Paseo 与 `dsh` 同机多平台并存，并完善一步安装与多平台自动升级体验。安装：`npx -y @yiyi_zhang/laoshi@latest install --platform <dsh|paseo>`。

### 使用者会看到的变化

- **dsh 内嵌左侧栏「需求看板」与对话快捷直达**：`laoshi-dsh-plugin` 在 `dsh` 左侧导航栏挂载 **「需求看板」**（`/laoshi/` 代理，自动随 `dsh` 切换深浅主题并复用登录校验）；在需求主对话或步骤子对话顶部工具栏展示 **「需求：<标题>」** 快捷按钮一键直达详情；详情中可从 **「执行记录」**（`查看执行记录 ↗`）或 **「打开需求对话 ↗」** 直接跳回对应子 agent 或原需求对话。
- **Web 需求看板全宽详情与 Paseo 体验对齐**：顶部新增 **需求 / 使用统计 / 配置** 导航切换；需求详情由 460px 右侧抽屉改为全宽页面（带 `← 返回需求列表`、关键决策高亮按钮、代码审查 / 审查原型外链、2 列元数据卡片、Markdown 渲染与 TSV 表格文档弹窗、完整执行记录与全宽验收/变更子页）。
- **dsh 插件直接覆盖升级生效**：再次运行 `laoshi install --platform dsh` 或 `laoshi upgrade` 时先移除并清理旧版 `laoshi-dsh-plugin`、校验并覆写最新文件，同时保留 `cordis.patch.yml` 中的 `approvals`、`board`、`boardPort` 并自动刷新 `kitRoot` 路径，无需手工先卸载旧插件。
- **Paseo 与 dsh 同机多平台并存**：同一台机器可先后安装多个平台，共用 `~/.laoshi/config.json` 与 `install.json`；运行时按 `LAOSHI_PLATFORM` 或对话环境变量（`DSH_SESSION_ID`、`PASEO_AGENT_ID`）自动切换适配器与平台级 `agents`；`laoshi doctor` 与 `laoshi install --platform <id> --uninstall` 支持分平台检查与单独卸载。
- **真正的一步安装与多平台同步升级**：`laoshi install --platform paseo` 现默认一并部署并加载 Paseo 需求插件（可用 `--no-plugin` 跳过，`--with-plugin` 兼容保留）；`laoshi upgrade` 或不带 `--platform` 执行 `laoshi install` 时会自动同步刷新所有已安装并存平台的 skill 与插件。
- **升级前运行中需求检查（ADR 0007）**：`laoshi upgrade` 在原地替换程序文件前自动扫描安装根索引下各代码库，列出等待中与运行中的流水线，存在本机运行中流水线时默认中止提醒（确认仍要继续可加 `--allow-running`）。
- **契约、ADR 与文档同步**：按 ADR 0008 修订 `contracts/agent-runtime.md`，将 ADR 0004/0006/0007/0008 定状态为 `已采纳`，并同步更新 Roadmap 与安装/升级/走查文档。

### 升级须知

- **一步升级全部平台**：在任意已安装机器运行 `laoshi upgrade`（公司内网镜像加 `--registry <地址>`），会自动升级到 `0.3.1` 并同步刷新本机所有已并存平台（Paseo / dsh）的 skill 与插件。
- **内网离线包（Windows / dsh）**：下载本版本 Release 附带的 `laoshi-0.3.1-<commit>-win32-x64.zip`，解压后直接覆盖运行 `node adapters\dsh\intranet\install.mjs --profile web`，完成后重启 `dsh --profile web`。
- **摸高**：替换为本版本 Release 附带的 `laoshi-expert-0.3.1.zip`（或运行 `node adapters/mogao/make-expert.mjs` 重新生成）。

## 0.3.1-beta.2 - 2026-11-25

测试版（npm `beta` 标签，GitHub Pre-release）：修复 `dsh` 插件覆盖升级不生效、支持 `paseo` 与 `dsh` 同机多平台并存、在 `dsh` 会话顶部栏增加直达需求详情的快捷入口，并将 Web 看板升级为全宽详情与 Paseo 一致化视图。安装：`npx -y @yiyi_zhang/laoshi@beta install --platform dsh`。

### 使用者会看到的变化

- **dsh 插件直接覆盖升级生效**：再次运行 `laoshi install --platform dsh` 或 `laoshi upgrade` 时，会先清理旧的 `laoshi-dsh-plugin` 并按文件比对确保新版本文件完整覆盖，同时保留 `cordis.patch.yml` 中的 `approvals`、`board`、`boardPort` 并自动刷新 `kitRoot` 路径，无需再手工卸载旧版插件。
- **Paseo 与 dsh 多平台并存（同份 `~/.laoshi/config.json`）**：可在同一台机器先装一个平台后再装另一个平台（例如先装 `paseo` 再装 `dsh`）；运行时按 `LAOSHI_PLATFORM` 或平台对话环境变量（`DSH_SESSION_ID`、`PASEO_AGENT_ID`）自动切换适配器与 `platform.<id>.agents`；`laoshi doctor` 与 `laoshi install --platform <id> --uninstall` 支持分平台检查与单独卸载。
- **dsh 对话顶部栏快捷直达需求详情**：在发起需求的对话或步骤子对话中，顶部工具栏新增 **「需求：<标题>」** 快捷按钮，点击即可切换到 **「需求看板」** 面板并自动打开对应需求详情（新增 `/api/session-requirement` 与看板 `?open=` / `laoshi:open-requirement` 联动）。
- **Web 需求看板全宽详情与 Paseo 体验对齐**：顶部新增 **需求 / 使用统计 / 配置** 导航切换；需求详情由 460px 右侧抽屉改为全宽页面（带 `← 返回需求列表`、关键决策高亮按钮、代码审查 / 审查原型外链、位置/用量/质量门/外部系统 2 列元数据卡片、Markdown 渲染与 TSV 表格文档弹窗、完整执行记录与全宽验收/变更子页）。

### 升级须知

- **直接升级 dsh 插件**：无需卸载旧版，直接执行 `npx -y @yiyi_zhang/laoshi@beta install --platform dsh`（内网离线包运行对应安装脚本），完成后重启 `dsh --profile web`。
- **与 Paseo 共存**：如本机已安装 `paseo`，直接再执行 `laoshi install --platform dsh` 即可保留 `paseo` 默认配置并添加 `dsh` 并存配置。

## 0.3.1-beta.1 - 2026-11-24

测试版（npm `beta` 标签，GitHub Pre-release）：将共享 Web 需求看板直接内嵌到 DeepSeek Harness（`dsh`）Web 界面左侧导航栏，并支持从任务各阶段执行记录快捷跳回对应子 agent 对话或原需求对话。安装：`npx -y @yiyi_zhang/laoshi@beta install --platform dsh`。

### 使用者会看到的变化

- **dsh 内嵌「需求看板」面板（`/laoshi/`）**：`laoshi-dsh-plugin` 新增浏览器端界面模块（`adapters/dsh/plugin/client.js`）并在 `dsh` Web 服务端口挂载 `/laoshi` 代理，重启 `dsh` 后直接在左侧导航栏点击 **「需求看板」** 即可内嵌打开（自动同步 `dsh` 深浅主题、复用 `dsh` 登录认证校验，无需再单独打开页面）。
- **任务阶段执行记录与原对话快捷跳转**：共享看板详情抽屉新增 **「执行记录」**（展示各阶段状态、尝试次数、用时与错误信息，超过 12 步可切换查看全部）；在 `dsh` 中内嵌打开时，点击某一步的 **「查看执行记录 ↗」** 或顶部的 **「打开需求对话 ↗」** 可直接切回对应子 agent 或原需求对话。
- **安装升级自动补齐与诊断增强**：从旧版升级 `laoshi install --platform dsh` / `laoshi upgrade` 时，如 `cordis.patch.yml` 已挂载 `laoshi-dsh-plugin` 但缺少 `kitRoot` 或 `board`，会自动补齐并保留原有 `approvals` 等配置；`laoshi doctor` 同步提示 `/laoshi/` 左侧栏挂载状态。

### 升级须知

- **内网 Windows / dsh 测试**：运行 `npx -y @yiyi_zhang/laoshi@beta install --platform dsh`（或使用本版本 Release 附带的 Windows 离线安装包运行安装脚本），完成后重启 `dsh --profile web`，即可在左侧导航栏看到 **「需求看板」**。

## 0.3.0 - 2026-11-24

正式版（npm `latest` 标签）：新增共享 Web 需求看板与验收工作台、全链路变更历史与转交、受控流程扩展、多仓库联合开发增强、预算预估与多模型评审检查，并将 Paseo（`0.11–0.17`）需求插件与 DeepSeek Harness（`dsh 0.2.2-alpha.2` / `0.2.2-rc.5`）宿主适配及文档补齐。安装：`npx -y @yiyi_zhang/laoshi@latest install --platform <平台>`。

### 使用者会看到的变化

- **共享 Web 需求看板与验收工作台（`laoshi board`）**：任意平台均可运行 `laoshi board` 打开本机实时中文 Bento 需求看板；支持总览分组、「需要你处理」置顶、需求详情 6 站放行轨，以及验收工作台（一键试用启停、逐条 AC 勾选与提交 `acceptance.md` 结论、证据预览）。安装时可通过 `dsh` 自动托管看板（默认启用 `board: true`，`--no-board` / `--board-port` 可选配置，`laoshi doctor` 直接显示访问地址）。
- **改需求、变更历史与转交接手**：Web 看板「变更与接手」页签、Paseo 插件详情页及 CLI（`laoshi reply --change`、`laoshi handover`）支持在需求推进中发起改需求、倒序查看 `changes.md` 变更历史与 `spec.md` 提交 diff（绿增/红删高亮），并支持转交接手及完整交接记录（`.pipeline/owner.json`）。
- **受控流程扩展（`extensions`）**：支持在项目配置 `.laoshi.json` 中向固定主阶段后挂载受控的 AI/skill 或脚本扩展步骤（注入 `LAOSHI_*` 环境变量，日志保留在 `.pipeline/extensions/`），并保持 Windows 下 `cmd.exe` 兼容。
- **多仓库联合开发增强**：支持配置 `maxJointRepos`（1–10），`/laoshi-setup` 自动发现同级 Git 仓库辅助配置，需求详情页直观展示各关联仓库分支、工作区路径与质量门状态。
- **预算预估与多模型评审检查**：开工前与看板详情提供历史同档位耗时 / token 预算预估及超预算提醒；启用多模型评审小组但配置缺失或仅单个提供方时由 `laoshi doctor` 提前告警。
- **Paseo `0.11–0.17` 实机适配与插件体验**：支持 `laoshi install --platform paseo --with-plugin` 一步部署并加载 Paseo 插件，插件与 Web 看板共享状态分组与文案，修复 Paseo 0.17 下服务端打包运行时缺少 `import.meta.url` 导致的插件 RPC 报错。
- **dsh `0.2.2-rc.5` 适配与定时能力补齐**：插件实现 `schedule` 的 `expiresAt` 到期自动取消及 `scheduleNewAgent` 独立定时会话；双版本兼容 `dsh 0.2.2-alpha.2` 与 `0.2.2-rc.5` 的 `startActivation`、`subagents.interrupt`、`schedule.create`/`edit`（含 `cron.time_zone`）与 `sessions.events`。
- **摸高与通知体验打磨**：摸高超长追问/打断消息写入文件兜底，同主机中断轮次自动续接；全部停顿通知统一附上【停下原因】与【下一步请说】提示；新增《Paseo Web 与 dsh 真实环境插件走查清单》及版本范围守护。

### 升级须知

- **Paseo**：运行 `laoshi upgrade` 升级到 `0.3.0`（支持 Paseo `0.11–0.17`；安装过插件时自动同步刷新并重载）。如果使用了非默认 `--home`，请在守护进程中设置 `LAOSHI_HOME` 或在 Paseo「设置 → 插件 → `laoshi 需求`」填写安装根路径。
- **DeepSeek Harness（dsh）**：运行 `laoshi upgrade` 升级到 `0.3.0`，同步更新 `laoshi-dsh-plugin`（同时兼容 `0.2.2-alpha.2` 与 `0.2.2-rc.5+`），并默认随宿主开启托管看板（可通过 `--no-board` 关闭）。
- **摸高**：替换为本版本 Release 附带的 `laoshi-expert-0.3.0.zip`（或运行 `node adapters/mogao/make-expert.mjs` 重新生成）。

## 0.2.0 - 2026-11-21

正式版（npm `latest` 标签）：汇总 0.2.0-beta.1～beta.3 的全部功能（摸高适配器与专家包、Paseo 需求插件迁入、`laoshi migrate`、`laoshi permission`），并补充摸高版本自检、进程组清理、上下文控制、`laoshi diagnose` 脱敏诊断包与 Release 自动附带摸高专家包。安装：`npx -y @yiyi_zhang/laoshi@latest install --platform <平台>`。

### 使用者会看到的变化

- **诊断包（`laoshi diagnose <需求> [--out <目录>]`）**：一键导出已脱敏的排查目录（状态、流水线日志尾部、步骤结果、步骤输出与回调事件、脱敏配置与环境摘要），方便压缩后发给维护者定位问题。
- **摸高：启动后不再"去后台、有进展通知你"**：摸高上流水线在对话的命令里运行，对话一结束就停止。入口 skill 里启动后的说明改为摸高自己的一节（命令不会马上返回、不要结束这一轮对话、持续查看输出并转述）；命令输出也不再写"已在后台启动""进展会发回对话"，安静超过 3 分钟时再提醒一次"流水线仍在运行"。
- **摸高：结束一次运行时连它启动的进程一起结束**：每次 `aimax run` 单独成一个进程组，结束时整组结束，步骤里留下的服务、构建守护进程不再残留；收到 `done` 回调后留 2 秒等待完整输出，避免抢跑拿到不完整回复与用量。
- **步骤控制读入的内容量**：步骤提示词要求命令输出先过滤再看、不整包解压或列出依赖包、读源码先搜索定位（有的模型实际上下文只有十万 token 左右）；因上下文占满失败重做时，告诉新的 agent 换做法，从已写下的产物接着做。方案写明依赖相关结论的依据（命令和关键输出），方案审核照着重跑核实、每个结论只核实一次、`javap` 不看常量池和字节码。
- **摸高：专家要求的版本由命令自己保证**：专家里每条 laoshi 命令都带上它要求的版本（`LAOSHI_WANT_VERSION`），工作区装的不是这个版本时，命令先从 npm 镜像装上再执行；安装失败时不会在子脚本里重复尝试，更新平台设置失败时给出明确警告。
- **发布产物附带摸高专家包**：GitHub Release 除 `.tgz` 与 Windows 离线包外，同时附带该版本生成的 `laoshi-expert-0.2.0.zip`。

### 升级须知

- **摸高**：直接替换为本版本 Release 附带的 `laoshi-expert-0.2.0.zip`（或运行 `node adapters/mogao/make-expert.mjs` 生成），不要手工修改旧专家包里的版本号。
- **Paseo / dsh**：运行 `laoshi upgrade` 即可升级到 `0.2.0`（Paseo 需求插件会顺带更新）。

## 0.2.0-beta.3 - 2026-11-11

预发布版（npm 的 `beta` 标签，`latest` 仍是 0.1.1）：摸高的回调按平台文档的格式解析，步骤做完后靠 `done` 及时进入下一步，工具调用和用量能收到。安装：`npx -y @yiyi_zhang/laoshi@beta install --platform <平台>`。

### 使用者会看到的变化

- **摸高：回调按平台文档的格式解析**：工具调用（包在 `progress` 事件里）现在收得到，危险命令拦截和"最近活动"在摸高上开始生效；用量从 `usage` 字段读并计入缓存命中；`error` 回调也表示运行结束；上一版启动、这一版接着等的步骤也能靠 `done` 及时结束。

### 升级须知

- 摸高：专家包要换成这个版本生成的（入口 skill 里写着要装的版本），第一次使用时会装上 0.2.0-beta.3；用 `node -p "require('/data/workspace/.laoshi/npm/node_modules/@yiyi_zhang/laoshi/package.json').version"` 确认。

## 0.2.0-beta.2 - 2026-11-10

预发布版（npm 的 `beta` 标签，`latest` 仍是 0.1.1）：修复摸高上步骤做完要等很久才进入下一步的问题；新增不需要平台的命令行 agent 适配器、`laoshi migrate` 和随 laoshi 发布的 Paseo 需求插件。安装：`npx -y @yiyi_zhang/laoshi@beta install --platform <平台>`。

### 使用者会看到的变化

- **发起人**：状态文件和 `laoshi api list` 记下每个需求的发起人（`startedBy`，第一次运行时为谁运行，之后不改）。
- **使用者取平台给的身份**：平台提供使用者时（摸高的 `AIMAX_USER_NAME`）优先用它，`LAOSHI_USER` 仍然最优先；`laoshi doctor` 显示使用者从哪里来。
- **安装**：程序装在安装根的 `npm` 目录里时（摸高专家就这样安装），不再提示"需要设置环境变量 LAOSHI_HOME"。
- **命令行 agent（不需要平台）**（`laoshi install --platform cli`）：步骤 agent 是 Claude Code（`claude -p`）或 Codex（`codex exec`）的一次运行，追问和打断用会话续接，工具调用来自命令行的事件流（危险命令拦截照常工作）；进展用 `laoshi status` 查看。第一版，真实命令行上的验证待做。
- **摸高：步骤做完后马上进入下一步**：agent 做完但 `aimax run` 进程不退出时，以完整的输出或平台回调的 `done` 为准结束这一步，并结束残留的进程（之前要等到平台结束后台命令、再继续时才进入下一步）。
- **Paseo 的需求插件随 laoshi 发布**：`laoshi plugin install|status|remove`（从 paseo-req-kit 迁入，插件 id 改为 `laoshi`）；安装、升级时顺带更新插件。
- **`laoshi migrate`**：从 paseo-req-kit 1.x 迁移本机的配置、使用记录、需求索引和需求状态；默认只预览，`--apply` 执行，`--rollback` 回滚；旧目录不动。
- **文档**：新增《在摸高上使用》《只用命令行 agent》。

### 升级须知

- 摸高：专家包要按这个版本重新生成（`node adapters/mogao/make-expert.mjs`），入口 skill 第一次使用时会换上这个版本。
- Paseo：装过 paseo-req-kit 插件的，可以改装 laoshi 插件（`laoshi plugin install`），确认可用后用 `req plugin remove` 移除旧的。

## 0.2.0-beta.1 - 2026-11-07

预发布版（npm 的 `beta` 标签，`latest` 仍是 0.1.1）：支持摸高，用来在摸高沙箱里验证专家。安装：`npx -y @yiyi_zhang/laoshi@beta install --platform <平台>`。

### 使用者会看到的变化

- **支持摸高**（`laoshi install --platform mogao`）：每一步是摸高的一个独立 agent（`aimax run`），审批用摸高的人工审批，工具调用和用量来自摸高的进度回调。引擎在对话的命令里运行，进展显示在命令输出里；对话轮次结束打断的运行，下一轮用继续命令接着做。
- **摸高专家**：`node adapters/mogao/make-expert.mjs` 生成提交给摸高的专家（按摸高渲染的 skill 和介绍）；入口 skill 第一次使用时把 laoshi 装到工作区，并说明在摸高上命令会一直运行到停下、等待批准怎么回答、工具装在工作区。
- **安装根**：没有 `LAOSHI_HOME` 时，程序装在 `<安装根>/npm` 下就用这个安装根（每个对话轮次换机器的平台上不能依赖 `~`）。
- **`laoshi permission <需求> approve|deny [理由]`**：在对话里批准或拒绝步骤等待批准的操作，并接着运行（摸高上用）。
- **危险命令拦截**：读出凭据环境变量（如 `echo $XXX_TOKEN`、`printenv`）算作危险操作。

## 0.1.1 - 2026-11-05

在 npm 上的包名改为 **`@yiyi_zhang/laoshi`**：`laoshi` 这个名字在 npm 上不能使用，0.1.0 只发布到了 GitHub Release，没有发布到 npm。其余内容与 0.1.0 相同。

### 升级须知

- 安装命令：`npx -y @yiyi_zhang/laoshi@latest install --platform dsh|paseo`（内网加 `--registry=<镜像地址>`）。装好后的命令仍是 `laoshi`（别名 `req`），skill 仍是 `/laoshi` 等。
- 公司的 npm 镜像需要能同步 `@yiyi_zhang` 作用域下的包。
- 用 GitHub Release 上 0.1.0 的 `.tgz` 或离线包装过的机器，运行一次上面的安装命令即可换成 npm 上的版本。

## 0.1.0 - 2026-11-05

第一个正式版：paseo-req-kit 的需求开发体系，抽成不绑定平台的工具包，支持 Paseo 和 DeepSeek Harness。

### 使用者会看到的变化

- **新的名字和命令**：对话中的入口是 `/laoshi`、`/laoshi-setup`、`/laoshi-doctor`、`/laoshi-retro`；终端命令是 `laoshi`（`req` 是它的别名）。
- **支持 DeepSeek Harness（dsh）**：步骤 agent 作为子会话挂在发起的对话下，进展和结果发回对话；各角色可以各用一个 dsh 中的模型（`<提供方>/<模型>`，`dsh/chat-model` 用对话的模型）；`laoshi doctor` 列出可用的模型并逐个角色检查。
- **内置工作区和服务**：平台不提供时，laoshi 用 `git worktree` 为需求新建工作区，并按 `.laoshi/services.json` 启动、检查、停止项目的服务（每个工作区独立端口）。
- **一步安装**：`npx -y @yiyi_zhang/laoshi@latest install --platform dsh|paseo`；公司内网加 `--registry=<镜像地址>`；`laoshi upgrade` 升级或回退；`laoshi install --check`、`--uninstall`。Windows 上只用 cmd 和 Git Bash。
- **离线安装包**：完全没有 npm 源的机器，用 GitHub Release 上带 Windows 依赖的离线安装包，步骤见"内网安装与验证"。
- **文档站点**：https://yiyisf.github.io/laoshi/ ；`laoshi docs` 在本机打开和装的版本一致的文档（不需要外网）。
- **体检**：`laoshi doctor` 的"安装"一节检查 skill 是否已是这个版本的，并从 npm 源查询有没有新版本。
- **使用记录带上代码库和使用者**：使用记录、通知事件和 `laoshi api list` 中增加了代码库（目录、远程地址）和使用者（`LAOSHI_USER` 或安装级配置的 `user`）。

### 升级须知（从 paseo-req-kit）

- laoshi 和 paseo-req-kit 可以装在同一台机器上，互不覆盖：安装根是 `~/.laoshi`（只有 `~/.req-kit` 时读取它），项目配置是 `.laoshi.json`（`.requirement-pipeline.json` 继续被读取）。
- 状态文件升到第 2 版：第一次读到旧的状态文件时自动迁移，原文件留作 `.bak-v1`；正在运行的流水线只在内存中迁移。
- 配置中的 `paseoProfile`、`paseoServices` 改名为 `platformProfile`、`platformServices`，旧名继续有效。
- Paseo 的需求插件暂时仍由 paseo-req-kit 提供，计划在 0.1.0 之后迁入。
