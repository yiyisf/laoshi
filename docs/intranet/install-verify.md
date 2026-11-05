# laoshi 内网安装与验证（dsh，Windows）

本文用于在内网的 Windows 机器上安装 laoshi，并按清单验证它在 DeepSeek Harness（dsh）上的效果。按顺序做一遍，大约需要半天，其中真实模型跑需求的时间占大部分。

- **适用**：laoshi M2 完成后的版本，即安装包 `laoshi-0.1.0-dev-<提交>-win32-x64.zip`。
- **环境约定**：
  - 内网机器是 Windows，Node.js 22.20；
  - **PowerShell 被禁止运行**，本文所有命令都在 **cmd** 中执行（Git Bash 也可以）；
  - 步骤 agent 执行 bash 命令依靠团队的 dsh 专属插件（见摸底报告）。
- **安全**：口令、令牌只放在本机的环境变量里，不要写进本文提到的任何文件，也不要贴进对话或反馈。

## 0. 准备

在开始之前确认：

| 项 | 要求 | 检查方法（cmd） |
| --- | --- | --- |
| Node.js | 22.19 或更新（22.20 可以） | `node -v` |
| Git for Windows | 已安装，`git` 在 PATH 中 | `git --version` |
| dsh | 已安装，能用真实模型对话（经内网网关）；知道自己用的是哪个 profile（下文以 `web` 为例） | 打开 dsh 的网页界面，随便问一句 |
| bash 插件 | 团队的 dsh 专属 bash 插件已在同一个 profile 中启用，步骤 agent 能执行 bash 命令 | 在 dsh 对话里让它执行 `git --version` |
| 安装包 | `laoshi-…-win32-x64.zip`（已带依赖，不需要 npm 源和外网） | — |

下文的目录约定（可以按需要换成别的位置，**路径中最好不要有空格和中文**）：

| 目录 | 示例 | 用途 |
| --- | --- | --- |
| laoshi 程序 | `D:\laoshi\kit` | 解压的安装包 |
| 安装根（`LAOSHI_HOME`） | 默认 `%USERPROFILE%\.laoshi` | 安装级配置、使用记录、为需求新建的 worktree、服务记录 |
| dsh 目录（`DSH_HOME`） | 默认 `%USERPROFILE%\.dsh` | dsh 的 profile、插件、skill |
| 样例项目 | `D:\laoshi\samples\demo-a`、`demo-b` | 验证用 |

安装根建议用默认位置。如果要换，需要设置环境变量 `LAOSHI_HOME`，并且**之后新开的 cmd 窗口和 dsh 都要能读到它**（设置后重启 dsh）。

## 1. 解压安装包

在 cmd 中执行（Windows 10/11 自带 `tar`；也可以用资源管理器解压）：

```bat
mkdir D:\laoshi
cd /d D:\laoshi
tar -xf laoshi-0.1.0-dev-<提交>-win32-x64.zip
ren laoshi-0.1.0-dev-<提交>-win32-x64 kit
type kit\BUILD.txt
```

`BUILD.txt` 中写着版本和提交号，反馈问题时请一并提供。

## 2. 运行安装脚本

先**关闭 dsh**，然后在 cmd 中执行：

```bat
cd /d D:\laoshi\kit
node adapters\dsh\intranet\install.mjs --profile web
```

常用参数：

- `--home <目录>`：安装根，默认 `%LAOSHI_HOME%` 或 `%USERPROFILE%\.laoshi`。
- `--dsh-home <目录>`：dsh 目录，默认 `%DSH_HOME%` 或 `%USERPROFILE%\.dsh`。
- `--profile <名称>`：dsh 的 profile，默认 `web`。
- `--approvals ask|allow`：步骤 agent 的审批请求怎么处理。`ask` 交给人批准，是默认值，建议先用它；`allow` 直接批准。
- `--dsh-bin <dsh 的 bin.js>`：`dsh` 命令不在 PATH 中时，直接指定它的入口文件。
- `--dry-run`：演练一遍，只显示要做的事，不写任何文件。

脚本会依次完成以下几件事，每一步都会显示 ✓ / ⚠ / ✗：

1. 检查 Node.js、git 和依赖。
2. 写入安装级配置 `<安装根>\config.json`，平台设为 dsh。已有这个文件时不改动；如果文件里的平台不是 dsh，脚本会停下。
3. 安装 laoshi 的 dsh 插件：先用 `dsh plugin add`；不成功时（比如内网连不到 npm 源），改为直接复制到 profile 的 `node_modules`。然后在 `cordis.patch.yml` 末尾挂载插件。
4. 把 skill 渲染成 dsh 的说法，写到 `<dsh 目录>\skills`。写入后有 `/laoshi`、`/laoshi-setup`、`/laoshi-doctor`、`/laoshi-retro`，以及方法类 skill 和原则 skill。

脚本只启动 `node` 自己；调用 `dsh` 命令时经过 `cmd.exe`。整个过程**不会启动 PowerShell**。

## 3. 启动 dsh，体检

1. 用同一个 profile 启动 dsh。
2. 新开一个 cmd 窗口，执行：

   ```bat
   node D:\laoshi\kit\bin\req.mjs doctor --no-project
   ```

3. 对照下表检查输出：

   | 一节 | 期望 |
   | --- | --- |
   | 安装根与身份 | 安装根是你选的目录；使用者是你的系统用户名，或 `LAOSHI_USER` |
   | 配置 | ✓ 配置文件；builder、reviewer 为 `dsh/chat-model`（dsh 下步骤 agent 使用对话的模型） |
   | DeepSeek Harness（dsh）与 laoshi 插件 | ✓ 已连接 laoshi 的 dsh 插件，审批策略为 ask |
   | 平台能力 | 定时消息、为需求新开对话、最近活动、打断大目录搜索、危险命令拦截为"laoshi 插件"；为需求新建工作区、受管服务为"laoshi 内置"；其余为"无" |

   出现 ✗ 时，先按"常见问题"处理。

## 4. 验证清单

按顺序进行，每一项都在第 5 节的表里记下结果。V1–V3 是基础，**V4 和 V9 是这次验证的重点**。

### 准备样例项目

在 cmd 中执行：

```bat
cd /d D:\laoshi\kit
node adapters\dsh\intranet\make-sample.mjs D:\laoshi\samples\demo-a
node adapters\dsh\intranet\make-sample.mjs D:\laoshi\samples\demo-b
```

每个样例项目都包含：

- 一个文本函数和它的测试；
- 一个 HTTP 服务；
- `.laoshi/services.json`：一条准备命令，以及服务 `web`；
- `.laoshi.json`：质量门执行 `npm test`，默认档位为快速。

样例项目已提交到 `main` 分支。

### V1 体检

- **做法**：在 demo-a 目录执行 `node D:\laoshi\kit\bin\req.mjs doctor --repo D:\laoshi\samples\demo-a`。
- **期望**：
  - 第 3 节表中的各项都正常；
  - 项目一节显示 ✓ `.laoshi.json`；
  - ✓ `.laoshi/services.json`：新建 worktree 时运行 1 条准备命令，服务 web 由 laoshi 启动；
  - 提示"在默认分支 main 上"是预期的。

### V2 skill 可用

- **做法**：在 dsh 中，以 demo-a 为工作目录新建一个对话，输入 `/laoshi`。
- **期望**：
  - 能找到并加载 `/laoshi`；
  - 它的说明里写的是 dsh（例如"dsh 提供的 `DSH_SESSION_ID`"），不出现 Paseo。

### V3 项目接入

- **做法**：在 demo-a 的对话里输入 `/laoshi-setup`，按它的提问回答，确认后让它提交。
- **期望**：
  - 生成 `.requirement-pipeline\project-notes.md`、`.requirement-pipeline\verify.md`，以及 `GLOSSARY.md`（可选）；
  - 已有的 `.laoshi/services.json`、`.laoshi.json` 只补充、不推翻；
  - 验证命令（`npm test`、启动服务）实际运行过，结果写进了 verify.md。

### V4 一个小需求走完全程（真实模型）

1. 在 demo-a 的对话里输入：

   > `/laoshi` 新需求：给文本工具加一个"把每个单词首字母大写、其余字母小写"的选项，接口 /api/title 增加参数 lower=1 开启它。

2. 按 `/laoshi` 的引导完成需求对齐，确认需求说明（spec），然后让它启动。
   - 当前在 main 分支上，它会建议为需求新建工作区，同意即可。这一项同时验证 V5。
3. 期望结果：

   | 检查点 | 期望 |
   | --- | --- |
   | 启动 | 对话里显示"已在后台启动"，以及新工作区的位置（在安装根的 `worktrees\` 下） |
   | 步骤 | dsh 中这个对话的子 agent 列表里依次出现带编号的步骤（方案设计、方案审核、代码实现、代码评审、提测说明、功能验证、完成报告） |
   | 进展 | 对话陆续收到"【需求开发流水线通知】……"的进展消息，说法是 dsh 的（例如"dsh 定时任务"），没有 Paseo |
   | 查看进度 | 在对话里说"做到哪了"，能说清当前步骤 |
   | 结束 | 对话收到结束通知和完成报告的位置；报告结论与实际一致 |

4. 记下用时、结论；任何卡住或报错的地方，都记下当时的时间和对话里的原话。

### V5 为需求新建工作区、准备命令、服务

这一项在 V4 中一并验证，结束后检查：

- `git -C D:\laoshi\samples\demo-a worktree list` 能看到需求的工作区，分支为 `feature/<需求目录名>`。
- 工作区里有 `setup-done.txt`，内容是 demo-a 的路径（说明准备命令已运行）。
- 在工作区的 `docs\features\<需求>\.pipeline\pipeline.log` 中能找到"laoshi 管理的服务：web → http://127.0.0.1:<端口>（端口 …），已启动，健康检查通过"。
- 需求完成后，服务已经停止：任务管理器中没有残留的 `node server.mjs`；`<安装根>\workspaces\…\services\web.json` 中 `"pid": null`。

### V6 审批

- **做法**：V4 运行期间，如果某个步骤需要批准（例如沙箱外执行），在 dsh 界面中批准或拒绝。
- **期望**：
  - 对话收到消息，说明"在 dsh 的界面中打开这个对话的子 agent「…」，查看并批准这个请求"；
  - 批准后流水线继续。
- 没有出现审批请求时，记为"未出现"。

### V7 预约

- **做法**：在 demo-b 的对话里提一个小需求（可以照抄 V4 的内容），确认后说"10 分钟后再开始"。
- **期望**：
  - 对话回复"已预约在 … 开始（dsh 定时任务……）"；
  - 到时对话自动执行启动命令，流水线开始；
  - 在预约时间之前说"先停一下"，可以取消预约。

### V8 两个代码库同时运行

- **做法**：demo-a、demo-b 各在自己的对话里启动一个需求，让两条流水线同时运行。可以在 V7 的预约触发后，再在 demo-a 启动一个新需求。
- **期望**：
  - 两条都正常结束，互不干扰；
  - 执行 `node D:\laoshi\kit\bin\req.mjs api list --all`，输出中两个需求的 `codebase.root` 分别是 demo-a、demo-b；
  - `<安装根>\usage\runs.jsonl` 中的运行记录带有 `user` 和 `requirement.codebase`。

### V9 评估用例（真实模型，客观指标）

用仓库自带的评估用例衡量真实模型的产出：流水线看不到隐藏验收测试，结束后用隐藏测试检验，并核对报告结论是否"夸大"。

保持 dsh 运行，在 cmd 中执行：

```bat
cd /d D:\laoshi\kit
node node_modules\tsx\dist\cli.mjs engine\src\eval.ts --case text-utils-tb --config "%USERPROFILE%\.laoshi\config.json" --keep
```

- 评估不在对话中运行，每个步骤在 dsh 中是一个独立的会话。可以在会话列表里看到它们。
- **期望**：
  - 结果表中"流水线状态"为 completed，"隐藏验收"为通过（4/4）；
  - **"如实"不是"夸大"**，这是最重要的一项。
- 时间允许时，再跑 `--case todo-cli-due` 和 `--case text-utils-rounding-defect`。
- 结果在 `evals\results\<时间>\summary.md`，请把它反馈回来。

### V10 Windows 上的 shell

- **做法**：V4 运行期间观察，或事后查看各步骤 agent 的对话记录。
- **期望**：
  - 步骤 agent 能正常执行 `git`、`node`、`npm` 等命令；
  - 没有因为 PowerShell 被禁止而报错；
  - laoshi 自己启动的进程（服务、准备命令）只有 `node` 和 `cmd`。

### V11 按角色选择模型（可选，需要 2026-11-04 之后的安装包）

- **做法**：
  1. 先体检，输出中的"dsh 中可用的模型："一行列出了 dsh 里配置好的模型。
  2. 编辑 `<安装根>\config.json`，把 reviewer 改成其中一个模型，例如 `"reviewer": { "provider": "<提供方>/<模型>" }`。需要时加上 `"thinkingOptionId": "high"` 作为推理强度。
  3. 再体检一次，然后在 demo-b 跑一个小需求。
- **期望**：
  - 体检显示 ✓ reviewer：<提供方>/<模型>；
  - 方案审核、代码评审、功能验证这几个步骤在 dsh 中用的是这个模型（可以在子 agent 的会话里看到），其余步骤用对话的模型；
  - 写错模型名时，体检显示 ✗ 并列出可用的模型。

## 5. 记录结果

| 项 | 结果（通过 / 不通过 / 未出现） | 用时 | 说明（不通过时：现象、时间、对话里的原话、相关日志的位置） |
| --- | --- | --- | --- |
| 安装脚本 | | | |
| 体检 | | | |
| V1 体检（项目） | | | |
| V2 skill | | | |
| V3 项目接入 | | | |
| V4 全流程 | | | |
| V5 工作区与服务 | | | |
| V6 审批 | | | |
| V7 预约 | | | |
| V8 两个代码库 | | | |
| V9 评估 | | | |
| V10 shell | | | |
| V11 按角色选模型 | | | |

请把以下材料一起反馈（反馈前确认其中没有口令、令牌）：

- 这张表；
- `BUILD.txt`；
- 体检输出；
- V9 的 `summary.md`；
- 失败项的 `pipeline.log`（位于需求目录下的 `.pipeline\pipeline.log`），以及 `<dsh 目录>\laoshi\plugin.log`。

## 6. 常见问题

| 现象 | 处理 |
| --- | --- |
| 体检：没有找到 laoshi 的 dsh 插件（token 不存在） | dsh 没有启动，或启动时用的不是安装时的 profile；确认 `cordis.patch.yml` 末尾有 `laoshi-dsh-plugin` 一段，然后重启 dsh |
| 体检：连不上 laoshi 的 dsh 插件 | dsh 刚启动还没加载完，等几秒再试；仍不行时看 `<dsh 目录>\laoshi\plugin.log` 和 dsh 自己的日志 |
| `cordis.patch.yml` 中原来写着 `[]` | 安装脚本会把它换成列表写法；手工编辑时不要同时保留 `[]` 和 `- insert:` |
| `/laoshi` 找不到 | skill 写到了别的 dsh 目录：确认 `<dsh 目录>\skills\laoshi\SKILL.md` 存在；dsh 的 `DSH_HOME` 和安装时的 `--dsh-home` 要一致 |
| 改了 `LAOSHI_HOME` 后体检或流水线找不到配置 | 用 `setx LAOSHI_HOME "<目录>"` 设置，然后新开 cmd 窗口，并重启 dsh |
| 步骤 agent 执行命令失败，提示 PowerShell 不可用 | dsh 默认用 PowerShell 执行命令：确认团队的 bash 插件已在这个 profile 启用（见摸底报告） |
| 流水线启动后很快中断 | 看对话中的中断原因，以及需求目录下的 `.pipeline\pipeline.log`；修好后说"继续开发" |
| 需要停掉一条流水线 | 在它的对话里说"先停一下"，或执行 `node D:\laoshi\kit\bin\req.mjs stop <需求>` |

## 7. 卸载

1. 关闭 dsh。
2. 执行 `node D:\laoshi\kit\bin\install.mjs --uninstall`：删除 laoshi 安装的 skill（只删带 `.laoshi-install.json` 标记的目录）、dsh 中的插件及其挂载，以及安装根里的 `laoshi`、`req` 命令。
3. 删除 laoshi 程序目录；安装根（配置、使用记录）不再需要时也可以删除。

样例项目可以直接删除。
