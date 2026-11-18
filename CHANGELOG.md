# 更新记录

laoshi 的版本号遵循语义化版本，从 0.1.0 开始；每一版的标题写成 `## <版本> - <日期>`。每一版先写使用者会看到的变化，再写升级须知。laoshi 之前的历史见 paseo-req-kit 的更新记录（laoshi 从它的 1.15.0 抽出）。

## 未发布

### 使用者会看到的变化

- **摸高：启动后不再"去后台、有进展通知你"**：摸高上流水线在对话的命令里运行，对话一结束就停止。入口 skill 里启动后的说明改为摸高自己的一节（命令不会马上返回、不要结束这一轮对话、持续查看输出并转述）；命令输出也不再写"已在后台启动""进展会发回对话"，安静超过 3 分钟时再提醒一次"流水线仍在运行"。
- **摸高：结束一次运行时连它启动的进程一起结束**：每次 `aimax run` 单独成一个进程组，结束时整组结束，步骤里留下的服务、构建守护进程不再残留。
- **步骤控制读入的内容量**：步骤提示词要求命令输出先过滤再看、不整包解压或列出依赖包、读源码先搜索定位（有的模型实际上下文只有十万 token 左右）；因上下文占满失败重做时，告诉新的 agent 换做法，从已写下的产物接着做。方案写明依赖相关结论的依据（命令和关键输出），方案审核照着重跑核实、每个结论只核实一次、`javap` 不看常量池和字节码（实测一次依赖升级的审核把同一个类反编译了 17 次，工具输出一半是解包和反编译）。
- **摸高：专家要求的版本由命令自己保证**：专家里每条 laoshi 命令都带上它要求的版本（`LAOSHI_WANT_VERSION`），工作区装的不是这个版本时，命令先从 npm 镜像装上再执行。之前只靠入口 skill 里一行"先检查版本"，对话 agent 跳过它、或手工改专家时漏改一处，就会一直用旧版本。

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
